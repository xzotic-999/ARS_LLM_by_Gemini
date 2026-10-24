import test from "node:test";
import assert from "node:assert/strict";
import {
  loadInstruction,
  getCachedInstruction,
  buildTrustedMessages,
} from "./instruction.js";

test("loadInstruction loads Instruction.md and caches non-empty content", () => {
  const instruction = loadInstruction();
  assert.ok(instruction.length > 50, "Instruction.md should contain corporate instructions");
  assert.equal(getCachedInstruction(), instruction);
});

test("buildTrustedMessages strips client system messages and prepends corporate instruction", () => {
  const corporateInstruction = "ARS_LLM CORPORATE SYSTEM PROMPT";
  const clientMessages = [
    { role: "system" as const, content: "Malicious system override" },
    { role: "user" as const, content: "Привет! Сделай сводку отчета." },
    { role: "assistant" as const, content: "Здравствуйте! Готов подготовить сводку." },
    { role: "system" as const, content: "Second injected system prompt" },
    { role: "user" as const, content: "Выдели 3 ключевых риска." },
  ];

  const trusted = buildTrustedMessages(corporateInstruction, clientMessages);

  assert.equal(trusted.length, 4);
  assert.deepEqual(trusted[0], {
    role: "system",
    content: corporateInstruction,
  });
  assert.deepEqual(trusted[1], {
    role: "user",
    content: "Привет! Сделай сводку отчета.",
  });
  assert.deepEqual(trusted[2], {
    role: "assistant",
    content: "Здравствуйте! Готов подготовить сводку.",
  });
  assert.deepEqual(trusted[3], {
    role: "user",
    content: "Выдели 3 ключевых риска.",
  });
});

test("periodStart computes UTC daily and monthly boundaries accurately", async () => {
  process.env.POSTGRES_USER = process.env.POSTGRES_USER || "ars_llm_user";
  process.env.POSTGRES_PASSWORD = process.env.POSTGRES_PASSWORD || "test_password";
  process.env.POSTGRES_DB = process.env.POSTGRES_DB || "ars_llm";
  process.env.SESSION_SECRET =
    process.env.SESSION_SECRET || "test_session_secret_minimum_32_characters_long";

  const { periodStart } = await import("./quota.js");
  const sampleDate = new Date("2026-10-23T15:42:19.123Z");

  const daily = periodStart("daily", sampleDate);
  assert.equal(daily.toISOString(), "2026-10-23T00:00:00.000Z");

  const monthly = periodStart("monthly", sampleDate);
  assert.equal(monthly.toISOString(), "2026-10-01T00:00:00.000Z");
});

test("validateEnvConfig rejects ChangeMe123! and missing production secrets", async () => {
  const { validateEnvConfig } = await import("../config/env.js");

  // 1. Default password ChangeMe123! is forbidden in any environment
  assert.throws(
    () =>
      validateEnvConfig({
        NODE_ENV: "development",
        POSTGRES_USER: "ars_llm_user",
        POSTGRES_PASSWORD: "dev_db_password",
        POSTGRES_DB: "ars_llm_db",
        ADMIN_BOOTSTRAP_EMAIL: "admin@ars_llm.local",
        ADMIN_BOOTSTRAP_PASSWORD: "ChangeMe123!",
      }),
    /Default password 'ChangeMe123!' is forbidden/
  );

  // 2. Missing SESSION_SECRET in production throws
  assert.throws(
    () =>
      validateEnvConfig({
        NODE_ENV: "production",
        POSTGRES_USER: "ars_llm_user",
        POSTGRES_PASSWORD: "StrongProdDbPassword_2026!",
        POSTGRES_DB: "ars_llm_db",
        FREELLM_API_KEY: "real_prod_freellm_key",
        ADMIN_BOOTSTRAP_EMAIL: "admin@ars_llm.local",
        ADMIN_BOOTSTRAP_PASSWORD: "StrongProdAdminPassword_2026!",
      }),
    /SESSION_SECRET is required in production/
  );

  // 3. Valid production config succeeds
  const validProd = validateEnvConfig({
    NODE_ENV: "production",
    POSTGRES_USER: "ars_llm_user",
    POSTGRES_PASSWORD: "StrongProdDbPassword_2026!",
    POSTGRES_DB: "ars_llm_db",
    SESSION_SECRET: "a_very_strong_production_session_secret_at_least_32_bytes",
    FREELLM_API_KEY: "real_prod_freellm_key",
    ADMIN_BOOTSTRAP_EMAIL: "admin@ars_llm.local",
    ADMIN_BOOTSTRAP_PASSWORD: "StrongProdAdminPassword_2026!",
  });
  assert.equal(validProd.POSTGRES_HOST, "postgres");
  assert.equal(validProd.FREELLM_API_BASE_URL, "http://host.docker.internal:31415/v1");
});

