import dotenv from "dotenv";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// Load the root project .env regardless of the current working directory.
const currentDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(currentDir, "../../../");
dotenv.config({ path: resolve(projectRoot, ".env") });

export interface Env {
  NODE_ENV: string;
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

const INSECURE_PASSWORD_BLACKLIST = new Set([
  "ChangeMe123!",
  "CHANGE_ME_INITIAL_ADMIN_PASSWORD",
  "CHANGE_ME_POSTGRES_PASSWORD",
  "password",
  "admin",
  "123456",
]);

const INSECURE_SECRET_BLACKLIST = new Set([
  "CHANGE_ME_MIN_32_CHARS_SESSION_SECRET_KEY",
  "CHANGE_ME_FREELLM_API_KEY",
  "changeme",
  "secret",
]);

/**
 * Validates environment configuration and throws a descriptive error if
 * mandatory variables are missing or insecure default values are used.
 */
export function validateEnvConfig(rawEnv: NodeJS.ProcessEnv): Env {
  const nodeEnv = rawEnv.NODE_ENV ?? "development";
  const isProd = nodeEnv === "production";

  const postgresHost = rawEnv.POSTGRES_HOST ?? "postgres";
  const postgresPort = Number(rawEnv.POSTGRES_PORT ?? 5432);
  const postgresUser = (rawEnv.POSTGRES_USER ?? "").trim();
  const postgresPassword = rawEnv.POSTGRES_PASSWORD ?? "";
  const postgresDb = (rawEnv.POSTGRES_DB ?? "").trim();

  if (!postgresUser || !postgresPassword || !postgresDb) {
    throw new Error(
      "Missing required PostgreSQL environment variables (POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB). Check .env and .env.example"
    );
  }

  if (isProd && INSECURE_PASSWORD_BLACKLIST.has(postgresPassword)) {
    throw new Error(
      "Insecure placeholder POSTGRES_PASSWORD detected in production. Set a strong secret in .env."
    );
  }

  let sessionSecret = (rawEnv.SESSION_SECRET ?? "").trim();
  if (!sessionSecret) {
    if (isProd) {
      throw new Error(
        "SESSION_SECRET is required in production. Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
      );
    }
    sessionSecret = randomBytes(32).toString("hex");
    console.warn(
      "SESSION_SECRET not set - using a generated dev-only value. Set SESSION_SECRET in .env for production."
    );
  } else if (isProd && (sessionSecret.length < 32 || INSECURE_SECRET_BLACKLIST.has(sessionSecret))) {
    throw new Error(
      "SESSION_SECRET in production must be at least 32 characters and not a placeholder value."
    );
  }

  const freellmApiKey = (rawEnv.FREELLM_API_KEY ?? "").trim();
  if (isProd && (!freellmApiKey || INSECURE_SECRET_BLACKLIST.has(freellmApiKey))) {
    throw new Error(
      "FREELLM_API_KEY is required in production and must not use a placeholder value."
    );
  }

  const adminBootstrapEmail = (rawEnv.ADMIN_BOOTSTRAP_EMAIL ?? "").trim();
  const adminBootstrapPassword = rawEnv.ADMIN_BOOTSTRAP_PASSWORD ?? "";

  if (adminBootstrapPassword === "ChangeMe123!") {
    throw new Error(
      "Default password 'ChangeMe123!' is forbidden. Set a strong ADMIN_BOOTSTRAP_PASSWORD in .env."
    );
  }

  if (isProd) {
    if (!adminBootstrapEmail || !adminBootstrapPassword) {
      throw new Error(
        "ADMIN_BOOTSTRAP_EMAIL and ADMIN_BOOTSTRAP_PASSWORD are required in production."
      );
    }
    if (INSECURE_PASSWORD_BLACKLIST.has(adminBootstrapPassword)) {
      throw new Error(
        "Insecure or placeholder ADMIN_BOOTSTRAP_PASSWORD is forbidden in production."
      );
    }
  }

  return {
    NODE_ENV: nodeEnv,
    PORT: Number(rawEnv.PORT ?? 3000),
    POSTGRES_HOST: postgresHost,
    POSTGRES_PORT: postgresPort,
    POSTGRES_USER: postgresUser,
    POSTGRES_PASSWORD: postgresPassword,
    POSTGRES_DB: postgresDb,
    FREELLM_API_BASE_URL:
      rawEnv.FREELLM_API_BASE_URL ?? "http://host.docker.internal:31415/v1",
    FREELLM_API_KEY: freellmApiKey,
    FREELLM_MODEL: rawEnv.FREELLM_MODEL ?? "auto",
    SESSION_SECRET: sessionSecret,
    SESSION_MAX_AGE_MS: Number(rawEnv.SESSION_MAX_AGE_MS ?? 86400000),
    RATE_LIMIT_WINDOW_MS: Number(rawEnv.RATE_LIMIT_WINDOW_MS ?? 900000),
    RATE_LIMIT_MAX_REQUESTS: Number(rawEnv.RATE_LIMIT_MAX_REQUESTS ?? 30),
    DAILY_QUOTA_DEFAULT: Number(rawEnv.DAILY_QUOTA_DEFAULT ?? 20),
    MONTHLY_QUOTA_DEFAULT: Number(rawEnv.MONTHLY_QUOTA_DEFAULT ?? 500),
    ADMIN_BOOTSTRAP_EMAIL: adminBootstrapEmail,
    ADMIN_BOOTSTRAP_PASSWORD: adminBootstrapPassword,
    ADMIN_BOOTSTRAP_NAME: (rawEnv.ADMIN_BOOTSTRAP_NAME ?? "Administrator").trim() || "Administrator",
    DB_URL:
      rawEnv.DB_URL ??
      `postgresql://${postgresUser}:${postgresPassword}@${postgresHost}:${postgresPort}/${postgresDb}`,
  };
}

const env: Env = validateEnvConfig(process.env);

export default env;