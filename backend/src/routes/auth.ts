import { Router } from "express";
import { pool } from "../db/index.js";
import { verifyPassword } from "../services/password.js";
import { setSessionUser } from "../middleware/sessionUser.js";
import { getUserQuotaStatus } from "../services/quota.js";
import { validateProfileSelfUpdatePayload } from "../services/instruction.js";
import type { UserPublic } from "../types.js";

const router = Router();

// POST /api/v1/auth/login
router.post("/login", async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || typeof email !== "string" || !password || typeof password !== "string") {
      res.status(400).json({
        error: { message: "Email and password are required." },
      });
      return;
    }

    const result = await pool.query(
      `SELECT id, name, email, password, role, is_active, email_verified, created_at
       FROM users
       WHERE email = $1`,
      [email.trim().toLowerCase()]
    );

    if (result.rows.length === 0) {
      res.status(401).json({
        error: { message: "Invalid email or password." },
      });
      return;
    }

    const user = result.rows[0];

    if (!user.is_active) {
      res.status(403).json({
        error: { message: "Account is deactivated." },
      });
      return;
    }

    const valid = await verifyPassword(password, user.password);
    if (!valid) {
      res.status(401).json({
        error: { message: "Invalid email or password." },
      });
      return;
    }

    // Regenerate session ID to prevent session fixation
    req.session!.regenerate((err) => {
      if (err) {
        next(err);
        return;
      }

      const publicUser: UserPublic = {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        is_active: user.is_active,
        email_verified: Boolean(user.email_verified),
        created_at: user.created_at ? new Date(user.created_at) : new Date(),
      };

      setSessionUser(req, publicUser);

      getUserQuotaStatus(user.id)
        .then((quotas) => {
          res.json({
            user: { ...publicUser, quotas },
            quotas,
          });
        })
        .catch(() => {
          res.json({
            user: publicUser,
          });
        });
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/auth/logout
router.post("/logout", (_req, res) => {
  _req.session!.destroy((err) => {
    if (err) {
      res.status(500).json({
        error: { message: "Failed to log out." },
      });
      return;
    }
    res.clearCookie("connect.sid");
    res.status(200).json({ message: "Logged out." });
  });
});

// GET /api/v1/auth/me — current user
router.get("/me", async (req, res) => {
  const user = (req.session as { user?: UserPublic } | undefined)?.user;
  if (!user) {
    res.status(401).json({
      error: { message: "Not authenticated." },
    });
    return;
  }
  try {
    const quotas = await getUserQuotaStatus(user.id);
    res.json({ user: { ...user, quotas }, quotas });
  } catch {
    res.json({ user });
  }
});

// PATCH /api/v1/auth/profile — update current user's display name (corporate email & role are read-only)
router.patch("/profile", async (req, res, next) => {
  try {
    const sessionUser = (req.session as { user?: UserPublic } | undefined)?.user;
    if (!sessionUser) {
      res.status(401).json({
        error: { message: "Not authenticated." },
      });
      return;
    }

    const validation = validateProfileSelfUpdatePayload(req.body, sessionUser);
    if (!validation.ok) {
      res.status(validation.status).json({
        error: { message: validation.error },
      });
      return;
    }

    const updateRes = await pool.query(
      `UPDATE users
       SET name = $1, updated_at = NOW()
       WHERE id = $2 AND is_active = TRUE
       RETURNING id, name, email, role, is_active, email_verified, created_at`,
      [validation.name, sessionUser.id]
    );

    if (updateRes.rows.length === 0) {
      res.status(403).json({
        error: { message: "Account is deactivated or not found." },
      });
      return;
    }

    const row = updateRes.rows[0];
    const updatedUser: UserPublic = {
      id: row.id,
      name: row.name,
      email: row.email,
      role: row.role,
      is_active: row.is_active,
      email_verified: Boolean(row.email_verified),
      created_at: row.created_at ? new Date(row.created_at) : new Date(),
    };

    setSessionUser(req, updatedUser);

    res.status(200).json({
      user: updatedUser,
      personalInstructions: validation.personalInstructions,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/auth/quotas — current user's daily and monthly quota status (read-only)
router.get("/quotas", async (req, res, next) => {
  const user = (req.session as { user?: UserPublic } | undefined)?.user;
  if (!user) {
    res.status(401).json({
      error: { message: "Not authenticated." },
    });
    return;
  }
  try {
    const quotas = await getUserQuotaStatus(user.id);
    res.json({ ...quotas, quotas });
  } catch (err) {
    next(err);
  }
});

// Explicitly forbid any attempt by a user to mutate their own quotas via /api/v1/auth/quotas
router.all("/quotas", (_req, res) => {
  res.status(403).json({
    error: {
      code: "FORBIDDEN",
      message:
        "Сотрудник не может изменять свои квоты запросов. Обратитесь к администратору.",
    },
  });
});

export default router;