import { existsSync } from "node:fs";
import { runner } from "node-pg-migrate";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { loadDotEnvFiles } from "../config/env.js";
import { pool } from "./index.js";

const currentDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(currentDir, "../../../");

loadDotEnvFiles(currentDir);

/**
 * Resolves the SQL migrations directory across compiled (`backend/dist/migrations`),
 * source (`backend/src/migrations`), and Docker (`/app/dist/migrations`) layouts.
 */
export function resolveMigrationsDir(
  baseDir: string = currentDir,
  cwd: string = process.cwd()
): string {
  const candidateDirs = [
    resolve(baseDir, "../migrations"),
    resolve(baseDir, "../../src/migrations"),
    resolve(projectRoot, "backend/src/migrations"),
    resolve(cwd, "backend/src/migrations"),
    resolve(cwd, "src/migrations"),
  ];
  const found = candidateDirs.find((d) => existsSync(d));
  return found ?? candidateDirs[0];
}

export async function runMigrations(
  customClient?: { query: (...args: unknown[]) => Promise<unknown>; release?: () => void }
): Promise<string[]> {
  const migrationsDir = resolveMigrationsDir();
  const client = customClient ?? (await pool.connect());
  try {
    // Ensure migrations tracking table exists with IF NOT EXISTS to avoid race conditions
    // when multiple application instances start concurrently.
    await client.query(
      'CREATE TABLE IF NOT EXISTS "public"."migrations" (id SERIAL PRIMARY KEY, name varchar(255) NOT NULL, run_on timestamp NOT NULL);'
    );

    const executeRunner = async () =>
      runner({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        dbClient: client as any,
        migrationsTable: "migrations",
        dir: migrationsDir,
        direction: "up",
        noLock: true,
        singleTransaction: true,
        log: console.log,
      });

    let result;
    try {
      result = await executeRunner();
    } catch (err) {
      const pgCode = (err as { code?: string } | null)?.code;
      // If another instance concurrently applied migrations at the exact same moment,
      // wait briefly and re-verify that all migrations are now applied.
      if (pgCode === "23505" || pgCode === "42P07" || pgCode === "42710") {
        await new Promise((r) => setTimeout(r, 300));
        result = await executeRunner();
      } else {
        throw err;
      }
    }

    const applied = result.map((r) => r.name);
    console.log("Migrations applied:", applied);
    return applied;
  } finally {
    if (!customClient && "release" in client && typeof client.release === "function") {
      client.release();
    }
  }
}

const isDirectRun =
  process.argv[1] &&
  resolve(process.argv[1]).replace(/\\/g, "/") ===
    fileURLToPath(import.meta.url).replace(/\\/g, "/");

if (isDirectRun) {
  runMigrations()
    .then(async () => {
      await pool.end();
    })
    .catch(async (err) => {
      console.error("Migration error", err);
      await pool.end().catch(() => undefined);
      process.exit(1);
    });
}
