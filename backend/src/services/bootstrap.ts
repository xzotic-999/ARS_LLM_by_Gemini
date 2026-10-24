import { pool } from "../db/index.js";
import { hashPassword } from "./password.js";
import env from "../config/index.js";

/**
 * Ensures that at least one active admin user exists in the database.
 * If no admin exists, creates one from environment variables or a secure default.
 */
export async function ensureBootstrapAdmin(): Promise<void> {
  try {
    const adminCheck = await pool.query(
      "SELECT id FROM users WHERE role = 'admin' AND is_active = true LIMIT 1"
    );

    if (adminCheck.rows.length > 0) {
      console.log("Bootstrap admin already exists.");
      return;
    }

    const email = env.ADMIN_BOOTSTRAP_EMAIL || "admin@ars_llm.local";
    const password = env.ADMIN_BOOTSTRAP_PASSWORD || "ChangeMe123!";
    const name = env.ADMIN_BOOTSTRAP_NAME || "Administrator";

    // Check if user with this email already exists
    const existing = await pool.query("SELECT id FROM users WHERE email = $1", [email]);

    if (existing.rows.length > 0) {
      // Promote existing user to admin
      await pool.query(
        "UPDATE users SET role = 'admin', is_active = true WHERE email = $1",
        [email]
      );
      console.log(`Promoted existing user ${email} to admin.`);
      return;
    }

    const passwordHash = await hashPassword(password);

    await pool.query(
      `INSERT INTO users (name, email, password, role, is_active, email_verified)
       VALUES ($1, $2, $3, 'admin', true, true)`,
      [name, email, passwordHash]
    );

    console.log(`[BOOTSTRAP] Created default admin user: ${email}`);
    if (!env.ADMIN_BOOTSTRAP_PASSWORD) {
      console.log(
        "[BOOTSTRAP] WARNING: Using default password 'ChangeMe123!'. Change it immediately!"
      );
    }
  } catch (err) {
    console.error("Failed to ensure bootstrap admin:", err);
  }
}