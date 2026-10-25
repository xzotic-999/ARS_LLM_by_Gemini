import dotenv from 'dotenv';
import express, { type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface FreeLlmRuntimeConfig {
  FREELLM_API_BASE_URL: string;
  FREELLM_API_KEY: string;
  FREELLM_MODEL: string;
  FREELLM_TIMEOUT_MS: number;
  FREELLM_FALLBACK_BASE_URL?: string;
  FREELLM_FALLBACK_API_KEY?: string;
  FREELLM_FALLBACK_MODEL?: string;
}

interface OpenAiChatCompletionResponse {
  choices?: Array<{
    message?: {
      role?: string;
      content?: string | null;
      reasoning?: string | null;
      reasoning_content?: string | null;
    };
  }>;
  error?: {
    message?: string;
  };
}

interface OpenAiChatCompletionChunk {
  choices?: Array<{
    delta?: {
      content?: string | null;
      reasoning?: string | null;
      reasoning_content?: string | null;
    };
    finish_reason?: string | null;
  }>;
  error?: {
    message?: string;
  };
}

const PER_ATTEMPT_INITIAL_TIMEOUT_MS = 24_000;
const PER_CHUNK_IDLE_TIMEOUT_MS = 25_000;

function loadRuntimeConfig(): FreeLlmRuntimeConfig {
  dotenv.config({ path: path.resolve(__dirname, '.env'), override: true });

  let fileFallback: Partial<FreeLlmRuntimeConfig> = {};
  const fallbackCandidates = [
    path.resolve(__dirname, '.aistudio/runtime-config.json'),
    path.resolve(__dirname, 'backend/src/config/tunnelRuntime.json'),
  ];

  for (const candidatePath of fallbackCandidates) {
    try {
      if (fs.existsSync(candidatePath)) {
        const parsed = JSON.parse(fs.readFileSync(candidatePath, 'utf-8'));
        if (parsed && typeof parsed === 'object' && parsed.FREELLM_API_KEY) {
          fileFallback = parsed;
          break;
        }
      }
    } catch {
      // Ignore fallback file parse errors
    }
  }

  return {
    FREELLM_API_BASE_URL:
      process.env.FREELLM_API_BASE_URL?.trim() ||
      fileFallback.FREELLM_API_BASE_URL?.trim() ||
      'https://v7skvft7-31415.euw.devtunnels.ms/v1',
    FREELLM_API_KEY:
      process.env.FREELLM_API_KEY?.trim() ||
      fileFallback.FREELLM_API_KEY?.trim() ||
      '',
    FREELLM_MODEL:
      process.env.FREELLM_MODEL?.trim() ||
      fileFallback.FREELLM_MODEL?.trim() ||
      'auto',
    FREELLM_TIMEOUT_MS: Number(
      process.env.FREELLM_TIMEOUT_MS ?? fileFallback.FREELLM_TIMEOUT_MS ?? 120_000
    ),
    FREELLM_FALLBACK_BASE_URL: process.env.FREELLM_FALLBACK_BASE_URL?.trim() || '',
    FREELLM_FALLBACK_API_KEY: process.env.FREELLM_FALLBACK_API_KEY?.trim() || '',
    FREELLM_FALLBACK_MODEL: process.env.FREELLM_FALLBACK_MODEL?.trim() || 'auto',
  };
}

let cachedInstruction = '';

function getCorporateInstruction(): string {
  if (cachedInstruction) return cachedInstruction;
  const candidates = [
    process.env.INSTRUCTION_FILE_PATH,
    path.resolve(__dirname, 'Instruction.md'),
    path.resolve(process.cwd(), 'Instruction.md'),
  ].filter((p): p is string => Boolean(p));

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        const content = fs.readFileSync(candidate, 'utf-8').trim();
        if (content) {
          cachedInstruction = content;
          return cachedInstruction;
        }
      }
    } catch {
      // Try next candidate
    }
  }
  return '';
}

