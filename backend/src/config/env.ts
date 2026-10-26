import dotenv from "dotenv";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const currentDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(currentDir, "../../../");

/**
 * Resolves all candidate .env file locations across project root, backend root,
 * and current working directory so both Phusion Passenger (Plesk) and CLI scripts
 * (`npm run migrate:backend` / `node dist/db/migrate.js`) find `.env` reliably.
 */
export function resolveEnvFilePaths(
  baseDir: string = currentDir,
  cwd: string = process.cwd()
): string[] {
  const candidates = [
    process.env.DOTENV_CONFIG_PATH ? resolve(cwd, process.env.DOTENV_CONFIG_PATH) : "",
    resolve(cwd, ".env"),
    resolve(cwd, "backend/.env"),
    resolve(cwd, "../.env"),
    resolve(baseDir, "../../../.env"), // project root from backend/src/config or backend/dist/config
    resolve(baseDir, "../../.env"),    // backend/.env from backend/src/config or backend/dist/config
  ].filter(Boolean);
  return Array.from(new Set(candidates));
}

export function loadDotEnvFiles(
  baseDir: string = currentDir,
  cwd: string = process.cwd()
): string[] {
  const loaded: string[] = [];
  for (const envPath of resolveEnvFilePaths(baseDir, cwd)) {
    if (existsSync(envPath)) {
      dotenv.config({ path: envPath, override: false });
      loaded.push(envPath);
    }
  }
  return loaded;
}

loadDotEnvFiles();

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
  WEATHER_API_BASE_URL: string;
  WEATHER_GEOCODING_BASE_URL: string;
  OPEN_METEO_API_KEY: string;
  EXCHANGE_RATE_API_BASE_URL: string;
  EXCHANGE_RATE_FALLBACK_BASE_URL: string;
  EXCHANGE_RATE_API_KEY: string;
  EXTERNAL_TOOLS_TIMEOUT_MS: number;
  EXTERNAL_TOOLS_CACHE_TTL_MS: number;
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