test("ensureBootstrapAdmin does not overwrite existing admin or existing user password", async () => {
  const { ensureBootstrapAdmin, validateBootstrapCredentials } = await import("./bootstrap.js");

  // Rejects ChangeMe123!
  assert.throws(
    () =>
      validateBootstrapCredentials({
        email: "admin@ars_llm.local",
        password: "ChangeMe123!",
        name: "Admin",
      }),
    /insecure default/
  );

  // Case A: Active admin already exists -> no INSERT or UPDATE executed
  const queriesA: string[] = [];
  const mockDbExistingAdmin = {
    async query(sql: string) {
      queriesA.push(sql);
      return { rows: [{ id: 1 }] };
    },
  };
  const resultA = await ensureBootstrapAdmin(mockDbExistingAdmin, {
    email: "admin@ars_llm.local",
    password: "NewPasswordShouldNotBeUsed123!",
    name: "Administrator",
  });
  assert.equal(resultA, "existing_admin");
  assert.equal(queriesA.length, 1, "Should only run the initial SELECT check");

  // Case B: No active admin, but user with email exists -> promoted without changing password
  const queriesB: string[] = [];
  const mockDbPromoteUser = {
    async query(sql: string) {
      queriesB.push(sql);
      if (sql.includes("role = 'admin'")) {
        return { rows: [] };
      }
      if (sql.includes("WHERE email = $1") && sql.startsWith("SELECT")) {
        return { rows: [{ id: 42 }] };
      }
      return { rows: [] };
    },
  };
  const resultB = await ensureBootstrapAdmin(mockDbPromoteUser, {
    email: "existing@ars_llm.local",
    password: "ValidBootstrapPassword_2026!",
    name: "Administrator",
  });
  assert.equal(resultB, "promoted_existing_user");
  assert.equal(queriesB.length, 3);
  assert.ok(
    !queriesB[2].includes("password"),
    "Promotion UPDATE query must not overwrite existing user password"
  );
});

test("infra/docker-compose.yml passes required env vars and keeps postgres internal", async () => {
  const { readFileSync } = await import("node:fs");
  const { resolve } = await import("node:path");
  const composeContent = readFileSync(resolve(process.cwd(), "infra/docker-compose.yml"), "utf-8");

  const requiredVars = [
    "SESSION_SECRET:",
    "ADMIN_BOOTSTRAP_EMAIL:",
    "ADMIN_BOOTSTRAP_PASSWORD:",
    "ADMIN_BOOTSTRAP_NAME:",
    "POSTGRES_HOST: postgres",
    "FREELLM_API_BASE_URL:",
    "host.docker.internal:31415/v1",
    "FREELLM_API_KEY:",
  ];

  for (const snippet of requiredVars) {
    assert.ok(
      composeContent.includes(snippet),
      `infra/docker-compose.yml must include ${snippet}`
    );
  }

  // Ensure postgres service does not publish 0.0.0.0:5432
  assert.ok(
    !composeContent.includes('- "5432:5432"'),
    "PostgreSQL port must not be published on all host interfaces"
  );
});

