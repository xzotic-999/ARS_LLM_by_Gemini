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
        FREELLM_API_BASE_URL: "https://freellm-gateway.company.kz/v1",
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
        FREELLM_API_BASE_URL: "https://freellm-gateway.company.kz/v1",
        FREELLM_API_KEY: "CHANGE_ME_FREELLM_API_KEY",
        ADMIN_BOOTSTRAP_EMAIL: "admin@ars_llm.local",
        ADMIN_BOOTSTRAP_PASSWORD: "StrongProdAdminPassword_2026!",
      }),
    /FREELLM_API_KEY is required in production and must not use a placeholder value/
  );

  // 5. Developer-local FREELLM_API_BASE_URL or POSTGRES_HOST is rejected in production
  for (const localUrl of [
    "http://host.docker.internal:31415/v1",
    "http://localhost:31415/v1",
    "http://127.0.0.1:31415/v1",
  ]) {
    assert.throws(
      () =>
        validateEnvConfig({
          NODE_ENV: "production",
          POSTGRES_HOST: "postgres",
          POSTGRES_USER: "ars_llm_user",
          POSTGRES_PASSWORD: "StrongProdDbPassword_2026!",
          POSTGRES_DB: "ars_llm_db",
          SESSION_SECRET: "a_very_strong_production_session_secret_at_least_32_bytes",
          FREELLM_API_BASE_URL: localUrl,
          FREELLM_API_KEY: "real_prod_freellm_key",
          ADMIN_BOOTSTRAP_EMAIL: "admin@ars_llm.local",
          ADMIN_BOOTSTRAP_PASSWORD: "StrongProdAdminPassword_2026!",
        }),
      /FREELLM_API_BASE_URL in production cannot use localhost, 127\.0\.0\.1, or host\.docker\.internal/
    );
  }

  assert.throws(
    () =>
      validateEnvConfig({
        NODE_ENV: "production",
        POSTGRES_HOST: "localhost",
        POSTGRES_USER: "ars_llm_user",
        POSTGRES_PASSWORD: "StrongProdDbPassword_2026!",
        POSTGRES_DB: "ars_llm_db",
        SESSION_SECRET: "a_very_strong_production_session_secret_at_least_32_bytes",
        FREELLM_API_BASE_URL: "https://freellm-gateway.company.kz/v1",
        FREELLM_API_KEY: "real_prod_freellm_key",
        ADMIN_BOOTSTRAP_EMAIL: "admin@ars_llm.local",
        ADMIN_BOOTSTRAP_PASSWORD: "StrongProdAdminPassword_2026!",
      }),
    /POSTGRES_HOST in production cannot point to localhost/
  );

  // 6. Valid production config with cloud DATABASE_URL and remote FreeLLMAPI gateway succeeds
  const validProd = validateEnvConfig({
    NODE_ENV: "production",
    DATABASE_URL:
      "postgresql://ars_llm_user:StrongProdDbPassword_2026!@ep-cloud-db.neon.tech:5432/ars_llm_db",
    POSTGRES_SSL: "true",
    SESSION_SECRET: "a_very_strong_production_session_secret_at_least_32_bytes",
    FREELLM_API_BASE_URL: "https://freellm-gateway.company.kz/v1",
    FREELLM_API_KEY: "real_prod_freellm_key",
    ADMIN_BOOTSTRAP_EMAIL: "admin@company.kz",
    ADMIN_BOOTSTRAP_PASSWORD: "StrongProdAdminPassword_2026!",
  });
  assert.equal(validProd.POSTGRES_HOST, "ep-cloud-db.neon.tech");
  assert.equal(validProd.POSTGRES_SSL, true);
  assert.equal(validProd.TRUST_PROXY, true);
  assert.equal(validProd.SERVE_STATIC_SPA, true);
  assert.equal(validProd.FREELLM_API_BASE_URL, "https://freellm-gateway.company.kz/v1");
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

