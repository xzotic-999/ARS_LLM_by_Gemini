import { Request } from "express";
import type { UserPublic } from "../types.js";

/**
 * Read the authenticated user stored on the session.
 *
 * express-session's type for `req.session` is `Session & Partial<SessionData>`,
 * and our `user` field lives inside that object. This helper centralizes the
 * read so callers don't have to sprinkle `as any` everywhere.
 */
export function getSessionUser(req: Request): UserPublic | undefined {
  const session = req.session as { user?: UserPublic } | undefined;
  return session?.user;
}

export function setSessionUser(req: Request, user: UserPublic): void {
  (req.session as { user?: UserPublic } | undefined)!.user = user;
}

export function clearSessionUser(req: Request): void {
  if (req.session) {
    delete (req.session as { user?: UserPublic }).user;
  }
}