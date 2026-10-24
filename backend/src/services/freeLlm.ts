import env from "../config/index.js";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface FreeLlmProviderEndpoint {
  name: "primary" | "fallback";
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
}

export interface FreeLlmRuntimeConfig {
  FREELLM_API_BASE_URL: string;
  FREELLM_API_KEY: string;
  FREELLM_MODEL: string;
  FREELLM_TIMEOUT_MS?: number;
  FREELLM_FALLBACK_BASE_URL?: string;
  FREELLM_FALLBACK_API_KEY?: string;
  FREELLM_FALLBACK_MODEL?: string;
}

export interface FreeLlmEndpointCheck {
  ok: boolean;
  status: number | null;
  latencyMs: number;
  contentType?: string;
  tunnelAuthRequired?: boolean;
  modelCount?: number;
  sampleModels?: string[];
  replyPreviewLength?: number;
  error?: string;
}

export interface FreeLlmVerificationReport {
  baseUrl: string;
  model: string;
  apiKeyConfigured: boolean;
  modelsCheck: FreeLlmEndpointCheck;
  completionCheck: FreeLlmEndpointCheck;
}

interface FreeLlmResponse {
  choices?: Array<{
    message?: {
      role?: string;
      content?: string;
    };
    finish_reason?: string | null;
  }>;
  error?: {
    message?: string;
  };
}

interface FreeLlmModelsResponse {
  data?: Array<{
    id?: string;
  }>;
  error?: {
    message?: string;
  };
}

const PLACEHOLDER_API_KEYS = new Set([
  "",
  "CHANGE_ME_FREELLM_API_KEY",
  "changeme",
  "secret",
]);

/**
 * Builds standard headers for OpenAI-compatible FreeLLMAPI requests,
 * including the VS Code Dev Tunnel anti-phishing bypass header for API clients.
 * Never logs or exposes the API key.
 */
export function buildFreeLlmHeaders(
  apiKey: string,
  includeJsonContentType = false
): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "X-Tunnel-Skip-AntiPhishing-Page": "true",
  };
  if (includeJsonContentType) {
    headers["Content-Type"] = "application/json";
  }
  const trimmedKey = apiKey.trim();
  if (trimmedKey && !PLACEHOLDER_API_KEYS.has(trimmedKey)) {
    headers.Authorization = `Bearer ${trimmedKey}`;
  }
  return headers;
}

/**
 * Normalizes a FreeLLMAPI / OpenAI-compatible base URL:
 * strips trailing slashes and appends `/v1` if no `/v1` suffix is present.
 */
export function normalizeFreeLlmBaseUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  return trimmed.endsWith("/v1") ? trimmed : `${trimmed}/v1`;
}

/**
 * Resolves the ordered list of configured AI provider endpoints (primary FreeLLMAPI
 * endpoint followed by optional fallback endpoint if configured).
 */
