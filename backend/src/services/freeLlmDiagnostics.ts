export type FreeLlmConnectionState = "connected" | "degraded" | "disconnected";

export type FreeLlmAuthStatus = "ok" | "failed" | "unconfigured";

export type FreeLlmErrorCategory =
  | "dns_network_error"
  | "timeout"
  | "auth_error"
  | "rate_limit"
  | "upstream_5xx"
  | "model_routing_error"
  | "generation_error"
  | "config_error";

export interface FreeLlmDiagnosticError {
  category: FreeLlmErrorCategory;
  label: string;
  message: string;
  httpStatus: number | null;
}

export interface FreeLlmHealthResult {
  status: FreeLlmConnectionState;
  apiAvailable: boolean;
  authStatus: FreeLlmAuthStatus;
  modelsAvailable: boolean;
  modelCount: number;
  availableModelsSample: string[];
  configuredModel: string;
  endpointHost: string | null;
  httpStatus: number | null;
  latencyMs: number;
  checkedAt: string;
  lastError: FreeLlmDiagnosticError | null;
}

export interface FreeLlmGenerationTestResult {
  success: boolean;
  status: FreeLlmConnectionState;
  endpointUsed: "primary" | "fallback" | null;
  route: string | null;
  modelUsed: string | null;
  httpStatus: number | null;
  latencyMs: number;
  checkedAt: string;
  error: FreeLlmDiagnosticError | null;
}

export interface FreeLlmDiagnosticConfig {
  FREELLM_API_BASE_URL?: string;
  FREELLM_API_KEY?: string;
  FREELLM_MODEL?: string;
  FREELLM_TIMEOUT_MS?: number;
  FREELLM_FALLBACK_BASE_URL?: string;
  FREELLM_FALLBACK_API_KEY?: string;
  FREELLM_FALLBACK_MODEL?: string;
}

interface RawModelsPayload {
  data?: Array<{ id?: unknown }>;
  error?: { message?: unknown };
}

interface RawCompletionPayload {
  model?: unknown;
  choices?: Array<{
    message?: {
      content?: unknown;
      reasoning_content?: unknown;
      reasoning?: unknown;
    };
  }>;
  error?: { message?: unknown };
}

const PLACEHOLDER_KEYS = new Set([
  "",
  "CHANGE_ME_FREELLM_API_KEY",
  "changeme",
  "secret",
]);

const HIGH_LATENCY_DEGRADED_MS = 3_000;
const HEALTH_CHECK_TIMEOUT_CAP_MS = 10_000;
const GENERATION_TEST_TIMEOUT_CAP_MS = 30_000;

export function isPlaceholderApiKey(rawKey?: string | null): boolean {
  const trimmed = (rawKey ?? "").trim();
  return PLACEHOLDER_KEYS.has(trimmed);
}

export function normalizeDiagnosticBaseUrl(rawUrl?: string | null): string {
  let trimmed = (rawUrl ?? "").trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  if (trimmed.endsWith("/chat/completions")) {
    trimmed = trimmed.slice(0, -"/chat/completions".length).replace(/\/+$/, "");
  }
  if (/\/(?:v\d+(?:beta\d*)?(?:\/openai)?|openai)$/i.test(trimmed)) {
    return trimmed;
  }
  return `${trimmed}/v1`;
}

export function isDiagnosticDevTunnelUrl(rawUrl?: string | null): boolean {
  const trimmed = (rawUrl ?? "").trim();
  if (!trimmed) return false;
  try {
    const host = new URL(trimmed).hostname.toLowerCase();
    return host === "devtunnels.ms" || host.endsWith(".devtunnels.ms");
  } catch {
    return false;
  }
}

export function extractSafeEndpointHost(rawUrl?: string | null): string | null {
  const trimmed = (rawUrl ?? "").trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    return parsed.host || parsed.hostname || null;
  } catch {
    return null;
  }
}

export function buildDiagnosticHeaders(
  apiKey: string,
  includeJsonContentType: boolean,
  baseUrl: string
): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  if (isDiagnosticDevTunnelUrl(baseUrl)) {
    headers["X-Tunnel-Skip-AntiPhishing-Page"] = "true";
  }
  if (includeJsonContentType) {
    headers["Content-Type"] = "application/json";
  }
  const trimmedKey = apiKey.trim();
  if (!isPlaceholderApiKey(trimmedKey)) {
    headers.Authorization = `Bearer ${trimmedKey}`;
  }
  return headers;
}

