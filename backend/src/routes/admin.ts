import { Router } from "express";
import { pool } from "../db/index.js";
import { requireAdmin } from "../middleware/auth.js";
import {
  getUserQuotaStatus,
  setUserQuotaLimits,
  getUserQuotaLimits,
} from "../services/quota.js";
import { hashPassword } from "../services/password.js";

const router = Router();

// All admin routes require an admin session.
router.use(requireAdmin);

// POST /api/v1/admin/users — create a new user (admin only)
router.post("/users", async (req, res, next) => {
  try {
    const { name, email, password, role } = req.body;

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      res.status(400).json({ error: { message: "Name is required." } });
      return;
    }

    if (!email || typeof email !== "string" || !email.includes("@")) {
      res.status(400).json({ error: { message: "A valid email is required." } });
      return;
    }

    if (!password || typeof password !== "string" || password.length < 8) {
      res.status(400).json({
        error: { message: "Password must be at least 8 characters." },
      });
      return;
    }

    if (role !== undefined && role !== "admin" && role !== "employee") {
      res.status(400).json({ error: { message: "Invalid role." } });
      return;
    }

    const existing = await pool.query(
      "SELECT id FROM users WHERE email = $1",
      [email.trim().toLowerCase()]
    );

    if (existing.rows.length > 0) {
      res.status(409).json({ error: { message: "User with this email already exists." } });
      return;
    }

    const passwordHash = await hashPassword(password);

    const result = await pool.query(
      `INSERT INTO users (name, email, password, role, is_active, email_verified)
       VALUES ($1, $2, $3, $4, true, true)
       RETURNING id, name, email, role, is_active, email_verified, created_at`,
      [name.trim(), email.trim().toLowerCase(), passwordHash, role || "employee"]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/admin/users — list all users with quota status (admin only)
router.get("/users", async (_req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT id, name, email, role, is_active, email_verified, created_at
       FROM users
       ORDER BY created_at ASC`
    );
    const users = await Promise.all(
      result.rows.map(async (u) => {
        const quotas = await getUserQuotaStatus(u.id);
        return { ...u, quotas };
      })
    );
    res.json({ users });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/admin/users/:id — single user
router.get("/users/:id", async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);

    if (isNaN(id)) {
      res.status(400).json({ error: { message: "Invalid user id." } });
      return;
    }

    const result = await pool.query(
      `SELECT id, name, email, role, is_active, email_verified, created_at
       FROM users
       WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: { message: "User not found." } });
      return;
    }

    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/v1/admin/users/:id — update role / active status
router.patch("/users/:id", async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);

    if (isNaN(id)) {
      res.status(400).json({ error: { message: "Invalid user id." } });
      return;
    }

    const { role, is_active } = req.body;

    if (role !== undefined && role !== "admin" && role !== "employee") {
      res.status(400).json({ error: { message: "Invalid role." } });
      return;
    }

    if (is_active !== undefined && typeof is_active !== "boolean") {
      res.status(400).json({ error: { message: "is_active must be a boolean." } });
      return;
    }

    const result = await pool.query(
      `UPDATE users
       SET role = COALESCE($1, role),
           is_active = COALESCE($2, is_active),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $3
       RETURNING id, name, email, role, is_active, email_verified, created_at`,
      [role ?? null, is_active ?? null, id]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: { message: "User not found." } });
      return;
    }

    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/v1/admin/users/:id — deactivate a user (soft delete)
router.delete("/users/:id", async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);

    if (isNaN(id)) {
      res.status(400).json({ error: { message: "Invalid user id." } });
      return;
    }

    // Prevent self-deactivation
    if (req.user!.id === id) {
      res.status(400).json({
        error: { message: "Cannot deactivate your own account." },
      });
      return;
    }

    const result = await pool.query(
      `UPDATE users
       SET is_active = false, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1
       RETURNING id, name, email, role, is_active`,
      [id]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: { message: "User not found." } });
      return;
    }

    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/admin/users/:id/quotas — quota status for a user
router.get("/users/:id/quotas", async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);

    if (isNaN(id)) {
      res.status(400).json({ error: { message: "Invalid user id." } });
      return;
    }

    const status = await getUserQuotaStatus(id);
    const limits = await getUserQuotaLimits(id);

    res.json({
      daily: { used: status.daily.used, limit: limits.daily.limit },
      monthly: { used: status.monthly.used, limit: limits.monthly.limit },
    });
  } catch (err) {
    next(err);
  }
});

// PUT /api/v1/admin/users/:id/quotas — set quota limits (admin only)
router.put("/users/:id/quotas", async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);

    if (isNaN(id)) {
      res.status(400).json({ error: { message: "Invalid user id." } });
      return;
    }

    const { daily_limit, monthly_limit } = req.body ?? {};
    const { setUserQuotaLimitsForActor } = await import("../services/quota.js");

    const updateResult = await setUserQuotaLimitsForActor(
      req.user,
      id,
      daily_limit ?? null,
      monthly_limit ?? null
    );

    if (!updateResult.ok) {
      res.status(updateResult.status).json({
        error: updateResult.error,
      });
      return;
    }

    res.json({
      user_id: id,
      quotas: updateResult.quotas,
      message: "Quota limits updated.",
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/admin/usage — recent usage events and summary (admin only)
router.get("/usage", async (req, res, next) => {
  try {
    const limit = Math.min(
      100,
      Math.max(1, parseInt(req.query.limit as string, 10) || 50)
    );

    const [eventsRes, summaryRes] = await Promise.all([
      pool.query(
        `SELECT id, user_id, event_type, event_data, created_at
         FROM usage_events
         ORDER BY created_at DESC
         LIMIT $1`,
        [limit]
      ),
      pool.query(
        `SELECT event_type, COUNT(*)::int AS count
         FROM usage_events
         GROUP BY event_type`
      ),
    ]);

    res.json({
      summary: summaryRes.rows,
      daily: [],
      events: eventsRes.rows,
    });
  } catch (err) {
    next(err);
  }
});

export default router;