import { pool } from "../db/index.js";
import { hashPassword } from "./password.js";
import env from "../config/index.js";

export interface QueryExecutor {
  query(text: string, params?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
}

export interface BootstrapAdminConfig {
  email: string;
  password: string;
  name: string;
  nodeEnv?: string;
}

/**
 * Validates bootstrap admin credentials when a new admin needs to be created.
 * Rejects missing credentials or forbidden default passwords ('ChangeMe123!').
 */
export function validateBootstrapCredentials(config: BootstrapAdminConfig): {
  email: string;
  password: string;
  name: string;
} {
  const email = config.email.trim();
  const password = config.password;
  const name = config.name.trim() || "Administrator";

  if (!email) {
    throw new Error(
      "[BOOTSTRAP] ADMIN_BOOTSTRAP_EMAIL is required to create the initial administrator."
    );
  }

  if (!password) {
    throw new Error(
      "[BOOTSTRAP] ADMIN_BOOTSTRAP_PASSWORD is required to create the initial administrator."
    );
  }

  if (
    password === "ChangeMe123!" ||
    (config.nodeEnv === "production" && password === "CHANGE_ME_INITIAL_ADMIN_PASSWORD")
  ) {
    throw new Error(
      "[BOOTSTRAP] Refusing to initialize administrator with an insecure default or placeholder password."
    );
  }

  return { email, password, name };
}

/**
 * Ensures that at least one active admin user exists in the database.
 * - If an active admin already exists, returns "existing_admin" immediately without modifying any data.
 * - If no active admin exists and ADMIN_BOOTSTRAP_EMAIL already belongs to an existing user,
 *   throws an explicit error without changing that user's role, active status, or password.
 * - Otherwise creates the initial admin only when valid credentials are provided, and never logs passwords or hashes.
 */
export async function ensureBootstrapAdmin(
  db: QueryExecutor = pool,
  config: BootstrapAdminConfig = {
    email: env.ADMIN_BOOTSTRAP_EMAIL,
    password: env.ADMIN_BOOTSTRAP_PASSWORD,
    name: env.ADMIN_BOOTSTRAP_NAME,
    nodeEnv: env.NODE_ENV,
  }
): Promise<"existing_admin" | "created_admin"> {
  const adminCheck = await db.query(
    "SELECT id FROM users WHERE role = 'admin' AND is_active = true LIMIT 1"
  );

  if (adminCheck.rows.length > 0) {
    console.log("[BOOTSTRAP] Active admin already exists; skipping bootstrap.");
    return "existing_admin";
  }

  const { email, password, name } = validateBootstrapCredentials(config);

  // Check if a user with this email already exists (without active admin role)
  const existing = await db.query("SELECT id FROM users WHERE email = $1", [email]);

  if (existing.rows.length > 0) {
    throw new Error(
      `[BOOTSTRAP] Cannot create bootstrap admin: user with email '${email}' already exists without active admin privileges.`
    );
  }

  const passwordHash = await hashPassword(password);

  await db.query(
    `INSERT INTO users (name, email, password, role, is_active, email_verified)
     VALUES ($1, $2, $3, 'admin', true, true)`,
    [name, email, passwordHash]
  );

  console.log(`[BOOTSTRAP] Created initial admin user: ${email}`);
  return "created_admin";
}