/**
 * Redacts API keys, Bearer tokens, and embedded URL credentials before returning
 * error descriptions to the Admin Panel UI.
 */
export function sanitizeFreeLlmSecretText(
  rawText: string,
  secretsToRedact: Array<string | undefined | null> = []
): string {
  let sanitized = rawText || "";
  for (const secret of secretsToRedact) {
    const trimmed = (secret ?? "").trim();
    if (trimmed.length >= 4) {
      sanitized = sanitized.split(trimmed).join("[REDACTED]");
    }
  }
  sanitized = sanitized
    .replace(/Bearer\s+[A-Za-z0-9._\-+/=]+/gi, "Bearer [REDACTED]")
    .replace(/(https?:\/\/)([^/\s:@]+):([^/\s@]+)@/gi, "$1[REDACTED]@");
  return sanitized.trim().slice(0, 320);
}

function getErrorCodeChain(err: unknown): string {
  const parts: string[] = [];
  let cursor: unknown = err;
  for (let depth = 0; depth < 4 && cursor && typeof cursor === "object"; depth++) {
    const rec = cursor as { code?: unknown; name?: unknown; message?: unknown; cause?: unknown };
    if (typeof rec.code === "string") parts.push(rec.code);
    if (typeof rec.name === "string") parts.push(rec.name);
    if (typeof rec.message === "string") parts.push(rec.message);
    cursor = rec.cause;
  }
  if (typeof err === "string") {
    parts.push(err);
  }
  return parts.join(" ").trim();
}

export function getCategoryLabel(category: FreeLlmErrorCategory): string {
  switch (category) {
    case "dns_network_error":
      return "DNS / сетевая ошибка";
    case "timeout":
      return "Превышен таймаут ожидания";
    case "auth_error":
      return "Ошибка авторизации API-ключа / туннеля";
    case "rate_limit":
      return "Ограничение частоты запросов (HTTP 429)";
    case "upstream_5xx":
      return "Внутренняя ошибка шлюза FreeLLMAPI (5xx)";
    case "model_routing_error":
      return "Ошибка модели или маршрутизации";
    case "generation_error":
      return "Ошибка генерации ответа модели";
    case "config_error":
      return "Ошибка конфигурации FreeLLMAPI";
  }
}