export function resolveProviderEndpoints(
  config: FreeLlmRuntimeConfig = env
): FreeLlmProviderEndpoint[] {
  const timeoutMs = config.FREELLM_TIMEOUT_MS ?? 120_000;
  const endpoints: FreeLlmProviderEndpoint[] = [];

  const primaryKey = (config.FREELLM_API_KEY ?? "").trim();
  const primaryBaseUrl = normalizeFreeLlmBaseUrl(config.FREELLM_API_BASE_URL ?? "");
  if (primaryBaseUrl && !PLACEHOLDER_API_KEYS.has(primaryKey)) {
    endpoints.push({
      name: "primary",
      baseUrl: primaryBaseUrl,
      apiKey: primaryKey,
      model: config.FREELLM_MODEL || "auto",
      timeoutMs,
    });
  }

  const fallbackKey = (config.FREELLM_FALLBACK_API_KEY ?? "").trim();
  const fallbackBaseUrl = normalizeFreeLlmBaseUrl(
    config.FREELLM_FALLBACK_BASE_URL ?? ""
  );
  if (fallbackBaseUrl && !PLACEHOLDER_API_KEYS.has(fallbackKey)) {
    endpoints.push({
      name: "fallback",
      baseUrl: fallbackBaseUrl,
      apiKey: fallbackKey,
      model: config.FREELLM_FALLBACK_MODEL || config.FREELLM_MODEL || "auto",
      timeoutMs,
    });
  }

  return endpoints;
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function classifyNonOkResponse(response: Response): {
  tunnelAuthRequired: boolean;
  message: string;
} {
  const wwwAuth = (response.headers.get("www-authenticate") ?? "").toLowerCase();
  const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
  const location = response.headers.get("location") ?? "";

  if (
    response.status === 302 ||
    response.status === 307 ||
    location.includes("visualstudio.com") ||
    location.includes("devtunnels.ms") ||
    location.includes("github.com/login") ||
    location.includes("login.microsoftonline.com")
  ) {
    return {
      tunnelAuthRequired: true,
      message: `VS Code Dev Tunnel redirected request (HTTP ${response.status}) to tunnel authentication login. Ensure the Dev Tunnel port visibility is set to Public or provide tunnel access headers.`,
    };
  }

  if (wwwAuth.includes("tunnel") || (contentType.includes("text/html") && (response.status === 401 || response.status === 403))) {
    return {
      tunnelAuthRequired: true,
      message: `VS Code Dev Tunnel rejected unauthenticated tunnel access (HTTP ${response.status}). Either the tunnel port is Private (requires X-Tunnel-Authorization) or FreeLLMAPI rejected the Bearer key.`,
    };
  }

  if (response.status === 401 || response.status === 403) {
    return {
      tunnelAuthRequired: false,
      message: "FreeLLMAPI authentication failed",
    };
  }

  if (contentType.includes("text/html")) {
    return {
      tunnelAuthRequired: true,
      message: `Endpoint returned an HTML page (HTTP ${response.status}) instead of OpenAI JSON, indicating a Dev Tunnel interstitial or gateway error page.`,
    };
  }

  return {
    tunnelAuthRequired: false,
    message: `FreeLLMAPI returned HTTP ${response.status}`,
  };
}

export async function chatWithFreeLlm(
  messages: ChatMessage[],
  config: FreeLlmRuntimeConfig = env,
  fetchFn: typeof fetch = fetch
): Promise<string> {
  const endpoints = resolveProviderEndpoints(config);
  if (endpoints.length === 0) {
    throw new Error("FreeLLMAPI is not configured");
  }

  let lastError: Error | null = null;

  for (let i = 0; i < endpoints.length; i++) {
    const ep = endpoints[i];
    const hasFallback = i < endpoints.length - 1;

    try {
      const response = await fetchFn(`${ep.baseUrl}/chat/completions`, {
        method: "POST",
        headers: buildFreeLlmHeaders(ep.apiKey, true),
        body: JSON.stringify({
          model: ep.model,
          messages,
          stream: false,
        }),
        signal: AbortSignal.timeout(ep.timeoutMs),
      });

      const data = (await response.json().catch(() => null)) as
        | FreeLlmResponse
        | null;

      if (!response.ok) {
        const classified = classifyNonOkResponse(response);
        console.error(
          `FreeLLMAPI (${ep.name}) request failed with HTTP ${response.status}`
        );

        const err = new Error(classified.message);

        if (hasFallback && isRetryableStatus(response.status)) {
          lastError = err;
          continue;
        }
        throw err;
      }

      const content = data?.choices?.[0]?.message?.content;

      if (typeof content !== "string" || !content.trim()) {
        const emptyErr = new Error("FreeLLMAPI returned an empty response");
        if (hasFallback) {
          lastError = emptyErr;
          continue;
        }
        throw emptyErr;
      }

      return content;
    } catch (err) {
      const normalizedErr =
        err instanceof Error ? err : new Error("FreeLLMAPI request failed");
      if (hasFallback && !normalizedErr.message.includes("authentication failed")) {
        lastError = normalizedErr;
        continue;
      }
      throw normalizedErr;
    }
  }

  throw lastError ?? new Error("FreeLLMAPI request failed");
}

export async function* streamChatWithFreeLlm(
  messages: ChatMessage[],
  signal?: AbortSignal,
  config: FreeLlmRuntimeConfig = env,
  fetchFn: typeof fetch = fetch
): AsyncGenerator<string> {
  const endpoints = resolveProviderEndpoints(config);
  if (endpoints.length === 0) {
    throw new Error("FreeLLMAPI is not configured");
  }

  let response: Response | null = null;
  let lastError: Error | null = null;

  for (let i = 0; i < endpoints.length; i++) {
    const ep = endpoints[i];
    const hasFallback = i < endpoints.length - 1;

    try {
      const candidateResponse = await fetchFn(`${ep.baseUrl}/chat/completions`, {
        method: "POST",
        headers: buildFreeLlmHeaders(ep.apiKey, true),
        body: JSON.stringify({
          model: ep.model,
          messages,
          stream: true,
        }),
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(ep.timeoutMs)])
          : AbortSignal.timeout(ep.timeoutMs),
      });

      if (!candidateResponse.ok) {
        const classified = classifyNonOkResponse(candidateResponse);
        console.error(
          `FreeLLMAPI (${ep.name}) streaming request failed with HTTP ${candidateResponse.status}`
        );

        const err = new Error(classified.message);

        if (hasFallback && isRetryableStatus(candidateResponse.status)) {
          lastError = err;
          continue;
        }
        throw err;
      }

      if (!candidateResponse.body) {
        const emptyBodyErr = new Error("FreeLLMAPI returned an empty stream");
        if (hasFallback) {
          lastError = emptyBodyErr;
          continue;
        }
        throw emptyBodyErr;
      }

      response = candidateResponse;
      break;
    } catch (err) {
      if (signal?.aborted) {
        throw err;
      }
      const normalizedErr =
        err instanceof Error ? err : new Error("FreeLLMAPI streaming failed");
      if (hasFallback && !normalizedErr.message.includes("authentication failed")) {
        lastError = normalizedErr;
        continue;
      }
      throw normalizedErr;
    }
  }

  if (!response || !response.body) {
    throw lastError ?? new Error("FreeLLMAPI returned an empty stream");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let streamFinished = false;

  try {
    while (true) {
      const { value, done } = await reader.read();

      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, "\n");

      const events = buffer.split("\n\n");
      buffer = events.pop() ?? "";

      for (const event of events) {
        for (const line of event.split("\n")) {
          if (!line.startsWith("data:")) continue;

          const data = line.slice(5).trim();

          if (!data) continue;

          if (data === "[DONE]") {
            streamFinished = true;
            return;
          }

          let parsed: {
            choices?: Array<{
              delta?: { content?: unknown };
            }>;
            error?: { message?: string };
          };

          try {
            parsed = JSON.parse(data);
          } catch {
            continue;
          }

          if (parsed.error) {
            throw new Error(
              parsed.error.message || "FreeLLMAPI streaming error"
            );
          }

          const content = parsed.choices?.[0]?.delta?.content;

          if (typeof content === "string" && content.length > 0) {
            yield content;
          }
        }
      }
    }

    // Process a final event if the server closed without a trailing separator.
    buffer += decoder.decode();

    if (!streamFinished && buffer.trim()) {
      for (const line of buffer.split("\n")) {
        if (!line.startsWith("data:")) continue;

        const data = line.slice(5).trim();

        if (!data || data === "[DONE]") continue;

        try {
          const parsed = JSON.parse(data);
          const content = parsed.choices?.[0]?.delta?.content;

          if (typeof content === "string" && content.length > 0) {
            yield content;
          }
        } catch {
          // Ignore an incomplete final event.
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Performs a safe server-side connectivity check (`GET /models`) and short
 * completion generation probe (`POST /chat/completions`) against FreeLLMAPI
 * without exposing or logging `FREELLM_API_KEY` or private user messages.
 */
export async function verifyFreeLlmConnection(
  customConfig?: Partial<FreeLlmRuntimeConfig>,
  fetchFn: typeof fetch = fetch
): Promise<FreeLlmVerificationReport> {
  const baseUrl = normalizeFreeLlmBaseUrl(
    customConfig?.FREELLM_API_BASE_URL ??
      env.FREELLM_API_BASE_URL ??
      "https://v7skvft7-31415.euw.devtunnels.ms/v1"
  );

  const model =
    (customConfig?.FREELLM_MODEL ?? env.FREELLM_MODEL ?? "auto").trim() ||
    "auto";

  const rawKey = (
    customConfig?.FREELLM_API_KEY ??
    env.FREELLM_API_KEY ??
    ""
  ).trim();

  const apiKeyConfigured = !PLACEHOLDER_API_KEYS.has(rawKey);
  const timeoutMs = customConfig?.FREELLM_TIMEOUT_MS ?? env.FREELLM_TIMEOUT_MS ?? 30_000;

  // 1. Check GET /models
  let modelsCheck: FreeLlmEndpointCheck;
  const modelsStart = Date.now();
  try {
    const modelsRes = await fetchFn(`${baseUrl}/models`, {
      method: "GET",
      headers: buildFreeLlmHeaders(rawKey, false),
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
    const latencyMs = Date.now() - modelsStart;
    const contentType = modelsRes.headers.get("content-type") ?? "";

    if (!modelsRes.ok) {
      const classified = classifyNonOkResponse(modelsRes);
      const errBody = await modelsRes.json().catch(() => null) as FreeLlmModelsResponse | null;
      const apiErrMsg = errBody?.error?.message ? ` (${errBody.error.message})` : "";
      modelsCheck = {
        ok: false,
        status: modelsRes.status,
        latencyMs,
        contentType,
        tunnelAuthRequired: classified.tunnelAuthRequired,
        error: `${classified.message}${apiErrMsg}`,
      };
    } else if (contentType.toLowerCase().includes("text/html")) {
      modelsCheck = {
        ok: false,
        status: modelsRes.status,
        latencyMs,
        contentType,
        tunnelAuthRequired: true,
        error:
          "Endpoint returned HTML instead of OpenAI JSON on GET /models (VS Code Dev Tunnel interstitial or login page).",
      };
    } else {
      const parsed = (await modelsRes.json().catch(() => null)) as FreeLlmModelsResponse | null;
      const list = Array.isArray(parsed?.data) ? parsed.data : [];
      modelsCheck = {
        ok: true,
        status: modelsRes.status,
        latencyMs,
        contentType,
        modelCount: list.length,
        sampleModels: list
          .map((item) => item.id)
          .filter((id): id is string => typeof id === "string")
          .slice(0, 5),
      };
    }
  } catch (err) {
    modelsCheck = {
      ok: false,
      status: null,
      latencyMs: Date.now() - modelsStart,
      error: err instanceof Error ? err.message : "GET /models request failed",
    };
  }

  // 2. Check POST /chat/completions with a minimal verification prompt
  let completionCheck: FreeLlmEndpointCheck;
  const completionStart = Date.now();
  try {
    const compRes = await fetchFn(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: buildFreeLlmHeaders(rawKey, true),
      redirect: "manual",
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "Reply with a single word: OK" }],
        stream: false,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const latencyMs = Date.now() - completionStart;
    const contentType = compRes.headers.get("content-type") ?? "";

    if (!compRes.ok) {
      const classified = classifyNonOkResponse(compRes);
      const errBody = await compRes.json().catch(() => null) as FreeLlmResponse | null;
      const apiErrMsg = errBody?.error?.message ? ` (${errBody.error.message})` : "";
      completionCheck = {
        ok: false,
        status: compRes.status,
        latencyMs,
        contentType,
        tunnelAuthRequired: classified.tunnelAuthRequired,
        error: `${classified.message}${apiErrMsg}`,
      };
    } else if (contentType.toLowerCase().includes("text/html")) {
      completionCheck = {
        ok: false,
        status: compRes.status,
        latencyMs,
        contentType,
        tunnelAuthRequired: true,
        error:
          "Endpoint returned HTML instead of OpenAI JSON on POST /chat/completions (VS Code Dev Tunnel interstitial or login page).",
      };
    } else {
      const parsed = (await compRes.json().catch(() => null)) as FreeLlmResponse | null;
      const content = parsed?.choices?.[0]?.message?.content ?? "";
      if (typeof content === "string" && content.trim().length > 0) {
        completionCheck = {
          ok: true,
          status: compRes.status,
          latencyMs,
          contentType,
          replyPreviewLength: content.trim().length,
        };
      } else {
        completionCheck = {
          ok: false,
          status: compRes.status,
          latencyMs,
          contentType,
          error: parsed?.error?.message || "FreeLLMAPI returned an empty completion response",
        };
      }
    }
  } catch (err) {
    completionCheck = {
      ok: false,
      status: null,
      latencyMs: Date.now() - completionStart,
      error:
        err instanceof Error ? err.message : "POST /chat/completions request failed",
    };
  }

  return {
    baseUrl,
    model,
    apiKeyConfigured,
    modelsCheck,
    completionCheck,
  };
}
