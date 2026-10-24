import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// Load root .env if present before importing config
const currentDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(currentDir, "../../../");
dotenv.config({ path: resolve(projectRoot, ".env") });

// Ensure non-DB diagnostic script can load even if POSTGRES_* vars are not set in shell
process.env.POSTGRES_USER = process.env.POSTGRES_USER || "ars_llm_user";
process.env.POSTGRES_PASSWORD =
  process.env.POSTGRES_PASSWORD || "diagnostic_placeholder_db_pass";
process.env.POSTGRES_DB = process.env.POSTGRES_DB || "ars_llm_db";

async function main() {
  const { verifyFreeLlmConnection } = await import("../services/freeLlm.js");

  const targetBaseUrl =
    process.env.FREELLM_API_BASE_URL?.trim() ||
    "https://v7skvft7-31415.euw.devtunnels.ms/v1";
  const targetModel = process.env.FREELLM_MODEL?.trim() || "auto";
  const rawApiKey = process.env.FREELLM_API_KEY?.trim() || "";

  const report = await verifyFreeLlmConnection({
    FREELLM_API_BASE_URL: targetBaseUrl,
    FREELLM_MODEL: targetModel,
    FREELLM_API_KEY: rawApiKey,
    FREELLM_TIMEOUT_MS: 25_000,
  });

  // Output sanitized JSON report (never includes FREELLM_API_KEY)
  console.log(JSON.stringify(report, null, 2));

  if (!report.modelsCheck.ok || !report.completionCheck.ok) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(
    "FreeLLM verification script error:",
    err instanceof Error ? err.message : "Unknown error"
  );
  process.exitCode = 1;
});