export function classifyFreeLlmDiagnosticError(params: {
  error?: unknown;
  httpStatus?: number | null;
  upstreamMessage?: string | null;
  tunnelAuthRequired?: boolean;
  contentType?: string | null;
  context: "health" | "generation";
  secrets?: Array<string | undefined | null>;
}): FreeLlmDiagnosticError {
  const httpStatus = params.httpStatus ?? null;
  const secrets = params.secrets ?? [];
  const rawUpstream = (params.upstreamMessage ?? "").trim();
  const safeUpstream = rawUpstream ? sanitizeFreeLlmSecretText(rawUpstream, secrets) : "";
  const combinedErrText = getErrorCodeChain(params.error);
  const lowerCombined = `${combinedErrText} ${rawUpstream}`.toLowerCase();

  // 1. Timeout errors
  if (
    lowerCombined.includes("timeouterror") ||
    lowerCombined.includes("aborterror") ||
    lowerCombined.includes("etimedout") ||
    lowerCombined.includes("timed out") ||
    lowerCombined.includes("aborted due to timeout") ||
    httpStatus === 408 ||
    httpStatus === 504
  ) {
    const baseMsg =
      httpStatus === 504
        ? "Шлюз FreeLLMAPI не дождался ответа модели (HTTP 504)."
        : "Запрос к FreeLLMAPI превысил допустимый таймаут ожидания.";
    return {
      category: "timeout",
      label: getCategoryLabel("timeout"),
      message: safeUpstream ? `${baseMsg} ${safeUpstream}` : baseMsg,
      httpStatus,
    };
  }

  // 2. DNS / TCP / Network errors
  if (
    lowerCombined.includes("enotfound") ||
    lowerCombined.includes("eai_again") ||
    lowerCombined.includes("econnrefused") ||
    lowerCombined.includes("econnreset") ||
    lowerCombined.includes("enetunreach") ||
    lowerCombined.includes("ehostunreach") ||
    lowerCombined.includes("epipe") ||
    lowerCombined.includes("err_name_not_resolved") ||
    (httpStatus === null && lowerCombined.includes("fetch failed"))
  ) {
    const safeCause = sanitizeFreeLlmSecretText(combinedErrText, secrets);
    return {
      category: "dns_network_error",
      label: getCategoryLabel("dns_network_error"),
      message: safeCause
        ? `Не удалось установить сетевое соединение или разрешить DNS-имя узла FreeLLMAPI (${safeCause}).`
        : "Не удалось установить сетевое соединение или разрешить DNS-имя узла FreeLLMAPI.",
      httpStatus: null,
    };
  }

  // 3. Auth / Dev Tunnel redirect or 401/403
  if (
    params.tunnelAuthRequired ||
    httpStatus === 302 ||
    httpStatus === 307 ||
    httpStatus === 401 ||
    httpStatus === 403
  ) {
    const msg =
      httpStatus === 302 || httpStatus === 307 || params.tunnelAuthRequired
        ? "VS Code Dev Tunnel перенаправил запрос на авторизацию или вернул HTML-страницу. Проверьте публичность порта туннеля и доступность шлюза."
        : "FreeLLMAPI отклонил API-ключ (HTTP " + httpStatus + "). Проверьте переменную FREELLM_API_KEY.";
    return {
      category: "auth_error",
      label: getCategoryLabel("auth_error"),
      message: safeUpstream ? `${msg} (${safeUpstream})` : msg,
      httpStatus,
    };
  }

  // 4. Rate limiting (HTTP 429)
  if (httpStatus === 429) {
    return {
      category: "rate_limit",
      label: getCategoryLabel("rate_limit"),
      message: safeUpstream
        ? `Шлюз FreeLLMAPI ограничил частоту запросов (HTTP 429): ${safeUpstream}`
        : "Шлюз FreeLLMAPI ограничил частоту запросов (HTTP 429).",
      httpStatus,
    };
  }

  // 5. Upstream 5xx
  if (httpStatus !== null && httpStatus >= 500) {
    return {
      category: "upstream_5xx",
      label: getCategoryLabel("upstream_5xx"),
      message: safeUpstream
        ? `Сервер FreeLLMAPI вернул ошибку HTTP ${httpStatus}: ${safeUpstream}`
        : `Сервер FreeLLMAPI вернул внутреннюю ошибку HTTP ${httpStatus}.`,
      httpStatus,
    };
  }

  // 6. Model / routing errors (400 / 404 or explicit model/routing message)
  if (
    httpStatus === 400 ||
    httpStatus === 404 ||
    lowerCombined.includes("model") &&
      (lowerCombined.includes("not found") ||
        lowerCombined.includes("unknown") ||
        lowerCombined.includes("unsupported") ||
        lowerCombined.includes("invalid") ||
        lowerCombined.includes("unavailable") ||
        lowerCombined.includes("does not exist")) ||
    lowerCombined.includes("no provider") ||
    lowerCombined.includes("routing")
  ) {
    const defaultMsg =
      httpStatus === 404
        ? "Маршрут или указанная модель не найдены на сервере FreeLLMAPI (HTTP 404)."
        : "Указанная модель недоступна или некорректно настроена маршрутизация.";
    return {
      category: "model_routing_error",
      label: getCategoryLabel("model_routing_error"),
      message: safeUpstream ? `${defaultMsg} ${safeUpstream}` : defaultMsg,
      httpStatus,
    };
  }

  // 7. Generic generation / malformed payload failure
  const fallbackMsg =
    safeUpstream ||
    sanitizeFreeLlmSecretText(combinedErrText, secrets) ||
    (params.context === "health"
      ? "Не удалось получить корректный ответ от эндпоинта моделей FreeLLMAPI."
      : "Модель не вернула корректный текст ответа при проверке генерации.");

  return {
    category: "generation_error",
    label: getCategoryLabel("generation_error"),
    message: fallbackMsg,
    httpStatus,
  };
}

