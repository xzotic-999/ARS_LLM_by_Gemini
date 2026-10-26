import { Pool, type PoolConfig } from "pg";
import env, { type Env } from "../config/index.js";

/**
 * Builds a deterministic pg.PoolConfig for both standard PostgreSQL and
 * Neon serverless/pooler connections.
 *
 * Strips `sslmode`, `ssl`, and `channel_binding` query parameters from
 * `connectionString` so `pg-connection-string` does not override the explicit
 * `ssl: { rejectUnauthorized }` configuration derived from `env`.
 */
export function buildPgPoolConfig(envConfig: Env = env): PoolConfig {
  let connectionString = envConfig.DB_URL;
  let urlRequiresSsl = false;
  let urlDisablesSsl = false;

  try {
    const parsed = new URL(connectionString);
    const sslMode = (parsed.searchParams.get("sslmode") ?? "").toLowerCase();
    const sslParam = (parsed.searchParams.get("ssl") ?? "").toLowerCase();
    if (sslMode === "disable" || sslParam === "false" || sslParam === "0") {
      urlDisablesSsl = true;
    } else if (
      sslMode === "require" ||
      sslMode === "verify-ca" ||
      sslMode === "verify-full" ||
      sslMode === "prefer" ||
      sslParam === "true" ||
      sslParam === "1" ||
      parsed.hostname.toLowerCase().endsWith(".neon.tech")
    ) {
      urlRequiresSsl = true;
    }
    parsed.searchParams.delete("sslmode");
    parsed.searchParams.delete("ssl");
    parsed.searchParams.delete("channel_binding");
    connectionString = parsed.toString();
  } catch {
    // Keep original connectionString if not parseable as standard URL
  }

  const enableSsl = !urlDisablesSsl && (Boolean(envConfig.POSTGRES_SSL) || urlRequiresSsl);
  const rejectUnauthorized =
    envConfig.POSTGRES_SSL_REJECT_UNAUTHORIZED !== undefined
      ? envConfig.POSTGRES_SSL_REJECT_UNAUTHORIZED
      : true;

  return {
    connectionString,
    user: envConfig.POSTGRES_USER,
    host: envConfig.POSTGRES_HOST,
    database: envConfig.POSTGRES_DB,
    password: envConfig.POSTGRES_PASSWORD,
    port: envConfig.POSTGRES_PORT,
    max: 10,
    keepAlive: true,
    connectionTimeoutMillis: 15_000,
    idleTimeoutMillis: 30_000,
    ...(enableSsl
      ? {
          ssl: {
            rejectUnauthorized,
          },
        }
      : {}),
  };
}

export const pool = new Pool(buildPgPoolConfig(env));

// Prevent unhandled error crashes when Neon serverless pooler closes idle connections
pool.on("error", (err) => {
  console.error("PostgreSQL pool idle client error:", err.message);
});