function stripSurroundingQuotes(value: string | undefined): string {
  if (!value) return "";
  const trimmed = value.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

/**
 * Returns true if the given hostname points to the developer's local machine
 * or Docker Desktop host bridge.
 */
export function isDeveloperLocalHost(hostname: string): boolean {
  const normalized = stripSurroundingQuotes(hostname).toLowerCase();
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
    parsed = new URL(stripSurroundingQuotes(urlString));
  } catch {
    throw new Error(`Invalid URL format: ${urlString}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`URL must use http or https protocol: ${urlString}`);
  }
  return isDeveloperLocalHost(parsed.hostname);
}

function parseBool(value: string | undefined, defaultValue: boolean): boolean {
  const cleaned = stripSurroundingQuotes(value);
  if (!cleaned) return defaultValue;
  const normalized = cleaned.toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes";
}

/**
 * Validates environment configuration and throws a descriptive error if
 * mandatory variables are missing, insecure default values are used, or
 * production configuration depends on the developer's local computer.
 */
export function validateEnvConfig(rawEnv: NodeJS.ProcessEnv): Env {
  const nodeEnv = stripSurroundingQuotes(rawEnv.NODE_ENV) || "development";
  const isProd = nodeEnv === "production";

  const candidateDatabaseUrl = stripSurroundingQuotes(
    rawEnv.DATABASE_URL ?? rawEnv.POSTGRES_URL ?? rawEnv.NEON_DATABASE_URL
  );
  const candidateLegacyDbUrl = stripSurroundingQuotes(rawEnv.DB_URL);

  // Prefer DATABASE_URL over legacy DB_URL (especially if DB_URL still holds the .env.example placeholder)
  const explicitDbUrl =
    candidateDatabaseUrl ||
    (candidateLegacyDbUrl &&
    !candidateLegacyDbUrl.includes("CHANGE_ME_POSTGRES_PASSWORD")
      ? candidateLegacyDbUrl
      : "");

  let postgresHost = stripSurroundingQuotes(rawEnv.POSTGRES_HOST);
  let postgresPort = Number(stripSurroundingQuotes(rawEnv.POSTGRES_PORT) || 5432);
  let postgresUser = stripSurroundingQuotes(rawEnv.POSTGRES_USER);
  let postgresPassword = stripSurroundingQuotes(rawEnv.POSTGRES_PASSWORD);
  let postgresDb = stripSurroundingQuotes(rawEnv.POSTGRES_DB);
  let urlImpliesSsl = false;
  let urlDisablesSsl = false;

  if (explicitDbUrl) {
    try {
      const parsedDb = new URL(explicitDbUrl);
      postgresHost = parsedDb.hostname;
      postgresPort = parsedDb.port ? Number(parsedDb.port) : 5432;
      postgresUser = decodeURIComponent(parsedDb.username);
      postgresPassword = decodeURIComponent(parsedDb.password);
      postgresDb = decodeURIComponent(parsedDb.pathname.replace(/^\/+/, ""));

      const sslMode = (parsedDb.searchParams.get("sslmode") ?? "").toLowerCase();
      const sslParam = (parsedDb.searchParams.get("ssl") ?? "").toLowerCase();
      if (sslMode === "disable" || sslParam === "false" || sslParam === "0") {
        urlDisablesSsl = true;
      } else if (
        sslMode === "require" ||
        sslMode === "verify-ca" ||
        sslMode === "verify-full" ||
        sslMode === "prefer" ||
        sslParam === "true" ||
        sslParam === "1"
      ) {
        urlImpliesSsl = true;
      }
    } catch {
      throw new Error("Invalid DATABASE_URL / DB_URL format.");
    }
  }

  if (!postgresHost) {
    postgresHost = "postgres";
  }

  if (postgresHost.toLowerCase().endsWith(".neon.tech") && !urlDisablesSsl) {
    urlImpliesSsl = true;
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

  let sessionSecret = stripSurroundingQuotes(rawEnv.SESSION_SECRET);
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
  const rawFreeLlmBaseUrl = stripSurroundingQuotes(rawEnv.FREELLM_API_BASE_URL).replace(/\/+$/, "");
  const normalizedRawBaseUrl = rawFreeLlmBaseUrl
    ? rawFreeLlmBaseUrl.endsWith("/v1")
      ? rawFreeLlmBaseUrl
      : `${rawFreeLlmBaseUrl}/v1`
    : "";
  const freeLlmBaseUrl = normalizedRawBaseUrl || DEFAULT_CLOUD_FREELLM_BASE_URL;

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

  const freellmApiKey = stripSurroundingQuotes(rawEnv.FREELLM_API_KEY);
  if (isProd && (!freellmApiKey || INSECURE_SECRET_BLACKLIST.has(freellmApiKey))) {
    throw new Error(
      "FREELLM_API_KEY is required in production and must not use a placeholder value."
    );
  }

  const fallbackBaseUrl = stripSurroundingQuotes(rawEnv.FREELLM_FALLBACK_BASE_URL);
  if (fallbackBaseUrl) {
    const isLocalFallback = isDeveloperLocalUrl(fallbackBaseUrl);
    if (isProd && isLocalFallback) {
      throw new Error(
        "FREELLM_FALLBACK_BASE_URL in production cannot use localhost, 127.0.0.1, or host.docker.internal."
      );
    }
  }

  const adminBootstrapEmail = stripSurroundingQuotes(rawEnv.ADMIN_BOOTSTRAP_EMAIL);
  const adminBootstrapPassword = stripSurroundingQuotes(rawEnv.ADMIN_BOOTSTRAP_PASSWORD);

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

  const postgresSsl = urlDisablesSsl
    ? false
    : urlImpliesSsl
      ? true
      : parseBool(rawEnv.POSTGRES_SSL, false);

  const dbUrl =
    explicitDbUrl ||
    `postgresql://${encodeURIComponent(postgresUser)}:${encodeURIComponent(postgresPassword)}@${postgresHost}:${postgresPort}/${postgresDb}`;

  return {
    NODE_ENV: nodeEnv,
    PORT: Number(stripSurroundingQuotes(rawEnv.PORT) || 3000),
    TRUST_PROXY: parseBool(rawEnv.TRUST_PROXY, isProd),
    CORS_ORIGIN: stripSurroundingQuotes(rawEnv.CORS_ORIGIN),
    SERVE_STATIC_SPA: parseBool(rawEnv.SERVE_STATIC_SPA, isProd),
    FRONTEND_DIST_PATH: stripSurroundingQuotes(rawEnv.FRONTEND_DIST_PATH),
    AUTO_MIGRATE: parseBool(rawEnv.AUTO_MIGRATE, isProd),
    POSTGRES_HOST: postgresHost,
    POSTGRES_PORT: postgresPort,
    POSTGRES_USER: postgresUser,
    POSTGRES_PASSWORD: postgresPassword,
    POSTGRES_DB: postgresDb,
    POSTGRES_SSL: postgresSsl,
    POSTGRES_SSL_REJECT_UNAUTHORIZED: parseBool(
      rawEnv.POSTGRES_SSL_REJECT_UNAUTHORIZED,
      true
    ),
    FREELLM_API_BASE_URL: freeLlmBaseUrl,
    FREELLM_API_KEY: freellmApiKey,
    FREELLM_MODEL: stripSurroundingQuotes(rawEnv.FREELLM_MODEL) || "auto",
    FREELLM_TIMEOUT_MS: Number(stripSurroundingQuotes(rawEnv.FREELLM_TIMEOUT_MS) || 120_000),
    FREELLM_FALLBACK_BASE_URL: fallbackBaseUrl,
    FREELLM_FALLBACK_API_KEY: stripSurroundingQuotes(rawEnv.FREELLM_FALLBACK_API_KEY),
    FREELLM_FALLBACK_MODEL: stripSurroundingQuotes(rawEnv.FREELLM_FALLBACK_MODEL) || "auto",
    SESSION_SECRET: sessionSecret,
    SESSION_MAX_AGE_MS: Number(stripSurroundingQuotes(rawEnv.SESSION_MAX_AGE_MS) || 86400000),
    RATE_LIMIT_WINDOW_MS: Number(stripSurroundingQuotes(rawEnv.RATE_LIMIT_WINDOW_MS) || 900000),
    RATE_LIMIT_MAX_REQUESTS: Number(stripSurroundingQuotes(rawEnv.RATE_LIMIT_MAX_REQUESTS) || 30),
    DAILY_QUOTA_DEFAULT: Number(stripSurroundingQuotes(rawEnv.DAILY_QUOTA_DEFAULT) || 20),
    MONTHLY_QUOTA_DEFAULT: Number(stripSurroundingQuotes(rawEnv.MONTHLY_QUOTA_DEFAULT) || 500),
    ADMIN_BOOTSTRAP_EMAIL: adminBootstrapEmail,
    ADMIN_BOOTSTRAP_PASSWORD: adminBootstrapPassword,
    ADMIN_BOOTSTRAP_NAME:
      stripSurroundingQuotes(rawEnv.ADMIN_BOOTSTRAP_NAME) || "Administrator",
    DB_URL: dbUrl,
    WEATHER_API_BASE_URL:
      stripSurroundingQuotes(rawEnv.WEATHER_API_BASE_URL) ||
      "https://api.open-meteo.com/v1",
    WEATHER_GEOCODING_BASE_URL:
      stripSurroundingQuotes(rawEnv.WEATHER_GEOCODING_BASE_URL) ||
      "https://geocoding-api.open-meteo.com/v1",
    OPEN_METEO_API_KEY: stripSurroundingQuotes(rawEnv.OPEN_METEO_API_KEY),
    EXCHANGE_RATE_API_BASE_URL:
      stripSurroundingQuotes(rawEnv.EXCHANGE_RATE_API_BASE_URL) ||
      "https://open.er-api.com/v6/latest",
    EXCHANGE_RATE_FALLBACK_BASE_URL:
      stripSurroundingQuotes(rawEnv.EXCHANGE_RATE_FALLBACK_BASE_URL) ||
      "https://api.frankfurter.dev/v1/latest",
    EXCHANGE_RATE_API_KEY: stripSurroundingQuotes(rawEnv.EXCHANGE_RATE_API_KEY),
    EXTERNAL_TOOLS_TIMEOUT_MS: Number(
      stripSurroundingQuotes(rawEnv.EXTERNAL_TOOLS_TIMEOUT_MS) || 6000
    ),
    EXTERNAL_TOOLS_CACHE_TTL_MS: Number(
      stripSurroundingQuotes(rawEnv.EXTERNAL_TOOLS_CACHE_TTL_MS) || 600000
    ),
  };
}

const env: Env = validateEnvConfig(process.env);

export default env;