export function computeFreeLlmInfraStatus(params: {
  apiAvailable: boolean;
  authStatus: FreeLlmAuthStatus;
  modelsAvailable: boolean;
  latencyMs: number;
  lastError: FreeLlmDiagnosticError | null;
}): FreeLlmConnectionState {
  if (!params.apiAvailable || params.authStatus !== "ok") {
    return "disconnected";
  }
  if (!params.modelsAvailable || params.lastError !== null || params.latencyMs >= HIGH_LATENCY_DEGRADED_MS) {
    return "degraded";
  }
  return "connected";
}

function detectTunnelAuthOrHtml(response: Response): {
  tunnelAuthRequired: boolean;
  isHtml: boolean;
} {
  const wwwAuth = (response.headers.get("www-authenticate") ?? "").toLowerCase();
  const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
  const location = response.headers.get("location") ?? "";
  const isHtml = contentType.includes("text/html");

  if (
    response.status === 302 ||
    response.status === 307 ||
    location.includes("visualstudio.com") ||
    location.includes("devtunnels.ms") ||
    location.includes("github.com/login") ||
    location.includes("login.microsoftonline.com")
  ) {
    return { tunnelAuthRequired: true, isHtml };
  }

  if (wwwAuth.includes("tunnel") || (isHtml && (response.status === 401 || response.status === 403))) {
    return { tunnelAuthRequired: true, isHtml };
  }

  if (isHtml) {
    return { tunnelAuthRequired: true, isHtml: true };
  }

  return { tunnelAuthRequired: false, isHtml: false };
}

function extractCompletionContent(payload: RawCompletionPayload | null): string {
  const msg = payload?.choices?.[0]?.message;
  if (!msg) return "";
  if (typeof msg.content === "string" && msg.content.trim()) return msg.content.trim();
  if (typeof msg.reasoning_content === "string" && msg.reasoning_content.trim()) {
    return msg.reasoning_content.trim();
  }
  if (typeof msg.reasoning === "string" && msg.reasoning.trim()) return msg.reasoning.trim();
  return "";
}

/**
 * Lightweight backend health check: ONLY performs `GET ${baseUrl}/models`.
 * Never invokes chat completions or exposes API keys.
 */
