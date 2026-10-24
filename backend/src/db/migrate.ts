import dotenv from "dotenv";
import { existsSync } from "node:fs";
import { runner } from "node-pg-migrate";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import env from "../config/index.js";

const currentDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(currentDir, "../../../");
dotenv.config({ path: resolve(projectRoot, ".env") });

// Resolve SQL migrations directory across source (backend/src/migrations) and Docker (dist/migrations).
const candidateDirs = [
  resolve(currentDir, "../migrations"),
  resolve(projectRoot, "backend/src/migrations"),
];
const migrationsDir = candidateDirs.find((d) => existsSync(d)) ?? candidateDirs[0];

export async function runMigrations(): Promise<string[]> {
  const result = await runner({
    migrationsTable: "migrations",
    dir: migrationsDir,
    databaseUrl: env.DB_URL,
    direction: "up",
    log: console.log,
  });
  const applied = result.map((r) => r.name);
  console.log("Migrations applied:", applied);
  return applied;
}

const isDirectRun =
  process.argv[1] &&
  resolve(process.argv[1]).replace(/\\/g, "/") ===
    fileURLToPath(import.meta.url).replace(/\\/g, "/");

if (isDirectRun) {
  runMigrations().catch((err) => {
    console.error("Migration error", err);
    process.exit(1);
  });
}

