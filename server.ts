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
    };
    finish_reason?: string | null;
  }>;
  error?: {
    message?: string;
  };
}

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
  };
  if (apiKey && apiKey.trim().length > 0) {
    headers['Authorization'] = `Bearer ${apiKey.trim()}`;
  }
  if (baseUrl.includes('.devtunnels.ms')) {
    headers['X-Tunnel-Skip-AntiPhishing-Page'] = 'true';
  }
  return headers;
}

async function fetchWithFallback(
  messages: ChatMessage[],
  stream: boolean,
  signal: AbortSignal,
  cfg: FreeLlmRuntimeConfig
): Promise<globalThis.Response> {
  const primaryBase = normalizeV1BaseUrl(cfg.FREELLM_API_BASE_URL);
  const primaryUrl = `${primaryBase}/chat/completions`;

  try {
    const res = await fetch(primaryUrl, {
      method: 'POST',
      headers: buildHeaders(cfg.FREELLM_API_KEY, primaryBase),
      body: JSON.stringify({
        model: cfg.FREELLM_MODEL || 'auto',
        messages,
        stream,
      }),
      signal,
    });

    const contentType = res.headers.get('content-type') || '';
    if (res.ok && !contentType.includes('text/html')) {
      return res;
    }

    if (!cfg.FREELLM_FALLBACK_BASE_URL) {
      return res;
    }
  } catch (primaryErr) {
    if (signal.aborted || !cfg.FREELLM_FALLBACK_BASE_URL) {
      throw primaryErr;
    }
  }

  const fallbackBase = normalizeV1BaseUrl(cfg.FREELLM_FALLBACK_BASE_URL);
  const fallbackUrl = `${fallbackBase}/chat/completions`;
  return fetch(fallbackUrl, {
    method: 'POST',
    headers: buildHeaders(
      cfg.FREELLM_FALLBACK_API_KEY || cfg.FREELLM_API_KEY,
      fallbackBase
    ),
    body: JSON.stringify({
      model: cfg.FREELLM_FALLBACK_MODEL || cfg.FREELLM_MODEL || 'auto',
      messages,
      stream,
    }),
    signal,
  });
}

async function chatWithFreeLlm(
  messages: ChatMessage[],
  cfg: FreeLlmRuntimeConfig
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), cfg.FREELLM_TIMEOUT_MS);

  try {
    const response = await fetchWithFallback(
      messages,
      false,
      controller.signal,
      cfg
    );

    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('text/html')) {
      throw new Error(
        'FreeLLMAPI tunnel returned an HTML anti-phishing or gateway page instead of JSON. Ensure the VS Code Dev Tunnel is active and public.'
      );
    }

    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      throw new Error(
        `FreeLLMAPI returned HTTP ${response.status}${errBody ? `: ${errBody.slice(0, 200)}` : ''}`
      );
    }

    const data = (await response.json()) as OpenAiChatCompletionResponse;
    const content = data.choices?.[0]?.message?.content;

    if (typeof content !== 'string' || !content.trim()) {
      throw new Error('FreeLLMAPI returned an empty assistant response');
    }

    return content;
  } finally {
    clearTimeout(timeout);
  }
}

async function* streamChatWithFreeLlm(
  messages: ChatMessage[],
  callerSignal: AbortSignal | undefined,
  cfg: FreeLlmRuntimeConfig
): AsyncGenerator<string, void, unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), cfg.FREELLM_TIMEOUT_MS);

  const onCallerAbort = () => controller.abort();
  if (callerSignal) {
    if (callerSignal.aborted) {
      clearTimeout(timeout);
      return;
    }
    callerSignal.addEventListener('abort', onCallerAbort, { once: true });
  }

  try {
    const response = await fetchWithFallback(
      messages,
      true,
      controller.signal,
      cfg
    );

    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('text/html')) {
      throw new Error(
        'Туннель FreeLLMAPI вернул HTML-страницу вместо потока данных. Проверьте, что FreeLLMAPI и VS Code Dev Tunnel запущены на вашем компьютере.'
      );
    }

    if (!response.ok || !response.body) {
      const errBody = await response.text().catch(() => '');
      throw new Error(
        `FreeLLMAPI stream returned HTTP ${response.status}${errBody ? `: ${errBody.slice(0, 200)}` : ''}`
      );
    }

    if (contentType.includes('application/json')) {
      const data = (await response.json()) as OpenAiChatCompletionResponse;
      const fullContent = data.choices?.[0]?.message?.content;
      if (typeof fullContent === 'string' && fullContent.length > 0) {
        yield fullContent;
        return;
      }
      throw new Error('FreeLLMAPI returned empty JSON response');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line || !line.startsWith('data:')) continue;

        const payload = line.slice(5).trim();
        if (payload === '[DONE]') {
          return;
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

        const delta = parsed?.choices?.[0]?.delta?.content;
        if (typeof delta === 'string' && delta.length > 0) {
          yield delta;
        }
      }
    }
  } finally {
    clearTimeout(timeout);
    if (callerSignal) {
      callerSignal.removeEventListener('abort', onCallerAbort);
    }
  }
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
