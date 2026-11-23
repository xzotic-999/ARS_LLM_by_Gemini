import test from "node:test";
import assert from "node:assert/strict";
import {
  checkFreeLlmHealth,
  testFreeLlmGeneration,
  sanitizeFreeLlmSecretText,
} from "./freeLlmDiagnostics.js";

test("checkFreeLlmHealth returns Connected for valid GET /models, adds Dev Tunnel header only on *.devtunnels.ms, and never calls completions", async () => {
  const secretKey = "sk-live-secret-health-key-9911";
  const calls: Array<{ url: string; method: string; headers: Record<string, string> }> = [];

  const mockFetch: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ url, method, headers });
    return new Response(
      JSON.stringify({
        data: [{ id: "auto" }, { id: "gpt-4o-mini" }, { id: "claude-3-5-sonnet" }],
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };

  const result = await checkFreeLlmHealth(
    {
      FREELLM_API_BASE_URL: "https://v7skvft7-31415.euw.devtunnels.ms/v1",
      FREELLM_API_KEY: secretKey,
      FREELLM_MODEL: "auto",
    },
    mockFetch
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "GET");
  assert.equal(calls[0].url, "https://v7skvft7-31415.euw.devtunnels.ms/v1/models");
  assert.equal(calls[0].headers.Authorization, `Bearer ${secretKey}`);
  assert.equal(calls[0].headers["X-Tunnel-Skip-AntiPhishing-Page"], "true");

  assert.equal(result.status, "connected");
  assert.equal(result.apiAvailable, true);
  assert.equal(result.authStatus, "ok");
  assert.equal(result.modelsAvailable, true);
  assert.equal(result.modelCount, 3);
  assert.equal(result.endpointHost, "v7skvft7-31415.euw.devtunnels.ms");
  assert.equal(result.httpStatus, 200);
  assert.equal(result.lastError, null);
  assert.ok(!JSON.stringify(result).includes(secretKey));

  // Non-devtunnel host must NOT receive X-Tunnel-Skip-AntiPhishing-Page header
  calls.length = 0;
  await checkFreeLlmHealth(
    {
      FREELLM_API_BASE_URL: "https://gateway.company.kz",
      FREELLM_API_KEY: secretKey,
      FREELLM_MODEL: "gpt-4o-mini",
    },
    mockFetch
  );
  assert.equal(calls[0].url, "https://gateway.company.kz/v1/models");
  assert.equal(calls[0].headers["X-Tunnel-Skip-AntiPhishing-Page"], undefined);
});

