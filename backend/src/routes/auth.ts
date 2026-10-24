import { Router } from "express";
import { pool } from "../db/index.js";
import { verifyPassword } from "../services/password.js";
import { setSessionUser } from "../middleware/sessionUser.js";
import { getUserQuotaStatus } from "../services/quota.js";
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
      `SELECT id, name, email, password, role, is_active
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
        email_verified: false,
        created_at: new Date(user.created_at),
      };

      setSessionUser(req, publicUser);

      res.json({
        user: publicUser,
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
    res.json({ user, quotas });
  } catch {
    res.json({ user });
  }
});

// GET /api/v1/auth/quotas — current user's daily and monthly quota status
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
    res.json(quotas);
  } catch (err) {
    next(err);
  }
});

export default router;