function buildTrustedMessages(
  corporateInstruction: string,
  clientMessages: ChatMessage[]
): ChatMessage[] {
  const nonSystemMessages = clientMessages.filter((m) => m.role !== 'system');
  if (!corporateInstruction.trim()) {
    return nonSystemMessages;
  }
  return [
    { role: 'system', content: corporateInstruction.trim() },
    ...nonSystemMessages,
  ];
}

function normalizeV1BaseUrl(rawBaseUrl: string): string {
  const trimmed = rawBaseUrl.trim().replace(/\/+$/, '');
  if (!trimmed) return 'http://127.0.0.1:31415/v1';
  if (trimmed.endsWith('/v1/chat/completions')) {
    return trimmed.slice(0, -'/chat/completions'.length);
  }
  if (trimmed.endsWith('/chat/completions')) {
    const withoutEndpoint = trimmed.slice(0, -'/chat/completions'.length);
    return withoutEndpoint.endsWith('/v1') ? withoutEndpoint : `${withoutEndpoint}/v1`;
  }
  if (trimmed.endsWith('/v1')) {
    return trimmed;
  }
  return `${trimmed}/v1`;
}

function buildHeaders(apiKey: string, baseUrl: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  };
  if (apiKey && apiKey.trim().length > 0) {
    headers['Authorization'] = `Bearer ${apiKey.trim()}`;
  }
  if (baseUrl.includes('.devtunnels.ms')) {
    headers['X-Tunnel-Skip-AntiPhishing-Page'] = 'true';
  }
  return headers;
}

function isRetryableHttpStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function readWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  onTimeout: () => void
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      onTimeout();
      reject(new Error(`Upstream read timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    promise.then(
      (val) => {
        clearTimeout(timer);
        resolve(val);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

async function singleUnaryCompletionAttempt(
  messages: ChatMessage[],
  baseUrl: string,
  apiKey: string,
  model: string,
  timeoutMs: number,
  callerSignal?: AbortSignal
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  callerSignal?.addEventListener('abort', onAbort, { once: true });

  try {
    const normalizedBase = normalizeV1BaseUrl(baseUrl);
    const response = await fetch(`${normalizedBase}/chat/completions`, {
      method: 'POST',
      headers: buildHeaders(apiKey, normalizedBase),
      body: JSON.stringify({
        model: model || 'auto',
        messages,
        stream: false,
      }),
      signal: controller.signal,
    });

    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('text/html')) {
      throw new Error(
        `Туннель FreeLLMAPI вернул HTML-страницу (HTTP ${response.status}). Убедитесь, что FreeLLMAPI и VS Code Dev Tunnel активны.`
      );
    }

    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      throw new Error(
        `FreeLLMAPI returned HTTP ${response.status}${errBody ? `: ${errBody.slice(0, 160)}` : ''}`
      );
    }

    const data = (await response.json()) as OpenAiChatCompletionResponse;
    const msg = data.choices?.[0]?.message;
    const content = msg?.content?.trim() || msg?.reasoning_content?.trim() || msg?.reasoning?.trim() || '';

    if (!content) {
      throw new Error('FreeLLMAPI returned an empty assistant response');
    }

    return content;
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener('abort', onAbort);
  }
}

async function chatWithFreeLlm(
  messages: ChatMessage[],
  cfg: FreeLlmRuntimeConfig,
  callerSignal?: AbortSignal
): Promise<string> {
  const attempts: Array<{ baseUrl: string; apiKey: string; model: string; timeoutMs: number }> = [
    {
      baseUrl: cfg.FREELLM_API_BASE_URL,
      apiKey: cfg.FREELLM_API_KEY,
      model: cfg.FREELLM_MODEL || 'auto',
      timeoutMs: 28_000,
    },
    {
      baseUrl: cfg.FREELLM_API_BASE_URL,
      apiKey: cfg.FREELLM_API_KEY,
      model: cfg.FREELLM_MODEL || 'auto',
      timeoutMs: 35_000,
    },
  ];

  if (cfg.FREELLM_FALLBACK_BASE_URL) {
    attempts.push({
      baseUrl: cfg.FREELLM_FALLBACK_BASE_URL,
      apiKey: cfg.FREELLM_FALLBACK_API_KEY || cfg.FREELLM_API_KEY,
      model: cfg.FREELLM_FALLBACK_MODEL || cfg.FREELLM_MODEL || 'auto',
      timeoutMs: 35_000,
    });
  }

  let lastError: Error | null = null;
  for (const attempt of attempts) {
    if (callerSignal?.aborted) {
      throw new Error('Request aborted');
    }
    try {
      return await singleUnaryCompletionAttempt(
        messages,
        attempt.baseUrl,
        attempt.apiKey,
        attempt.model,
        attempt.timeoutMs,
        callerSignal
      );
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }

  throw lastError ?? new Error('FreeLLMAPI request failed');
}

async function* streamChatWithFreeLlm(
  messages: ChatMessage[],
  callerSignal: AbortSignal | undefined,
  cfg: FreeLlmRuntimeConfig
): AsyncGenerator<string, void, unknown> {
  const streamAttempts: Array<{
    baseUrl: string;
    apiKey: string;
    model: string;
    initialTimeoutMs: number;
  }> = [
    {
      baseUrl: cfg.FREELLM_API_BASE_URL,
      apiKey: cfg.FREELLM_API_KEY,
      model: cfg.FREELLM_MODEL || 'auto',
      initialTimeoutMs: PER_ATTEMPT_INITIAL_TIMEOUT_MS,
    },
    {
      baseUrl: cfg.FREELLM_API_BASE_URL,
      apiKey: cfg.FREELLM_API_KEY,
      model: cfg.FREELLM_MODEL || 'auto',
      initialTimeoutMs: PER_ATTEMPT_INITIAL_TIMEOUT_MS,
    },
  ];

  if (cfg.FREELLM_FALLBACK_BASE_URL) {
    streamAttempts.push({
      baseUrl: cfg.FREELLM_FALLBACK_BASE_URL,
      apiKey: cfg.FREELLM_FALLBACK_API_KEY || cfg.FREELLM_API_KEY,
      model: cfg.FREELLM_FALLBACK_MODEL || cfg.FREELLM_MODEL || 'auto',
      initialTimeoutMs: PER_ATTEMPT_INITIAL_TIMEOUT_MS,
    });
  }

  let totalYieldedTokens = 0;
  let lastError: Error | null = null;

  for (let attemptIdx = 0; attemptIdx < streamAttempts.length; attemptIdx++) {
    if (callerSignal?.aborted) return;

    const attempt = streamAttempts[attemptIdx];
    const controller = new AbortController();
    const initialTimer = setTimeout(() => controller.abort(), attempt.initialTimeoutMs);

    const onCallerAbort = () => controller.abort();
    callerSignal?.addEventListener('abort', onCallerAbort, { once: true });

    let reasoningFallbackBuffer = '';

    try {
      const normalizedBase = normalizeV1BaseUrl(attempt.baseUrl);
      const response = await fetch(`${normalizedBase}/chat/completions`, {
        method: 'POST',
        headers: buildHeaders(attempt.apiKey, normalizedBase),
        body: JSON.stringify({
          model: attempt.model,
          messages,
          stream: true,
        }),
        signal: controller.signal,
      });

      clearTimeout(initialTimer);

      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('text/html')) {
        throw new Error(
          `Туннель FreeLLMAPI вернул HTML-страницу (HTTP ${response.status}). Проверьте, что FreeLLMAPI и VS Code Dev Tunnel запущены.`
        );
      }

      if (!response.ok || !response.body) {
        const status = response.status;
        const errBody = await response.text().catch(() => '');
        const statusErr = new Error(
          `FreeLLMAPI stream returned HTTP ${status}${errBody ? `: ${errBody.slice(0, 140)}` : ''}`
        );
        if (isRetryableHttpStatus(status) && totalYieldedTokens === 0) {
          lastError = statusErr;
          continue;
        }
        throw statusErr;
      }

      if (contentType.includes('application/json')) {
        const data = (await response.json()) as OpenAiChatCompletionResponse;
        const msg = data.choices?.[0]?.message;
        const fullContent =
          msg?.content?.trim() || msg?.reasoning_content?.trim() || msg?.reasoning?.trim() || '';
        if (fullContent.length > 0) {
          totalYieldedTokens++;
          yield fullContent;
          return;
        }
        throw new Error('FreeLLMAPI returned empty JSON response');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      try {
        while (true) {
          if (callerSignal?.aborted) return;

          const { done, value } = await readWithTimeout(
            reader.read(),
            PER_CHUNK_IDLE_TIMEOUT_MS,
            () => controller.abort()
          );
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const rawLine of lines) {
            const line = rawLine.trim();
            if (!line || !line.startsWith('data:')) continue;

            const payload = line.slice(5).trim();
            if (payload === '[DONE]') {
              if (totalYieldedTokens > 0) {
                return;
              }
              if (reasoningFallbackBuffer.trim().length > 0) {
                totalYieldedTokens++;
                yield reasoningFallbackBuffer.trim();
                return;
              }
              break;
            }

            let parsed: OpenAiChatCompletionChunk | null = null;
            try {
              parsed = JSON.parse(payload) as OpenAiChatCompletionChunk;
            } catch {
              continue;
            }

            if (parsed?.error?.message) {
              throw new Error(parsed.error.message);
            }

            const deltaObj = parsed?.choices?.[0]?.delta;
            const deltaContent = deltaObj?.content;
            if (typeof deltaContent === 'string' && deltaContent.length > 0) {
              totalYieldedTokens++;
              yield deltaContent;
            } else {
              const reasoningToken = deltaObj?.reasoning ?? deltaObj?.reasoning_content;
              if (typeof reasoningToken === 'string' && reasoningToken.length > 0) {
                reasoningFallbackBuffer += reasoningToken;
              }
            }
          }
        }
      } finally {
        reader.releaseLock();
      }

      if (totalYieldedTokens > 0) {
        return;
      }

      if (reasoningFallbackBuffer.trim().length > 0) {
        totalYieldedTokens++;
        yield reasoningFallbackBuffer.trim();
        return;
      }

      lastError = new Error('FreeLLMAPI stream ended without content tokens');
    } catch (err) {
      if (callerSignal?.aborted) return;
      if (totalYieldedTokens > 0) {
        // Already streamed partial reply to user; finish cleanly instead of failing whole message
        return;
      }
      lastError = err instanceof Error ? err : new Error(String(err));
    } finally {
      clearTimeout(initialTimer);
      callerSignal?.removeEventListener('abort', onCallerAbort);
    }
  }

  // Final Fallback Attempt: non-streaming request (stream: false), which lets FreeLLMAPI's
  // internal provider failover select a healthy model and return full JSON
  if (!callerSignal?.aborted && totalYieldedTokens === 0) {
    try {
      const unaryReply = await singleUnaryCompletionAttempt(
        messages,
        cfg.FREELLM_API_BASE_URL,
        cfg.FREELLM_API_KEY,
        cfg.FREELLM_MODEL || 'auto',
        32_000,
        callerSignal
      );
      if (unaryReply.trim().length > 0) {
        yield unaryReply;
        return;
      }
    } catch (unaryErr) {
      lastError = unaryErr instanceof Error ? unaryErr : lastError;
    }
  }

  throw (
    lastError ??
    new Error('Сервер FreeLLMAPI временно перегружен (HTTP 504). Пожалуйста, нажмите «Повторить запрос».')
  );
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT || 3000);

  app.use(express.json({ limit: '4mb' }));

  app.get('/api/v1/health', (_req: Request, res: Response) => {
    const cfg = loadRuntimeConfig();
    res.status(200).json({
      status: 'ok',
      providerConfigured: Boolean(cfg.FREELLM_API_BASE_URL && cfg.FREELLM_API_KEY),
      model: cfg.FREELLM_MODEL || 'auto',
    });
  });

  app.post('/api/v1/chat/completions', async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const rawMessages = body.messages;
    const stream = Boolean(body.stream);

    if (!Array.isArray(rawMessages) || rawMessages.length === 0 || rawMessages.length > 100) {
      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'messages must be an array with 1 to 100 items',
        },
      });
      return;
    }

    const validMessages: ChatMessage[] = [];
    for (const msg of rawMessages) {
      if (
        !msg ||
        typeof msg !== 'object' ||
        !['user', 'assistant', 'system'].includes((msg as ChatMessage).role) ||
        typeof (msg as ChatMessage).content !== 'string' ||
        !(msg as ChatMessage).content.trim()
      ) {
        res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Each message must have a valid role and non-empty string content',
          },
        });
        return;
      }
      validMessages.push({
        role: (msg as ChatMessage).role,
        content: (msg as ChatMessage).content,
      });
    }

    if (validMessages[validMessages.length - 1].role !== 'user') {
      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'The last message must have role "user"',
        },
      });
      return;
    }

    const corporateInstruction = getCorporateInstruction();
    const trustedMessages = buildTrustedMessages(corporateInstruction, validMessages);
    const runtimeConfig = loadRuntimeConfig();
    const completionId = `chatcmpl-${randomUUID()}`;
    const created = Math.floor(Date.now() / 1000);

    if (stream) {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders();

      const abortController = new AbortController();
      res.on('close', () => {
        if (!res.writableEnded) {
          abortController.abort();
        }
      });

      // Send SSE comment heartbeat every 5s so Cloud Run / proxies never drop the stream during model thinking or retry
      const heartbeatInterval = setInterval(() => {
        if (!res.writableEnded && !abortController.signal.aborted) {
          res.write(': keep-alive\n\n');
        }
      }, 5_000);

      try {
        for await (const token of streamChatWithFreeLlm(
          trustedMessages,
          abortController.signal,
          runtimeConfig
        )) {
          if (res.writableEnded || abortController.signal.aborted) break;
          const chunk = {
            id: completionId,
            object: 'chat.completion.chunk',
            created,
            choices: [
              {
                index: 0,
                delta: { content: token },
                finish_reason: null,
              },
            ],
          };
          res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        }

        if (!res.writableEnded && !abortController.signal.aborted) {
          const doneChunk = {
            id: completionId,
            object: 'chat.completion.chunk',
            created,
            choices: [
              {
                index: 0,
                delta: {},
                finish_reason: 'stop',
              },
            ],
          };
          res.write(`data: ${JSON.stringify(doneChunk)}\n\n`);
          res.write('data: [DONE]\n\n');
        }
      } catch (err) {
        if (!res.writableEnded && !abortController.signal.aborted) {
          const errMsg =
            err instanceof Error ? err.message : 'Service temporarily unavailable';
          res.write(
            `event: error\ndata: ${JSON.stringify({
              error: { code: 'BAD_GATEWAY', message: errMsg },
            })}\n\n`
          );
        }
      } finally {
        clearInterval(heartbeatInterval);
        if (!res.writableEnded) {
          res.end();
        }
      }
      return;
    }

    try {
      const reply = await chatWithFreeLlm(trustedMessages, runtimeConfig);
      res.status(200).json({
        id: completionId,
        object: 'chat.completion',
        created,
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: reply,
            },
            finish_reason: 'stop',
          },
        ],
      });
    } catch (err) {
      res.status(502).json({
        error: {
          code: 'BAD_GATEWAY',
          message:
            err instanceof Error ? err.message : 'Service temporarily unavailable',
        },
      });
    }
  });

  // Return JSON 404 for unmounted /api/* endpoints so they never return index.html
  app.all('/api/*', (_req: Request, res: Response) => {
    res.status(404).json({
      error: {
        code: 'NOT_FOUND',
        message: 'API endpoint not configured in standalone server mode',
      },
    });
  });

  const distPath = path.resolve(__dirname, 'dist');
  const isProd =
    process.env.NODE_ENV === 'production' ||
    (fs.existsSync(path.join(distPath, 'index.html')) &&
      process.env.npm_lifecycle_event === 'start');

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`ARS_LLM server listening on http://0.0.0.0:${PORT} (mode: ${isProd ? 'production' : 'development'})`);
  });
}

startServer();