export async function checkFreeLlmHealth(
  config: FreeLlmDiagnosticConfig,
  fetchFn: typeof fetch = fetch
): Promise<FreeLlmHealthResult> {
  const checkedAt = new Date().toISOString();
  const baseUrl = normalizeDiagnosticBaseUrl(config.FREELLM_API_BASE_URL);
  const rawKey = (config.FREELLM_API_KEY ?? "").trim();
  const configuredModel = (config.FREELLM_MODEL ?? "auto").trim() || "auto";
  const endpointHost = extractSafeEndpointHost(baseUrl || config.FREELLM_API_BASE_URL);
  const secrets = [config.FREELLM_API_KEY, config.FREELLM_FALLBACK_API_KEY];

  if (!baseUrl || !endpointHost) {
    return {
      status: "disconnected",
      apiAvailable: false,
      authStatus: isPlaceholderApiKey(rawKey) ? "unconfigured" : "failed",
      modelsAvailable: false,
      modelCount: 0,
      availableModelsSample: [],
      configuredModel,
      endpointHost,
      httpStatus: null,
      latencyMs: 0,
      checkedAt,
      lastError: {
        category: "config_error",
        label: getCategoryLabel("config_error"),
        message: "Переменная FREELLM_API_BASE_URL не задана или имеет некорректный формат URL.",
        httpStatus: null,
      },
    };
  }

  if (isPlaceholderApiKey(rawKey)) {
    return {
      status: "disconnected",
      apiAvailable: false,
      authStatus: "unconfigured",
      modelsAvailable: false,
      modelCount: 0,
      availableModelsSample: [],
      configuredModel,
      endpointHost,
      httpStatus: null,
      latencyMs: 0,
      checkedAt,
      lastError: {
        category: "auth_error",
        label: getCategoryLabel("auth_error"),
        message: "API-ключ FREELLM_API_KEY не настроен на сервере.",
        httpStatus: null,
      },
    };
  }

  const timeoutMs = Math.min(
    Math.max(2_000, config.FREELLM_TIMEOUT_MS ?? HEALTH_CHECK_TIMEOUT_CAP_MS),
    HEALTH_CHECK_TIMEOUT_CAP_MS
  );
  const startedAt = Date.now();

  try {
    const response = await fetchFn(`${baseUrl}/models`, {
      method: "GET",
      headers: buildDiagnosticHeaders(rawKey, false, baseUrl),
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });

    const latencyMs = Math.max(0, Date.now() - startedAt);
    const { tunnelAuthRequired, isHtml } = detectTunnelAuthOrHtml(response);

    if (tunnelAuthRequired || isHtml || response.status === 302 || response.status === 307) {
      const diagError = classifyFreeLlmDiagnosticError({
        httpStatus: response.status,
        tunnelAuthRequired: true,
        contentType: response.headers.get("content-type"),
        context: "health",
        secrets,
      });
      return {
        status: "disconnected",
        apiAvailable: false,
        authStatus: "failed",
        modelsAvailable: false,
        modelCount: 0,
        availableModelsSample: [],
        configuredModel,
        endpointHost,
        httpStatus: response.status,
        latencyMs,
        checkedAt,
        lastError: diagError,
      };
    }

    if (!response.ok) {
      const errBody = (await response.json().catch(() => null)) as RawModelsPayload | null;
      const upstreamMessage =
        typeof errBody?.error?.message === "string" ? errBody.error.message : null;
      const diagError = classifyFreeLlmDiagnosticError({
        httpStatus: response.status,
        upstreamMessage,
        context: "health",
        secrets,
      });

      const isAuthFailure = response.status === 401 || response.status === 403;
      const isUpstreamReachableButDegraded =
        response.status === 429 || response.status === 400 || response.status === 404;

      const apiAvailable = isUpstreamReachableButDegraded;
      const authStatus: FreeLlmAuthStatus = isAuthFailure
        ? "failed"
        : isUpstreamReachableButDegraded
          ? "ok"
          : "failed";

      return {
        status: computeFreeLlmInfraStatus({
          apiAvailable,
          authStatus,
          modelsAvailable: false,
          latencyMs,
          lastError: diagError,
        }),
        apiAvailable,
        authStatus,
        modelsAvailable: false,
        modelCount: 0,
        availableModelsSample: [],
        configuredModel,
        endpointHost,
        httpStatus: response.status,
        latencyMs,
        checkedAt,
        lastError: diagError,
      };
    }

    const parsed = (await response.json().catch(() => null)) as RawModelsPayload | null;
    if (!parsed || !Array.isArray(parsed.data)) {
      const parseErr: FreeLlmDiagnosticError = {
        category: "generation_error",
        label: getCategoryLabel("generation_error"),
        message: "Эндпоинт /models вернул ответ в неожиданном формате (ожидался JSON со списком data).",
        httpStatus: response.status,
      };
      return {
        status: "degraded",
        apiAvailable: true,
        authStatus: "ok",
        modelsAvailable: false,
        modelCount: 0,
        availableModelsSample: [],
        configuredModel,
        endpointHost,
        httpStatus: response.status,
        latencyMs,
        checkedAt,
        lastError: parseErr,
      };
    }

    const modelIds = parsed.data
      .map((item) => item?.id)
      .filter((id): id is string => typeof id === "string" && id.trim().length > 0);
    const modelCount = modelIds.length;
    const sample = modelIds.slice(0, 6);

    if (modelCount === 0) {
      const emptyModelsErr: FreeLlmDiagnosticError = {
        category: "model_routing_error",
        label: getCategoryLabel("model_routing_error"),
        message: "Шлюз FreeLLMAPI доступен, но список доступных моделей пуст.",
        httpStatus: response.status,
      };
      return {
        status: "degraded",
        apiAvailable: true,
        authStatus: "ok",
        modelsAvailable: false,
        modelCount: 0,
        availableModelsSample: [],
        configuredModel,
        endpointHost,
        httpStatus: response.status,
        latencyMs,
        checkedAt,
        lastError: emptyModelsErr,
      };
    }

    if (configuredModel !== "auto" && !modelIds.includes(configuredModel)) {
      const missingModelErr: FreeLlmDiagnosticError = {
        category: "model_routing_error",
        label: getCategoryLabel("model_routing_error"),
        message: `Настроенная модель «${configuredModel}» отсутствует в списке моделей шлюза.`,
        httpStatus: response.status,
      };
      return {
        status: "degraded",
        apiAvailable: true,
        authStatus: "ok",
        modelsAvailable: false,
        modelCount,
        availableModelsSample: sample,
        configuredModel,
        endpointHost,
        httpStatus: response.status,
        latencyMs,
        checkedAt,
        lastError: missingModelErr,
      };
    }

    return {
      status: computeFreeLlmInfraStatus({
        apiAvailable: true,
        authStatus: "ok",
        modelsAvailable: true,
        latencyMs,
        lastError: null,
      }),
      apiAvailable: true,
      authStatus: "ok",
      modelsAvailable: true,
      modelCount,
      availableModelsSample: sample,
      configuredModel,
      endpointHost,
      httpStatus: response.status,
      latencyMs,
      checkedAt,
      lastError: null,
    };
  } catch (err) {
    const latencyMs = Math.max(0, Date.now() - startedAt);
    const diagError = classifyFreeLlmDiagnosticError({
      error: err,
      httpStatus: null,
      context: "health",
      secrets,
    });
    return {
      status: "disconnected",
      apiAvailable: false,
      authStatus: "failed",
      modelsAvailable: false,
      modelCount: 0,
      availableModelsSample: [],
      configuredModel,
      endpointHost,
      httpStatus: null,
      latencyMs,
      checkedAt,
      lastError: diagError,
    };
  }
}