test("chatWithFreeLlm and streamChatWithFreeLlm work with remote gateway and fail over to fallback on 503/429", async () => {
  const { chatWithFreeLlm, streamChatWithFreeLlm } = await import("./freeLlm.js");

  const calledUrls: string[] = [];
  const mockFetchUnary: typeof fetch = async (input) => {
    const url = String(input);
    calledUrls.push(url);
    if (url.startsWith("https://primary-freellm.company.kz")) {
      return new Response(JSON.stringify({ error: { message: "Rate limited" } }), {
        status: 429,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(
      JSON.stringify({
        choices: [{ message: { role: "assistant", content: "Ответ от резервного облачного шлюза" } }],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  };

  const reply = await chatWithFreeLlm(
    [{ role: "user", content: "Проверка отказоустойчивости" }],
    {
      FREELLM_API_BASE_URL: "https://primary-freellm.company.kz/v1",
      FREELLM_API_KEY: "primary_key_123",
      FREELLM_MODEL: "auto",
      FREELLM_FALLBACK_BASE_URL: "https://fallback-freellm.company.kz/v1",
      FREELLM_FALLBACK_API_KEY: "fallback_key_456",
      FREELLM_FALLBACK_MODEL: "auto",
    },
    mockFetchUnary
  );

  assert.equal(reply, "Ответ от резервного облачного шлюза");
  assert.deepEqual(calledUrls, [
    "https://primary-freellm.company.kz/v1/chat/completions",
    "https://fallback-freellm.company.kz/v1/chat/completions",
  ]);

  // Verify SSE streaming failover
  const streamUrls: string[] = [];
  const mockFetchStream: typeof fetch = async (input) => {
    const url = String(input);
    streamUrls.push(url);
    if (url.startsWith("https://primary-freellm.company.kz")) {
      return new Response("Service Unavailable", { status: 503 });
    }
    const ssePayload =
      'data: {"choices":[{"delta":{"content":"Облачный "}}]}\n\n' +
      'data: {"choices":[{"delta":{"content":"поток SSE"}}]}\n\n' +
      "data: [DONE]\n\n";
    return new Response(ssePayload, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });
  };

  const chunks: string[] = [];
  for await (const token of streamChatWithFreeLlm(
    [{ role: "user", content: "Потоковый тест" }],
    undefined,
    {
      FREELLM_API_BASE_URL: "https://primary-freellm.company.kz/v1",
      FREELLM_API_KEY: "primary_key_123",
      FREELLM_MODEL: "auto",
      FREELLM_FALLBACK_BASE_URL: "https://fallback-freellm.company.kz/v1",
      FREELLM_FALLBACK_API_KEY: "fallback_key_456",
      FREELLM_FALLBACK_MODEL: "auto",
    },
    mockFetchStream
  )) {
    chunks.push(token);
  }

  assert.equal(chunks.join(""), "Облачный поток SSE");
  assert.equal(streamUrls.length, 2);
});

test("Production Dockerfile and infra/docker-compose.prod.yml have zero dependency on host.docker.internal", async () => {
  const { readFileSync } = await import("node:fs");
  const { resolve } = await import("node:path");

  const rootDockerfile = readFileSync(resolve(process.cwd(), "Dockerfile"), "utf-8");
  const prodCompose = readFileSync(resolve(process.cwd(), "infra/docker-compose.prod.yml"), "utf-8");

  assert.ok(rootDockerfile.includes("SERVE_STATIC_SPA=true"), "Dockerfile must enable SERVE_STATIC_SPA");
  assert.ok(rootDockerfile.includes("TRUST_PROXY=true"), "Dockerfile must enable TRUST_PROXY");
  assert.ok(
    rootDockerfile.includes("COPY --from=frontend-builder /frontend/dist ./frontend-dist"),
    "Dockerfile must bundle compiled React SPA into unified runtime image"
  );

  // Strip comments from prodCompose and verify host.docker.internal is not used
  const activeProdLines = prodCompose
    .split("\n")
    .filter((line) => !line.trim().startsWith("#"))
    .join("\n");

  assert.ok(
    !activeProdLines.includes("host.docker.internal"),
    "infra/docker-compose.prod.yml must not depend on host.docker.internal"
  );
  assert.ok(
    activeProdLines.includes('SERVE_STATIC_SPA: "true"'),
    "infra/docker-compose.prod.yml must enable unified static SPA serving"
  );
});

test("verifyFreeLlmConnection sends Bearer auth + Dev Tunnel header and never leaks FREELLM_API_KEY in report", async () => {
  const { verifyFreeLlmConnection } = await import("./freeLlm.js");

  const secretKey = "sk-live-secret-freellm-test-token-do-not-leak";
  const recordedRequests: Array<{ url: string; headers: Record<string, string> }> = [];

  const mockFetchSuccess: typeof fetch = async (input, init) => {
    const url = String(input);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    recordedRequests.push({ url, headers });

    if (url.endsWith("/models")) {
      return new Response(
        JSON.stringify({
          data: [{ id: "gpt-4o-mini" }, { id: "claude-3-5-sonnet" }, { id: "llama-3.3-70b" }],
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        choices: [{ message: { role: "assistant", content: "OK" } }],
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };

  const report = await verifyFreeLlmConnection(
    {
      FREELLM_API_BASE_URL: "https://v7skvft7-31415.euw.devtunnels.ms/v1",
      FREELLM_MODEL: "auto",
      FREELLM_API_KEY: secretKey,
    },
    mockFetchSuccess
  );

  assert.equal(report.baseUrl, "https://v7skvft7-31415.euw.devtunnels.ms/v1");
  assert.equal(report.model, "auto");
  assert.equal(report.apiKeyConfigured, true);
  assert.equal(report.modelsCheck.ok, true);
  assert.equal(report.modelsCheck.modelCount, 3);
  assert.equal(report.completionCheck.ok, true);
  assert.equal(report.completionCheck.replyPreviewLength, 2);

  assert.equal(recordedRequests.length, 2);
  assert.equal(
    recordedRequests[0].url,
    "https://v7skvft7-31415.euw.devtunnels.ms/v1/models"
  );
  assert.equal(recordedRequests[0].headers.Authorization, `Bearer ${secretKey}`);
  assert.equal(
    recordedRequests[0].headers["X-Tunnel-Skip-AntiPhishing-Page"],
    "true"
  );
  assert.equal(
    recordedRequests[1].url,
    "https://v7skvft7-31415.euw.devtunnels.ms/v1/chat/completions"
  );

  const serializedReport = JSON.stringify(report);
  assert.ok(
    !serializedReport.includes(secretKey),
    "Serialized verification report must never contain FREELLM_API_KEY"
  );

  // Also verify Dev Tunnel redirect / private port detection
  const mockFetchTunnelRedirect: typeof fetch = async () =>
    new Response(null, {
      status: 302,
      headers: {
        location: "https://global.rel.tunnels.api.visualstudio.com/auth/github",
      },
    });

  const redirectReport = await verifyFreeLlmConnection(
    {
      FREELLM_API_BASE_URL: "https://v7skvft7-31415.euw.devtunnels.ms/v1",
      FREELLM_MODEL: "auto",
      FREELLM_API_KEY: secretKey,
    },
    mockFetchTunnelRedirect
  );

  assert.equal(redirectReport.modelsCheck.ok, false);
  assert.equal(redirectReport.modelsCheck.tunnelAuthRequired, true);
  assert.match(redirectReport.modelsCheck.error ?? "", /VS Code Dev Tunnel redirected/);
});



