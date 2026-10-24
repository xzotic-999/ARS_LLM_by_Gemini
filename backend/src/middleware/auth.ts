import { Request, Response, NextFunction } from "express";
import { pool } from "../db/index.js";
import type { UserPublic } from "../types.js";
import { getSessionUser } from "./sessionUser.js";

export interface AuthenticatedRequest extends Request {
  user: UserPublic;
}

// Require an authenticated session.
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const user = getSessionUser(req);

  if (!user) {
    res.status(401).json({
      error: { message: "Требуется вход в систему." },
    });
    return;
  }

  (req as AuthenticatedRequest).user = user;
  next();
}

// Require an admin session.
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const user = getSessionUser(req);

  if (!user) {
    res.status(401).json({
      error: { message: "Требуется вход в систему." },
    });
    return;
  }

  if (user.role !== "admin") {
    res.status(403).json({
      error: { message: "Недостаточно прав." },
    });
    return;
  }

  (req as AuthenticatedRequest).user = user;
  next();
}

// Load the session user from the DB on every request (keeps session fresh).
export async function loadUser(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  const session = req.session as { user?: UserPublic } | undefined;
  const userId = session?.user?.id;

  if (userId) {
    try {
      const result = await pool.query(
        `SELECT id, name, email, role, is_active, email_verified, created_at
         FROM users
         WHERE id = $1 AND is_active = true`,
        [userId]
      );

      if (result.rows.length > 0) {
        session!.user = result.rows[0] as UserPublic;
      } else {
        // User was deactivated or deleted — clear the session.
        delete session!.user;
      }
    } catch {
      // Fail open — don't break the request if the lookup fails.
    }
  }

  next();
}

export default { requireAuth, requireAdmin, loadUser };