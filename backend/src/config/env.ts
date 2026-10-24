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
  TRUST_PROXY: boolean;
  CORS_ORIGIN: string;
  SERVE_STATIC_SPA: boolean;
  FRONTEND_DIST_PATH: string;
  AUTO_MIGRATE: boolean;
  POSTGRES_HOST?: string;
  POSTGRES_PORT: number;
  POSTGRES_USER: string;
  POSTGRES_PASSWORD: string;
  POSTGRES_DB: string;
  POSTGRES_SSL: boolean;
  POSTGRES_SSL_REJECT_UNAUTHORIZED: boolean;
  FREELLM_API_BASE_URL: string;
  FREELLM_API_KEY: string;
  FREELLM_MODEL: string;
  FREELLM_TIMEOUT_MS: number;
  FREELLM_FALLBACK_BASE_URL: string;
  FREELLM_FALLBACK_API_KEY: string;
  FREELLM_FALLBACK_MODEL: string;
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

const DEVELOPER_LOCAL_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "host.docker.internal",
  "::1",
  "[::1]",
]);

/**
 * Returns true if the given hostname points to the developer's local machine
 * or Docker Desktop host bridge.
 */
export function isDeveloperLocalHost(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  if (!normalized) return false;
  if (DEVELOPER_LOCAL_HOSTS.has(normalized)) return true;
  if (normalized.startsWith("127.")) return true;
  return false;
}

/**
 * Validates that a URL is well-formed HTTP(S) and checks whether its hostname
 * points to a developer-local address.
 */