/**
 * Manual generation probe triggered strictly by Admin button click (`POST /api/v1/admin/freellm/test-generation`).
 * Sends a minimal deterministic non-streaming completion prompt through configured FreeLLMAPI endpoints.
 */
export async function testFreeLlmGeneration(
  config: FreeLlmDiagnosticConfig,
  fetchFn: typeof fetch = fetch
): Promise<FreeLlmGenerationTestResult> {
  const checkedAt = new Date().toISOString();
  const secrets = [config.FREELLM_API_KEY, config.FREELLM_FALLBACK_API_KEY];
  const timeoutMs = Math.min(
    Math.max(3_000, config.FREELLM_TIMEOUT_MS ?? GENERATION_TEST_TIMEOUT_CAP_MS),
    GENERATION_TEST_TIMEOUT_CAP_MS
  );

  const endpoints: Array<{
    name: "primary" | "fallback";
    baseUrl: string;
    apiKey: string;
    model: string;
  }> = [];

  const primaryBase = normalizeDiagnosticBaseUrl(config.FREELLM_API_BASE_URL);
  const primaryKey = (config.FREELLM_API_KEY ?? "").trim();
  const primaryModel = (config.FREELLM_MODEL ?? "auto").trim() || "auto";

  if (primaryBase && !isPlaceholderApiKey(primaryKey)) {
    endpoints.push({
      name: "primary",
      baseUrl: primaryBase,
      apiKey: primaryKey,
      model: primaryModel,
    });
  }

  const fallbackBase = normalizeDiagnosticBaseUrl(config.FREELLM_FALLBACK_BASE_URL);
  const fallbackKey = (config.FREELLM_FALLBACK_API_KEY ?? "").trim();
  const fallbackModel = (config.FREELLM_FALLBACK_MODEL ?? primaryModel).trim() || "auto";

  if (fallbackBase && !isPlaceholderApiKey(fallbackKey)) {
    endpoints.push({
      name: "fallback",
      baseUrl: fallbackBase,
      apiKey: fallbackKey,
      model: fallbackModel,
    });
  }

  if (endpoints.length === 0) {
    return {
      success: false,
      status: "disconnected",
      endpointUsed: null,
      route: null,
      modelUsed: primaryModel,
      httpStatus: null,
      latencyMs: 0,
      checkedAt,
      error: !primaryBase
        ? {
            category: "config_error",
            label: getCategoryLabel("config_error"),
            message: "Переменная FREELLM_API_BASE_URL не настроена.",
            httpStatus: null,
          }
        : {
            category: "auth_error",
            label: getCategoryLabel("auth_error"),
            message: "API-ключ FREELLM_API_KEY не настроен на сервере.",
            httpStatus: null,
          },
    };
  }

  let lastResult: FreeLlmGenerationTestResult | null = null;
  const startedAt = Date.now();

  for (let i = 0; i < endpoints.length; i++) {
    const ep = endpoints[i];
    const hasFallback = i < endpoints.length - 1;
    const route = "/v1/chat/completions";
    const attemptStart = Date.now();

    try {
      const response = await fetchFn(`${ep.baseUrl}/chat/completions`, {
        method: "POST",
        headers: buildDiagnosticHeaders(ep.apiKey, true, ep.baseUrl),
        redirect: "manual",
        body: JSON.stringify({
          model: ep.model,
          messages: [{ role: "user", content: "Reply with a single word: OK" }],
          max_tokens: 16,
          stream: false,
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });

      const latencyMs = Math.max(0, Date.now() - attemptStart);
      const { tunnelAuthRequired, isHtml } = detectTunnelAuthOrHtml(response);

      if (tunnelAuthRequired || isHtml || response.status === 302 || response.status === 307) {
        const diagErr = classifyFreeLlmDiagnosticError({
          httpStatus: response.status,
          tunnelAuthRequired: true,
          contentType: response.headers.get("content-type"),
          context: "generation",
          secrets,
        });
        lastResult = {
          success: false,
          status: "disconnected",
          endpointUsed: ep.name,
          route,
          modelUsed: ep.model,
          httpStatus: response.status,
          latencyMs,
          checkedAt,
          error: diagErr,
        };
        if (hasFallback) continue;
        return lastResult;
      }

      const payload = (await response.json().catch(() => null)) as RawCompletionPayload | null;

      if (!response.ok) {
        const upstreamMessage =
          typeof payload?.error?.message === "string" ? payload.error.message : null;
        const diagErr = classifyFreeLlmDiagnosticError({
          httpStatus: response.status,
          upstreamMessage,
          context: "generation",
          secrets,
        });
        const state: FreeLlmConnectionState =
          diagErr.category === "auth_error" ? "disconnected" : "degraded";
        lastResult = {
          success: false,
          status: state,
          endpointUsed: ep.name,
          route,
          modelUsed: ep.model,
          httpStatus: response.status,
          latencyMs,
          checkedAt,
          error: diagErr,
        };
        if (hasFallback && diagErr.category !== "auth_error") {
          continue;
        }
        return lastResult;
      }

      const content = extractCompletionContent(payload);
      const returnedModel =
        typeof payload?.model === "string" && payload.model.trim()
          ? payload.model.trim()
          : ep.model;

      if (!content) {
        const upstreamMessage =
          typeof payload?.error?.message === "string" ? payload.error.message : null;
        const diagErr = classifyFreeLlmDiagnosticError({
          httpStatus: response.status,
          upstreamMessage: upstreamMessage || "FreeLLMAPI вернул пустой ответ при тесте генерации.",
          context: "generation",
          secrets,
        });
        lastResult = {
          success: false,
          status: "degraded",
          endpointUsed: ep.name,
          route,
          modelUsed: returnedModel,
          httpStatus: response.status,
          latencyMs,
          checkedAt,
          error: diagErr,
        };
        if (hasFallback) continue;
        return lastResult;
      }

      return {
        success: true,
        status: latencyMs >= HIGH_LATENCY_DEGRADED_MS ? "degraded" : "connected",
        endpointUsed: ep.name,
        route,
        modelUsed: returnedModel,
        httpStatus: response.status,
        latencyMs,
        checkedAt,
        error: null,
      };
    } catch (err) {
      const latencyMs = Math.max(0, Date.now() - attemptStart);
      const diagErr = classifyFreeLlmDiagnosticError({
        error: err,
        httpStatus: null,
        context: "generation",
        secrets,
      });
      lastResult = {
        success: false,
        status: diagErr.category === "dns_network_error" || diagErr.category === "timeout"
          ? "disconnected"
          : "degraded",
        endpointUsed: ep.name,
        route,
        modelUsed: ep.model,
        httpStatus: null,
        latencyMs,
        checkedAt,
        error: diagErr,
      };
      if (hasFallback) continue;
      return lastResult;
    }
  }

  return (
    lastResult ?? {
      success: false,
      status: "disconnected",
      endpointUsed: null,
      route: null,
      modelUsed: primaryModel,
      httpStatus: null,
      latencyMs: Math.max(0, Date.now() - startedAt),
      checkedAt,
      error: {
        category: "generation_error",
        label: getCategoryLabel("generation_error"),
        message: "Не удалось выполнить тестовую генерацию.",
        httpStatus: null,
      },
    }
  );
}
