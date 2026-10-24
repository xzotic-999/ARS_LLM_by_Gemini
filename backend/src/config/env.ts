import dotenv from "dotenv";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// Load the root project .env regardless of the current working directory.
const currentDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(currentDir, "../../../");
dotenv.config({ path: resolve(projectRoot, ".env") });

interface Env {
  PORT: number;
  POSTGRES_HOST?: string;
  POSTGRES_PORT: number;
  POSTGRES_USER: string;
  POSTGRES_PASSWORD: string;
  POSTGRES_DB: string;
  FREELLM_API_BASE_URL: string;
  FREELLM_API_KEY: string;
  FREELLM_MODEL: string;
  SESSION_SECRET: string;
  SESSION_MAX_AGE_MS: number;
  RATE_LIMIT_WINDOW_MS: number;
  RATE_LIMIT_MAX_REQUESTS: number;
  DAILY_QUOTA_DEFAULT: number;
  MONTHLY_QUOTA_DEFAULT: number;
  ADMIN_BOOTSTRAP_EMAIL: string;
  ADMIN_BOOTSTRAP_PASSWORD: string;
  ADMIN_BOOTSTRAP_NAME: string;
  DB_URL: string;
}

// Build the required environment variables.
const env: Env = {
  PORT: Number(process.env.PORT ?? 3000),

  POSTGRES_HOST: process.env.POSTGRES_HOST ?? "postgres",
  POSTGRES_PORT: Number(process.env.POSTGRES_PORT ?? 5432),
  POSTGRES_USER: process.env.POSTGRES_USER ?? "",
  POSTGRES_PASSWORD: process.env.POSTGRES_PASSWORD ?? "",
  POSTGRES_DB: process.env.POSTGRES_DB ?? "",

  FREELLM_API_BASE_URL:
    process.env.FREELLM_API_BASE_URL ??
    "http://host.docker.internal:31415/v1",
  FREELLM_API_KEY: process.env.FREELLM_API_KEY ?? "",
  FREELLM_MODEL: process.env.FREELLM_MODEL ?? "auto",

  SESSION_SECRET: process.env.SESSION_SECRET ?? "",
  SESSION_MAX_AGE_MS: Number(process.env.SESSION_MAX_AGE_MS ?? 86400000), // 24h
  RATE_LIMIT_WINDOW_MS: Number(process.env.RATE_LIMIT_WINDOW_MS ?? 900000), // 15min
  RATE_LIMIT_MAX_REQUESTS: Number(process.env.RATE_LIMIT_MAX_REQUESTS ?? 30),
  DAILY_QUOTA_DEFAULT: Number(process.env.DAILY_QUOTA_DEFAULT ?? 20),
  MONTHLY_QUOTA_DEFAULT: Number(process.env.MONTHLY_QUOTA_DEFAULT ?? 500),
  ADMIN_BOOTSTRAP_EMAIL: process.env.ADMIN_BOOTSTRAP_EMAIL ?? "",
  ADMIN_BOOTSTRAP_PASSWORD: process.env.ADMIN_BOOTSTRAP_PASSWORD ?? "",
  ADMIN_BOOTSTRAP_NAME: process.env.ADMIN_BOOTSTRAP_NAME ?? "Administrator",
  DB_URL:
    process.env.DB_URL ??
    `postgresql://${process.env.POSTGRES_USER ?? ""}:${process.env.POSTGRES_PASSWORD ?? ""}@${process.env.POSTGRES_HOST ?? "postgres"}:${process.env.POSTGRES_PORT ?? 5432}/${process.env.POSTGRES_DB ?? ""}`,
};

// Validate required PostgreSQL environment variables.
if (
  !env.POSTGRES_USER ||
  !env.POSTGRES_PASSWORD ||
  !env.POSTGRES_DB
) {
  throw new Error(
    "Missing required PostgreSQL environment variables. Check .env and .env.example"
  );
}

// SESSION_SECRET is required for session-based auth.
// In development, fall back to a generated value so the app can start without
// the owner having to configure it. In production, a missing value is fatal.
if (!env.SESSION_SECRET) {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "SESSION_SECRET is required in production. Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
    );
  }
  // Dev fallback — only safe because sessions are short-lived and local.
  env.SESSION_SECRET = randomBytes(32).toString("hex");
  console.warn(
    "SESSION_SECRET not set — using a generated dev-only value. Set SESSION_SECRET in .env for production."
  );
}

export default env;