export function isDeveloperLocalUrl(urlString: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(urlString);
  } catch {
    throw new Error(`Invalid URL format: ${urlString}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`URL must use http or https protocol: ${urlString}`);
  }
  return isDeveloperLocalHost(parsed.hostname);
}

function parseBool(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined || value.trim() === "") return defaultValue;
  const normalized = value.trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes";
}

/**
 * Validates environment configuration and throws a descriptive error if
 * mandatory variables are missing, insecure default values are used, or
 * production configuration depends on the developer's local computer.
 */
export function validateEnvConfig(rawEnv: NodeJS.ProcessEnv): Env {
  const nodeEnv = rawEnv.NODE_ENV ?? "development";
  const isProd = nodeEnv === "production";

  const explicitDbUrl = (rawEnv.DATABASE_URL ?? rawEnv.DB_URL ?? "").trim();

  let postgresHost = (rawEnv.POSTGRES_HOST ?? "").trim();
  let postgresPort = Number(rawEnv.POSTGRES_PORT ?? 5432);
  let postgresUser = (rawEnv.POSTGRES_USER ?? "").trim();
  let postgresPassword = rawEnv.POSTGRES_PASSWORD ?? "";
  let postgresDb = (rawEnv.POSTGRES_DB ?? "").trim();

  if (explicitDbUrl) {
    try {
      const parsedDb = new URL(explicitDbUrl);
      if (!postgresHost) postgresHost = parsedDb.hostname;
      if (!rawEnv.POSTGRES_PORT && parsedDb.port) {
        postgresPort = Number(parsedDb.port);
      }
      if (!postgresUser) postgresUser = decodeURIComponent(parsedDb.username);
      if (!postgresPassword) postgresPassword = decodeURIComponent(parsedDb.password);
      if (!postgresDb) postgresDb = parsedDb.pathname.replace(/^\/+/, "");
    } catch {
      throw new Error("Invalid DATABASE_URL / DB_URL format.");
    }
  }

  if (!postgresHost) {
    postgresHost = "postgres";
  }

  if (!postgresUser || !postgresPassword || !postgresDb) {
    throw new Error(
      "Missing required PostgreSQL environment variables (POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB or DATABASE_URL). Check .env and .env.example"
    );
  }

  if (isProd && INSECURE_PASSWORD_BLACKLIST.has(postgresPassword)) {
    throw new Error(
      "Insecure placeholder POSTGRES_PASSWORD detected in production. Set a strong secret in .env."
    );
  }

  if (isProd && isDeveloperLocalHost(postgresHost)) {
    throw new Error(
      "POSTGRES_HOST in production cannot point to localhost, 127.0.0.1, or host.docker.internal. Use a cloud PostgreSQL host or internal service name."
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

  const DEFAULT_CLOUD_FREELLM_BASE_URL =
    "https://v7skvft7-31415.euw.devtunnels.ms/v1";
  const rawFreeLlmBaseUrl = (rawEnv.FREELLM_API_BASE_URL ?? "").trim();
  const freeLlmBaseUrl = rawFreeLlmBaseUrl || DEFAULT_CLOUD_FREELLM_BASE_URL;

  if (!freeLlmBaseUrl) {
    throw new Error(
      "FREELLM_API_BASE_URL is required in production and must point to a remotely hosted AI gateway or OpenAI-compatible API endpoint."
    );
  }

  const isLocalFreeLlm = isDeveloperLocalUrl(freeLlmBaseUrl);
  if (isProd && isLocalFreeLlm) {
    throw new Error(
      "FREELLM_API_BASE_URL in production cannot use localhost, 127.0.0.1, or host.docker.internal. Configure a remotely hosted FreeLLMAPI service or cloud OpenAI-compatible endpoint."
    );
  }

  const freellmApiKey = (rawEnv.FREELLM_API_KEY ?? "").trim();
  if (isProd && (!freellmApiKey || INSECURE_SECRET_BLACKLIST.has(freellmApiKey))) {
    throw new Error(
      "FREELLM_API_KEY is required in production and must not use a placeholder value."
    );
  }

  const fallbackBaseUrl = (rawEnv.FREELLM_FALLBACK_BASE_URL ?? "").trim();
  if (fallbackBaseUrl) {
    const isLocalFallback = isDeveloperLocalUrl(fallbackBaseUrl);
    if (isProd && isLocalFallback) {
      throw new Error(
        "FREELLM_FALLBACK_BASE_URL in production cannot use localhost, 127.0.0.1, or host.docker.internal."
      );
    }
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

  const dbUrl =
    explicitDbUrl ||
    `postgresql://${encodeURIComponent(postgresUser)}:${encodeURIComponent(postgresPassword)}@${postgresHost}:${postgresPort}/${postgresDb}`;

  return {
    NODE_ENV: nodeEnv,
    PORT: Number(rawEnv.PORT ?? 3000),
    TRUST_PROXY: parseBool(rawEnv.TRUST_PROXY, isProd),
    CORS_ORIGIN: (rawEnv.CORS_ORIGIN ?? "").trim(),
    SERVE_STATIC_SPA: parseBool(rawEnv.SERVE_STATIC_SPA, isProd),
    FRONTEND_DIST_PATH: (rawEnv.FRONTEND_DIST_PATH ?? "").trim(),
    AUTO_MIGRATE: parseBool(rawEnv.AUTO_MIGRATE, false),
    POSTGRES_HOST: postgresHost,
    POSTGRES_PORT: postgresPort,
    POSTGRES_USER: postgresUser,
    POSTGRES_PASSWORD: postgresPassword,
    POSTGRES_DB: postgresDb,
    POSTGRES_SSL: parseBool(rawEnv.POSTGRES_SSL, false),
    POSTGRES_SSL_REJECT_UNAUTHORIZED: parseBool(
      rawEnv.POSTGRES_SSL_REJECT_UNAUTHORIZED,
      true
    ),
    FREELLM_API_BASE_URL: freeLlmBaseUrl,
    FREELLM_API_KEY: freellmApiKey,
    FREELLM_MODEL: (rawEnv.FREELLM_MODEL ?? "auto").trim() || "auto",
    FREELLM_TIMEOUT_MS: Number(rawEnv.FREELLM_TIMEOUT_MS ?? 120_000),
    FREELLM_FALLBACK_BASE_URL: fallbackBaseUrl,
    FREELLM_FALLBACK_API_KEY: (rawEnv.FREELLM_FALLBACK_API_KEY ?? "").trim(),
    FREELLM_FALLBACK_MODEL: (rawEnv.FREELLM_FALLBACK_MODEL ?? "auto").trim() || "auto",
    SESSION_SECRET: sessionSecret,
    SESSION_MAX_AGE_MS: Number(rawEnv.SESSION_MAX_AGE_MS ?? 86400000),
    RATE_LIMIT_WINDOW_MS: Number(rawEnv.RATE_LIMIT_WINDOW_MS ?? 900000),
    RATE_LIMIT_MAX_REQUESTS: Number(rawEnv.RATE_LIMIT_MAX_REQUESTS ?? 30),
    DAILY_QUOTA_DEFAULT: Number(rawEnv.DAILY_QUOTA_DEFAULT ?? 20),
    MONTHLY_QUOTA_DEFAULT: Number(rawEnv.MONTHLY_QUOTA_DEFAULT ?? 500),
    ADMIN_BOOTSTRAP_EMAIL: adminBootstrapEmail,
    ADMIN_BOOTSTRAP_PASSWORD: adminBootstrapPassword,
    ADMIN_BOOTSTRAP_NAME:
      (rawEnv.ADMIN_BOOTSTRAP_NAME ?? "Administrator").trim() || "Administrator",
    DB_URL: dbUrl,
  };
}

const env: Env = validateEnvConfig(process.env);

export default env;