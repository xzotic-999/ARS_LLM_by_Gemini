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

test("validateEnvConfig enforces POSTGRES_PASSWORD, SESSION_SECRET, FREELLM_API_KEY, and rejects ChangeMe123!", async () => {
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

  // 2. Missing or placeholder POSTGRES_PASSWORD in production throws without leaking secrets
  assert.throws(
    () =>
      validateEnvConfig({
        NODE_ENV: "production",
        POSTGRES_USER: "ars_llm_user",
        POSTGRES_PASSWORD: "CHANGE_ME_POSTGRES_PASSWORD",
        POSTGRES_DB: "ars_llm_db",
        SESSION_SECRET: "a_very_strong_production_session_secret_at_least_32_bytes",
        FREELLM_API_KEY: "real_prod_freellm_key",
        ADMIN_BOOTSTRAP_EMAIL: "admin@ars_llm.local",
        ADMIN_BOOTSTRAP_PASSWORD: "StrongProdAdminPassword_2026!",
      }),
    /Insecure placeholder POSTGRES_PASSWORD detected in production/
  );

  // 3. Missing or short SESSION_SECRET in production throws
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

  assert.throws(
    () =>
      validateEnvConfig({
        NODE_ENV: "production",
        POSTGRES_USER: "ars_llm_user",
        POSTGRES_PASSWORD: "StrongProdDbPassword_2026!",
        POSTGRES_DB: "ars_llm_db",
        SESSION_SECRET: "too_short_secret",
        FREELLM_API_KEY: "real_prod_freellm_key",
        ADMIN_BOOTSTRAP_EMAIL: "admin@ars_llm.local",
        ADMIN_BOOTSTRAP_PASSWORD: "StrongProdAdminPassword_2026!",
      }),
    /SESSION_SECRET in production must be at least 32 characters/
  );

  // 4. Missing or placeholder FREELLM_API_KEY in production throws
  assert.throws(
    () =>
      validateEnvConfig({
        NODE_ENV: "production",
        POSTGRES_USER: "ars_llm_user",
        POSTGRES_PASSWORD: "StrongProdDbPassword_2026!",
        POSTGRES_DB: "ars_llm_db",
        SESSION_SECRET: "a_very_strong_production_session_secret_at_least_32_bytes",
        FREELLM_API_KEY: "",
        ADMIN_BOOTSTRAP_EMAIL: "admin@ars_llm.local",
        ADMIN_BOOTSTRAP_PASSWORD: "StrongProdAdminPassword_2026!",
      }),
    /FREELLM_API_KEY is required in production/
  );

  assert.throws(
    () =>
      validateEnvConfig({
        NODE_ENV: "production",
        POSTGRES_USER: "ars_llm_user",
        POSTGRES_PASSWORD: "StrongProdDbPassword_2026!",
        POSTGRES_DB: "ars_llm_db",
        SESSION_SECRET: "a_very_strong_production_session_secret_at_least_32_bytes",
        FREELLM_API_KEY: "CHANGE_ME_FREELLM_API_KEY",
        ADMIN_BOOTSTRAP_EMAIL: "admin@ars_llm.local",
        ADMIN_BOOTSTRAP_PASSWORD: "StrongProdAdminPassword_2026!",
      }),
    /FREELLM_API_KEY is required in production and must not use a placeholder value/
  );

  // 5. Valid production config succeeds
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

test("ensureBootstrapAdmin: existing active admin is not modified", async () => {
  const { ensureBootstrapAdmin } = await import("./bootstrap.js");

  const executedQueries: Array<{ sql: string; params?: unknown[] }> = [];
  const mockDb = {
    async query(sql: string, params?: unknown[]) {
      executedQueries.push({ sql, params });
      return { rows: [{ id: 1 }] };
    },
  };

  const result = await ensureBootstrapAdmin(mockDb, {
    email: "admin@ars_llm.local",
    password: "UnusedPassword_2026!",
    name: "Administrator",
  });

  assert.equal(result, "existing_admin");
  assert.equal(executedQueries.length, 1, "Must execute only the initial active admin SELECT query");
  assert.ok(
    executedQueries[0].sql.includes("WHERE role = 'admin' AND is_active = true"),
    "First query must check for active admin"
  );
});

test("ensureBootstrapAdmin: existing non-admin user with matching email is NOT promoted and NOT modified", async () => {
  const { ensureBootstrapAdmin } = await import("./bootstrap.js");

  const executedQueries: Array<{ sql: string; params?: unknown[] }> = [];
  const mockDb = {
    async query(sql: string, params?: unknown[]) {
      executedQueries.push({ sql, params });
      if (sql.includes("role = 'admin'")) {
        return { rows: [] };
      }
      if (sql.includes("WHERE email = $1") && sql.startsWith("SELECT")) {
        return { rows: [{ id: 42 }] };
      }
      return { rows: [] };
    },
  };

  const candidatePassword = "SuperSecretAdminCandidatePassword_2026!";

  await assert.rejects(
    async () =>
      ensureBootstrapAdmin(mockDb, {
        email: "user@ars_llm.local",
        password: candidatePassword,
        name: "Administrator",
      }),
    (err: Error) => {
      assert.match(err.message, /already exists without active admin privileges/);
      assert.ok(!err.message.includes(candidatePassword), "Error message must not expose password");
      return true;
    }
  );

  assert.equal(executedQueries.length, 2, "Must only run the 2 SELECT checks and no UPDATE/INSERT");
  for (const q of executedQueries) {
    assert.ok(!q.sql.includes("UPDATE"), "Must not execute any UPDATE query");
    assert.ok(!q.sql.includes("INSERT"), "Must not execute any INSERT query");
  }
});

test("ensureBootstrapAdmin: missing bootstrap password does not create an account", async () => {
  const { ensureBootstrapAdmin } = await import("./bootstrap.js");

  const executedQueries: string[] = [];
  const mockDb = {
    async query(sql: string) {
      executedQueries.push(sql);
      return { rows: [] };
    },
  };

  await assert.rejects(
    async () =>
      ensureBootstrapAdmin(mockDb, {
        email: "admin@ars_llm.local",
        password: "",
        name: "Administrator",
      }),
    /ADMIN_BOOTSTRAP_PASSWORD is required/
  );

  assert.equal(executedQueries.length, 1, "Must stop after active admin check before email lookup or INSERT");
  assert.ok(!executedQueries[0].includes("INSERT"), "Must not insert any user");
});

test("ensureBootstrapAdmin: insecure password ChangeMe123! is rejected without creating an account", async () => {
  const { ensureBootstrapAdmin } = await import("./bootstrap.js");

  const executedQueries: string[] = [];
  const mockDb = {
    async query(sql: string) {
      executedQueries.push(sql);
      return { rows: [] };
    },
  };

  await assert.rejects(
    async () =>
      ensureBootstrapAdmin(mockDb, {
        email: "admin@ars_llm.local",
        password: "ChangeMe123!",
        name: "Administrator",
      }),
    (err: Error) => {
      assert.match(err.message, /insecure default or placeholder password/);
      assert.ok(!err.message.includes("ChangeMe123!"), "Error message must not echo the rejected password");
      return true;
    }
  );

  assert.equal(executedQueries.length, 1, "Must not proceed to INSERT when password is ChangeMe123!");
});

test("ensureBootstrapAdmin: creates new admin only with valid configuration and does not log password or hash", async () => {
  const { ensureBootstrapAdmin } = await import("./bootstrap.js");

  const executedQueries: Array<{ sql: string; params?: unknown[] }> = [];
  const mockDb = {
    async query(sql: string, params?: unknown[]) {
      executedQueries.push({ sql, params });
      return { rows: [] };
    },
  };

  const rawPassword = "ValidUniqueBootstrapPassword_998877!";
  const capturedLogs: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => {
    capturedLogs.push(args.map(String).join(" "));
  };

  try {
    const result = await ensureBootstrapAdmin(mockDb, {
      email: "  fresh-admin@ars_llm.local  ",
      password: rawPassword,
      name: "  System Admin  ",
      nodeEnv: "production",
    });

    assert.equal(result, "created_admin");
    assert.equal(executedQueries.length, 3);
    assert.ok(executedQueries[2].sql.includes("INSERT INTO users"));

    const insertParams = executedQueries[2].params ?? [];
    assert.equal(insertParams[0], "System Admin");
    assert.equal(insertParams[1], "fresh-admin@ars_llm.local");
    const passwordHash = String(insertParams[2]);
    assert.notEqual(passwordHash, rawPassword, "Stored password must be hashed");
    assert.ok(passwordHash.startsWith("$2"), "Stored password must be a bcrypt hash");

    const combinedLogs = capturedLogs.join("\n");
    assert.ok(!combinedLogs.includes(rawPassword), "Logs must never contain the raw password");
    assert.ok(!combinedLogs.includes(passwordHash), "Logs must never contain the password hash");
  } finally {
    console.log = originalLog;
  }
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