test("checkFreeLlmHealth classifies Degraded and Disconnected states accurately without leaking secrets", async () => {
  const secretKey = "sk-live-secret-diagnostic-key-7744";

  // 1. Missing configured non-auto model -> Degraded (model_routing_error)
  const missingModelRes = await checkFreeLlmHealth(
    {
      FREELLM_API_BASE_URL: "https://gateway.company.kz/v1",
      FREELLM_API_KEY: secretKey,
      FREELLM_MODEL: "non-existent-model-xyz",
    },
    async () =>
      new Response(JSON.stringify({ data: [{ id: "gpt-4o-mini" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
  );
  assert.equal(missingModelRes.status, "degraded");
  assert.equal(missingModelRes.apiAvailable, true);
  assert.equal(missingModelRes.authStatus, "ok");
  assert.equal(missingModelRes.modelsAvailable, false);
  assert.equal(missingModelRes.lastError?.category, "model_routing_error");

  // 2. Empty model list -> Degraded (model_routing_error)
  const emptyModelsRes = await checkFreeLlmHealth(
    {
      FREELLM_API_BASE_URL: "https://gateway.company.kz/v1",
      FREELLM_API_KEY: secretKey,
      FREELLM_MODEL: "auto",
    },
    async () =>
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
  );
  assert.equal(emptyModelsRes.status, "degraded");
  assert.equal(emptyModelsRes.lastError?.category, "model_routing_error");

  // 3. HTTP 401 -> Disconnected (auth_error) & strips leaked Bearer secret from upstream body
  const authFailRes = await checkFreeLlmHealth(
    {
      FREELLM_API_BASE_URL: "https://gateway.company.kz/v1",
      FREELLM_API_KEY: secretKey,
      FREELLM_MODEL: "auto",
    },
    async () =>
      new Response(
        JSON.stringify({
          error: { message: `Invalid token Bearer ${secretKey} provided` },
        }),
        { status: 401, headers: { "content-type": "application/json" } }
      )
  );
  assert.equal(authFailRes.status, "disconnected");
  assert.equal(authFailRes.apiAvailable, false);
  assert.equal(authFailRes.authStatus, "failed");
  assert.equal(authFailRes.lastError?.category, "auth_error");
  assert.ok(!JSON.stringify(authFailRes).includes(secretKey));

  // 4. Dev Tunnel 302 redirect -> Disconnected (auth_error)
  const tunnelRedirectRes = await checkFreeLlmHealth(
    {
      FREELLM_API_BASE_URL: "https://v7skvft7-31415.euw.devtunnels.ms/v1",
      FREELLM_API_KEY: secretKey,
      FREELLM_MODEL: "auto",
    },
    async () =>
      new Response(null, {
        status: 302,
        headers: { location: "https://global.rel.tunnels.api.visualstudio.com/auth" },
      })
  );
  assert.equal(tunnelRedirectRes.status, "disconnected");
  assert.equal(tunnelRedirectRes.lastError?.category, "auth_error");

  // 5. HTTP 429 -> Degraded (rate_limit)
  const rateLimitRes = await checkFreeLlmHealth(
    {
      FREELLM_API_BASE_URL: "https://gateway.company.kz/v1",
      FREELLM_API_KEY: secretKey,
      FREELLM_MODEL: "auto",
    },
    async () =>
      new Response(JSON.stringify({ error: { message: "Too many requests" } }), {
        status: 429,
        headers: { "content-type": "application/json" },
      })
  );
  assert.equal(rateLimitRes.status, "degraded");
  assert.equal(rateLimitRes.lastError?.category, "rate_limit");

  // 6. Upstream 503 -> Disconnected (upstream_5xx)
  const upstream5xxRes = await checkFreeLlmHealth(
    {
      FREELLM_API_BASE_URL: "https://gateway.company.kz/v1",
      FREELLM_API_KEY: secretKey,
      FREELLM_MODEL: "auto",
    },
    async () =>
      new Response(JSON.stringify({ error: { message: "Upstream unavailable" } }), {
        status: 503,
        headers: { "content-type": "application/json" },
      })
  );
  assert.equal(upstream5xxRes.status, "disconnected");
  assert.equal(upstream5xxRes.lastError?.category, "upstream_5xx");

  // 7. DNS ENOTFOUND error -> Disconnected (dns_network_error)
  const dnsFailRes = await checkFreeLlmHealth(
    {
      FREELLM_API_BASE_URL: "https://missing-gateway.internal/v1",
      FREELLM_API_KEY: secretKey,
      FREELLM_MODEL: "auto",
    },
    async () => {
      const cause = Object.assign(new Error("getaddrinfo ENOTFOUND missing-gateway.internal"), {
        code: "ENOTFOUND",
      });
      throw Object.assign(new TypeError("fetch failed"), { cause });
    }
  );
  assert.equal(dnsFailRes.status, "disconnected");
  assert.equal(dnsFailRes.lastError?.category, "dns_network_error");

  // 8. Timeout -> Disconnected (timeout)
  const timeoutRes = await checkFreeLlmHealth(
    {
      FREELLM_API_BASE_URL: "https://gateway.company.kz/v1",
      FREELLM_API_KEY: secretKey,
      FREELLM_MODEL: "auto",
    },
    async () => {
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    }
  );
  assert.equal(timeoutRes.status, "disconnected");
  assert.equal(timeoutRes.lastError?.category, "timeout");

  // 9. Unconfigured URL / placeholder key
  const unconfiguredKeyRes = await checkFreeLlmHealth({
    FREELLM_API_BASE_URL: "https://gateway.company.kz/v1",
    FREELLM_API_KEY: "CHANGE_ME_FREELLM_API_KEY",
    FREELLM_MODEL: "auto",
  });
  assert.equal(unconfiguredKeyRes.status, "disconnected");
  assert.equal(unconfiguredKeyRes.authStatus, "unconfigured");
  assert.equal(unconfiguredKeyRes.lastError?.category, "auth_error");
});

test("testFreeLlmGeneration verifies minimal generation route, fallback failover, error categories, and secret redaction", async () => {
  const primaryKey = "sk-primary-secret-key-1122";
  const fallbackKey = "sk-fallback-secret-key-3344";

  // 1. Primary succeeds
  const okRes = await testFreeLlmGeneration(
    {
      FREELLM_API_BASE_URL: "https://primary.company.kz/v1",
      FREELLM_API_KEY: primaryKey,
      FREELLM_MODEL: "auto",
    },
    async (_input, init) => {
      const body = JSON.parse(String(init?.body ?? "{}"));
      assert.equal(body.stream, false);
      assert.equal(body.max_tokens, 16);
      assert.equal(body.messages[0].content, "Reply with a single word: OK");
      return new Response(
        JSON.stringify({
          model: "gpt-4o-mini",
          choices: [{ message: { role: "assistant", content: "OK" } }],
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
  );

  assert.equal(okRes.success, true);
  assert.equal(okRes.status, "connected");
  assert.equal(okRes.endpointUsed, "primary");
  assert.equal(okRes.route, "/v1/chat/completions");
  assert.equal(okRes.modelUsed, "gpt-4o-mini");
  assert.equal(okRes.httpStatus, 200);
  assert.equal(okRes.error, null);

  // 2. Primary 503 fails over to fallback
  const failoverRes = await testFreeLlmGeneration(
    {
      FREELLM_API_BASE_URL: "https://primary.company.kz/v1",
      FREELLM_API_KEY: primaryKey,
      FREELLM_MODEL: "auto",
      FREELLM_FALLBACK_BASE_URL: "https://fallback.company.kz/v1",
      FREELLM_FALLBACK_API_KEY: fallbackKey,
      FREELLM_FALLBACK_MODEL: "llama-3.3-70b",
    },
    async (input) => {
      if (String(input).startsWith("https://primary.company.kz")) {
        return new Response(JSON.stringify({ error: { message: "Overloaded" } }), {
          status: 503,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(
        JSON.stringify({
          model: "llama-3.3-70b",
          choices: [{ message: { role: "assistant", content: "OK" } }],
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
  );

  assert.equal(failoverRes.success, true);
  assert.equal(failoverRes.endpointUsed, "fallback");
  assert.equal(failoverRes.route, "/v1/chat/completions");
  assert.equal(failoverRes.modelUsed, "llama-3.3-70b");

  // 3. Model routing error (404 / unknown model)
  const routeErrRes = await testFreeLlmGeneration(
    {
      FREELLM_API_BASE_URL: "https://primary.company.kz/v1",
      FREELLM_API_KEY: primaryKey,
      FREELLM_MODEL: "bad-model",
    },
    async () =>
      new Response(JSON.stringify({ error: { message: "Unknown model: bad-model" } }), {
        status: 404,
        headers: { "content-type": "application/json" },
      })
  );
  assert.equal(routeErrRes.success, false);
  assert.equal(routeErrRes.status, "degraded");
  assert.equal(routeErrRes.error?.category, "model_routing_error");

  // 4. Empty completion response -> generation_error
  const emptyCompletionRes = await testFreeLlmGeneration(
    {
      FREELLM_API_BASE_URL: "https://primary.company.kz/v1",
      FREELLM_API_KEY: primaryKey,
      FREELLM_MODEL: "auto",
    },
    async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { role: "assistant", content: "   " } }],
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
  );
  assert.equal(emptyCompletionRes.success, false);
  assert.equal(emptyCompletionRes.status, "degraded");
  assert.equal(emptyCompletionRes.error?.category, "generation_error");

  // 5. Secret sanitization explicitly strips keys & userinfo credentials
  const redacted = sanitizeFreeLlmSecretText(
    `Error with Bearer ${primaryKey} at https://user:pass@host.kz and ${fallbackKey}`,
    [primaryKey, fallbackKey]
  );
  assert.ok(!redacted.includes(primaryKey));
  assert.ok(!redacted.includes(fallbackKey));
  assert.ok(!redacted.includes("user:pass"));
});
