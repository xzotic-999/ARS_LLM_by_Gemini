import dotenv from 'dotenv';
import express, { type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  evaluateMessagesSecurityGuardrail,
  isSecurityRestrictedOutput,
  SECURITY_REFUSAL_MESSAGE,
} from './backend/src/services/instruction.js';

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

interface PreviewUserRecord {
  id: number;
  email: string;
  name: string;
  role: 'user' | 'admin';
  personalInstructions: string;
  quotas: {
    daily: { used: number; limit: number | null };
    monthly: { used: number; limit: number | null };
  };
}

interface PreviewMessageRecord {
  id: number;
  conversation_id: number;
  role: 'user' | 'assistant' | 'system';
  text: string;
  created_at: string;
}

interface PreviewConversationRecord {
  id: number;
  user_id: number;
  title: string | null;
  created_at: string;
  last_message_at: string | null;
  messages: PreviewMessageRecord[];
}

const previewUsers = new Map<string, PreviewUserRecord>([
  [
    'admin@ars_llm.local',
    {
      id: 1,
      email: 'admin@ars_llm.local',
      name: 'Администратор ИТ',
      role: 'admin',
      personalInstructions: '',
      quotas: {
        daily: { used: 3, limit: 100 },
        monthly: { used: 42, limit: 2000 },
      },
    },
  ],
  [
    'employee@company.kz',
    {
      id: 2,
      email: 'employee@company.kz',
      name: 'Сотрудник',
      role: 'user',
      personalInstructions: '',
      quotas: {
        daily: { used: 4, limit: 20 },
        monthly: { used: 38, limit: 500 },
      },
    },
  ],
]);

const previewSessions = new Map<string, string>(); // token -> email
const previewConversations = new Map<number, PreviewConversationRecord>();
let nextPreviewUserId = 3;
let nextPreviewConvId = 101;
let nextPreviewMsgId = 1001;

function deriveDefaultDisplayName(email: string, role: 'user' | 'admin'): string {
  if (role === 'admin') return 'Администратор ИТ';
  const localPart = email.split('@')[0] || 'Сотрудник';
  const formatted = localPart
    .replace(/[._-]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
  return formatted || 'Сотрудник';
}

function getPreviewSessionUser(req: Request): PreviewUserRecord | null {
  const authHeader = req.headers.authorization;
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    const email = previewSessions.get(token);
    if (email && previewUsers.has(email)) {
      return previewUsers.get(email) ?? null;
    }
  }

  const cookieHeader = req.headers.cookie;
  if (typeof cookieHeader === 'string') {
    const match = cookieHeader
      .split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith('ars_session='));
    if (match) {
      const token = decodeURIComponent(match.slice('ars_session='.length));
      const email = previewSessions.get(token);
      if (email && previewUsers.has(email)) {
        return previewUsers.get(email) ?? null;
      }
    }
  }

  return null;
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

  // --- Auth & Profile API (/api/v1/auth/*) ---
  app.post('/api/v1/auth/login', async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const rawEmail = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const rawPassword = typeof body.password === 'string' ? body.password : '';

    if (!rawEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail)) {
      res.status(400).json({
        error: { message: 'Укажите корректный корпоративный адрес электронной почты.' },
      });
      return;
    }

    if (!rawPassword) {
      res.status(400).json({
        error: { message: 'Введите пароль учётной записи.' },
      });
      return;
    }

    let userRecord = previewUsers.get(rawEmail);
    if (!userRecord) {
      const isAdminEmail =
        rawEmail === (process.env.ADMIN_BOOTSTRAP_EMAIL || 'admin@ars_llm.local').toLowerCase() ||
        rawEmail.startsWith('admin@');
      const role: 'user' | 'admin' = isAdminEmail ? 'admin' : 'user';
      userRecord = {
        id: nextPreviewUserId++,
        email: rawEmail,
        name: deriveDefaultDisplayName(rawEmail, role),
        role,
        personalInstructions: '',
        quotas: isAdminEmail
          ? { daily: { used: 2, limit: 100 }, monthly: { used: 24, limit: 2000 } }
          : { daily: { used: 4, limit: 20 }, monthly: { used: 38, limit: 500 } },
      };
      previewUsers.set(rawEmail, userRecord);
    }

    const sessionToken = randomUUID();
    previewSessions.set(sessionToken, userRecord.email);

    res.setHeader(
      'Set-Cookie',
      `ars_session=${encodeURIComponent(sessionToken)}; Path=/; HttpOnly; SameSite=None; Secure; Partitioned; Max-Age=86400`
    );

    res.status(200).json({
      user: {
        id: userRecord.id,
        email: userRecord.email,
        name: userRecord.name,
        role: userRecord.role,
        quotas: userRecord.quotas,
      },
      quotas: userRecord.quotas,
      sessionToken,
    });
  });

  app.post('/api/v1/auth/logout', (req: Request, res: Response) => {
    const authHeader = req.headers.authorization;
    if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
      previewSessions.delete(authHeader.slice(7).trim());
    }
    res.setHeader(
      'Set-Cookie',
      'ars_session=; Path=/; HttpOnly; SameSite=None; Secure; Partitioned; Max-Age=0'
    );
    res.status(200).json({ ok: true });
  });

  app.get('/api/v1/auth/me', (req: Request, res: Response) => {
    const userRecord = getPreviewSessionUser(req);
    if (!userRecord) {
      res.status(401).json({
        error: { message: 'Сессия не авторизована.' },
      });
      return;
    }

    res.status(200).json({
      user: {
        id: userRecord.id,
        email: userRecord.email,
        name: userRecord.name,
        role: userRecord.role,
        quotas: userRecord.quotas,
      },
      quotas: userRecord.quotas,
    });
  });

  app.get('/api/v1/auth/quotas', (req: Request, res: Response) => {
    const userRecord = getPreviewSessionUser(req);
    if (!userRecord) {
      res.status(401).json({
        error: { message: 'Сессия не авторизована.' },
      });
      return;
    }

    res.status(200).json({
      ...userRecord.quotas,
      quotas: userRecord.quotas,
    });
  });

  app.all('/api/v1/auth/quotas', (_req: Request, res: Response) => {
    res.status(403).json({
      error: {
        code: 'FORBIDDEN',
        message: 'Сотрудник не может изменять свои квоты запросов. Обратитесь к администратору.',
      },
    });
  });

  // --- Admin API (/api/v1/admin/*) ---
  app.get('/api/v1/admin/users', (req: Request, res: Response) => {
    const actor = getPreviewSessionUser(req);
    if (!actor) {
      res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Требуется вход в систему.' } });
      return;
    }
    if (actor.role !== 'admin') {
      res.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: 'Недостаточно прав. Только администратор может управлять квотами.',
        },
      });
      return;
    }
    const users = Array.from(previewUsers.values()).map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      created_at: new Date().toISOString(),
      quotas: u.quotas,
    }));
    res.status(200).json({ users });
  });

  app.get('/api/v1/admin/usage', (req: Request, res: Response) => {
    const actor = getPreviewSessionUser(req);
    if (!actor) {
      res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Требуется вход в систему.' } });
      return;
    }
    if (actor.role !== 'admin') {
      res.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: 'Недостаточно прав. Только администратор может просматривать статистику.',
        },
      });
      return;
    }
    res.status(200).json({
      summary: [{ event_type: 'model_call', count: 42 }],
      daily: [],
      events: [],
    });
  });

  app.put('/api/v1/admin/users/:id/quotas', (req: Request, res: Response) => {
    const actor = getPreviewSessionUser(req);
    if (!actor) {
      res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Требуется вход в систему.' } });
      return;
    }
    if (actor.role !== 'admin') {
      res.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: 'Недостаточно прав. Сотрудник не может изменять квоты запросов.',
        },
      });
      return;
    }

    const targetId = Number(req.params.id);
    const targetUser = Array.from(previewUsers.values()).find((u) => u.id === targetId);
    if (!targetUser) {
      res.status(404).json({ error: { message: 'Пользователь не найден.' } });
      return;
    }

    const { daily_limit, monthly_limit } = req.body ?? {};
    if (
      daily_limit !== null &&
      daily_limit !== undefined &&
      (typeof daily_limit !== 'number' || !Number.isInteger(daily_limit) || daily_limit < 0)
    ) {
      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Дневной лимит должен быть целым неотрицательным числом или null.',
        },
      });
      return;
    }
    if (
      monthly_limit !== null &&
      monthly_limit !== undefined &&
      (typeof monthly_limit !== 'number' || !Number.isInteger(monthly_limit) || monthly_limit < 0)
    ) {
      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Месячный лимит должен быть целым неотрицательным числом или null.',
        },
      });
      return;
    }
    if (
      typeof daily_limit === 'number' &&
      typeof monthly_limit === 'number' &&
      monthly_limit < daily_limit
    ) {
      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Месячный лимит не может быть меньше дневного лимита.',
        },
      });
      return;
    }

    targetUser.quotas = {
      daily: {
        used: targetUser.quotas.daily.used,
        limit: daily_limit === undefined ? targetUser.quotas.daily.limit : daily_limit,
      },
      monthly: {
        used: targetUser.quotas.monthly.used,
        limit: monthly_limit === undefined ? targetUser.quotas.monthly.limit : monthly_limit,
      },
    };
    previewUsers.set(targetUser.email, targetUser);

    res.status(200).json({
      user_id: targetUser.id,
      quotas: targetUser.quotas,
      message: 'Quota limits updated.',
    });
  });

  app.patch('/api/v1/auth/profile', async (req: Request, res: Response) => {
    const userRecord = getPreviewSessionUser(req);
    if (!userRecord) {
      res.status(401).json({
        error: { message: 'Сессия не авторизована.' },
      });
      return;
    }

    const { validateProfileSelfUpdatePayload } = await import(
      './backend/src/services/instruction.js'
    );
    const validation = validateProfileSelfUpdatePayload(req.body, {
      email: userRecord.email,
      role: userRecord.role,
    });

    if (!validation.ok) {
      res.status(validation.status).json({
        error: { message: validation.error },
      });
      return;
    }

    userRecord.name = validation.name;
    userRecord.personalInstructions = validation.personalInstructions;
    previewUsers.set(userRecord.email, userRecord);

    res.status(200).json({
      user: {
        id: userRecord.id,
        email: userRecord.email,
        name: userRecord.name,
        role: userRecord.role,
        quotas: userRecord.quotas,
      },
      personalInstructions: userRecord.personalInstructions,
    });
  });

  // --- Conversations & Messages API (/api/v1/conversations/*, /api/v1/messages/*) ---
  app.get('/api/v1/conversations', (req: Request, res: Response) => {
    const userRecord = getPreviewSessionUser(req);
    if (!userRecord) {
      res.status(401).json({ error: { message: 'Сессия не авторизована.' } });
      return;
    }
    const list = Array.from(previewConversations.values())
      .filter((c) => c.user_id === userRecord.id)
      .sort((a, b) => (b.last_message_at || b.created_at).localeCompare(a.last_message_at || a.created_at));
    res.status(200).json(list);
  });

  app.post('/api/v1/conversations', (req: Request, res: Response) => {
    const userRecord = getPreviewSessionUser(req);
    if (!userRecord) {
      res.status(401).json({ error: { message: 'Сессия не авторизована.' } });
      return;
    }
    const rawTitle = typeof req.body?.title === 'string' ? req.body.title.trim() : null;
    const now = new Date().toISOString();
    const conv: PreviewConversationRecord = {
      id: nextPreviewConvId++,
      user_id: userRecord.id,
      title: rawTitle || 'Новый диалог',
      created_at: now,
      last_message_at: now,
      messages: [],
    };
    previewConversations.set(conv.id, conv);
    res.status(201).json(conv);
  });

  app.get('/api/v1/conversations/:id', (req: Request, res: Response) => {
    const userRecord = getPreviewSessionUser(req);
    if (!userRecord) {
      res.status(401).json({ error: { message: 'Сессия не авторизована.' } });
      return;
    }
    const convId = Number(req.params.id);
    const conv = previewConversations.get(convId);
    if (!conv || conv.user_id !== userRecord.id) {
      res.status(404).json({ error: { message: 'Диалог не найден.' } });
      return;
    }
    res.status(200).json(conv);
  });

  app.patch('/api/v1/conversations/:id', (req: Request, res: Response) => {
    const userRecord = getPreviewSessionUser(req);
    if (!userRecord) {
      res.status(401).json({ error: { message: 'Сессия не авторизована.' } });
      return;
    }
    const convId = Number(req.params.id);
    const conv = previewConversations.get(convId);
    if (!conv || conv.user_id !== userRecord.id) {
      res.status(404).json({ error: { message: 'Диалог не найден.' } });
      return;
    }
    if (typeof req.body?.title === 'string' && req.body.title.trim()) {
      conv.title = req.body.title.trim();
    }
    res.status(200).json(conv);
  });

  app.delete('/api/v1/conversations/:id', (req: Request, res: Response) => {
    const userRecord = getPreviewSessionUser(req);
    if (!userRecord) {
      res.status(401).json({ error: { message: 'Сессия не авторизована.' } });
      return;
    }
    const convId = Number(req.params.id);
    const conv = previewConversations.get(convId);
    if (conv && conv.user_id === userRecord.id) {
      previewConversations.delete(convId);
    }
    res.status(204).end();
  });

  app.get('/api/v1/messages', (req: Request, res: Response) => {
    const userRecord = getPreviewSessionUser(req);
    if (!userRecord) {
      res.status(401).json({ error: { message: 'Сессия не авторизована.' } });
      return;
    }
    const convId = Number(req.query.conversation_id);
    const conv = previewConversations.get(convId);
    if (!conv || conv.user_id !== userRecord.id) {
      res.status(200).json([]);
      return;
    }
    res.status(200).json(conv.messages);
  });

  app.post('/api/v1/messages', (req: Request, res: Response) => {
    const userRecord = getPreviewSessionUser(req);
    if (!userRecord) {
      res.status(401).json({ error: { message: 'Сессия не авторизована.' } });
      return;
    }
    const convId = Number(req.body?.conversation_id);
    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
    const role: 'user' | 'assistant' | 'system' =
      req.body?.role === 'assistant' || req.body?.role === 'system' ? req.body.role : 'user';

    if (!text) {
      res.status(400).json({ error: { message: 'Текст сообщения не может быть пустым.' } });
      return;
    }

    // Check quota before accepting user prompt turn (actual reservation happens in /api/v1/chat/completions)
    if (role === 'user') {
      const { daily, monthly } = userRecord.quotas;
      if (daily.limit !== null && daily.used >= daily.limit) {
        res.status(429).json({
          error: {
            code: 'QUOTA_EXCEEDED',
            reason: 'daily_limit_exceeded',
            period: 'daily',
            message: `Исчерпан дневной лимит запросов (${daily.used} из ${daily.limit}). Обратитесь к администратору для увеличения квоты.`,
            contact_admin: true,
            quotas: userRecord.quotas,
          },
          quotas: userRecord.quotas,
        });
        return;
      }
      if (monthly.limit !== null && monthly.used >= monthly.limit) {
        res.status(429).json({
          error: {
            code: 'QUOTA_EXCEEDED',
            reason: 'monthly_limit_exceeded',
            period: 'monthly',
            message: `Исчерпан месячный лимит запросов (${monthly.used} из ${monthly.limit}). Обратитесь к администратору для увеличения квоты.`,
            contact_admin: true,
            quotas: userRecord.quotas,
          },
          quotas: userRecord.quotas,
        });
        return;
      }
    }

    let conv = previewConversations.get(convId);
    const now = new Date().toISOString();
    if (!conv) {
      conv = {
        id: Number.isFinite(convId) && convId > 0 ? convId : nextPreviewConvId++,
        user_id: userRecord.id,
        title: text.slice(0, 60),
        created_at: now,
        last_message_at: now,
        messages: [],
      };
      previewConversations.set(conv.id, conv);
    }

    const msg: PreviewMessageRecord = {
      id: nextPreviewMsgId++,
      conversation_id: conv.id,
      role,
      text,
      created_at: now,
    };
    conv.messages.push(msg);
    conv.last_message_at = now;

    res.status(201).json(msg);
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

    // Atomically check and reserve quota for authenticated session user BEFORE calling FreeLLMAPI
    const sessionUser = getPreviewSessionUser(req);
    let reservationSettled = false;
    const releasePreviewReservation = () => {
      if (!sessionUser || reservationSettled) return;
      reservationSettled = true;
      sessionUser.quotas.daily.used = Math.max(0, sessionUser.quotas.daily.used - 1);
      sessionUser.quotas.monthly.used = Math.max(0, sessionUser.quotas.monthly.used - 1);
    };
    const commitPreviewReservation = () => {
      if (!sessionUser || reservationSettled) return;
      reservationSettled = true;
    };

    if (sessionUser) {
      const { daily, monthly } = sessionUser.quotas;
      if (daily.limit !== null && daily.used >= daily.limit) {
        res.status(429).json({
          error: {
            code: 'QUOTA_EXCEEDED',
            reason: 'daily_limit_exceeded',
            period: 'daily',
            message: `Исчерпан дневной лимит запросов (${daily.used} из ${daily.limit}). Обратитесь к администратору для увеличения квоты.`,
            contact_admin: true,
            quotas: sessionUser.quotas,
          },
          quotas: sessionUser.quotas,
        });
        return;
      }
      if (monthly.limit !== null && monthly.used >= monthly.limit) {
        res.status(429).json({
          error: {
            code: 'QUOTA_EXCEEDED',
            reason: 'monthly_limit_exceeded',
            period: 'monthly',
            message: `Исчерпан месячный лимит запросов (${monthly.used} из ${monthly.limit}). Обратитесь к администратору для увеличения квоты.`,
            contact_admin: true,
            quotas: sessionUser.quotas,
          },
          quotas: sessionUser.quotas,
        });
        return;
      }
      // Atomically reserve 1 unit in both daily and monthly quotas prior to model call
      sessionUser.quotas.daily.used += 1;
      sessionUser.quotas.monthly.used += 1;
    }

    const guardrailResult = evaluateMessagesSecurityGuardrail(validMessages);
    const completionId = `chatcmpl-${randomUUID()}`;
    const created = Math.floor(Date.now() / 1000);

    if (guardrailResult.blocked) {
      commitPreviewReservation();
      if (stream) {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders();

        const refusalChunk = {
          id: completionId,
          object: 'chat.completion.chunk',
          created,
          choices: [
            {
              index: 0,
              delta: { content: guardrailResult.refusalMessage },
              finish_reason: null,
            },
          ],
        };
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
        res.write(`data: ${JSON.stringify(refusalChunk)}\n\n`);
        res.write(`data: ${JSON.stringify(doneChunk)}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }

      res.status(200).json({
        id: completionId,
        object: 'chat.completion',
        created,
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: guardrailResult.refusalMessage,
            },
            finish_reason: 'stop',
          },
        ],
        quotas: sessionUser?.quotas,
      });
      return;
    }

    const corporateInstruction = getCorporateInstruction();
    const trustedMessages = buildTrustedMessages(corporateInstruction, validMessages);
    const runtimeConfig = loadRuntimeConfig();

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

      const heartbeatInterval = setInterval(() => {
        if (!res.writableEnded && !abortController.signal.aborted) {
          res.write(': keep-alive\n\n');
        }
      }, 5_000);

      try {
        let inspectionBuffer = '';
        let bufferFlushed = false;
        let emittedChars = 0;

        for await (const token of streamChatWithFreeLlm(
          trustedMessages,
          abortController.signal,
          runtimeConfig
        )) {
          if (res.writableEnded || abortController.signal.aborted) {
            throw new Error('Request aborted');
          }

          if (!bufferFlushed) {
            inspectionBuffer += token;
            if (isSecurityRestrictedOutput(inspectionBuffer)) {
              abortController.abort();
              const refusalChunk = {
                id: completionId,
                object: 'chat.completion.chunk',
                created,
                choices: [
                  {
                    index: 0,
                    delta: { content: SECURITY_REFUSAL_MESSAGE },
                    finish_reason: null,
                  },
                ],
              };
              res.write(`data: ${JSON.stringify(refusalChunk)}\n\n`);
              emittedChars += SECURITY_REFUSAL_MESSAGE.length;
              bufferFlushed = true;
              inspectionBuffer = '';
              break;
            }
            if (inspectionBuffer.length >= 260) {
              bufferFlushed = true;
              emittedChars += inspectionBuffer.length;
              const initialChunk = {
                id: completionId,
                object: 'chat.completion.chunk',
                created,
                choices: [
                  {
                    index: 0,
                    delta: { content: inspectionBuffer },
                    finish_reason: null,
                  },
                ],
              };
              res.write(`data: ${JSON.stringify(initialChunk)}\n\n`);
              inspectionBuffer = '';
            }
            continue;
          }

          emittedChars += token.length;
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

        if (abortController.signal.aborted) {
          throw new Error('Request aborted');
        }

        if (!bufferFlushed && inspectionBuffer.length > 0 && !res.writableEnded) {
          const safeOut = isSecurityRestrictedOutput(inspectionBuffer)
            ? SECURITY_REFUSAL_MESSAGE
            : inspectionBuffer;
          emittedChars += safeOut.length;
          const finalContentChunk = {
            id: completionId,
            object: 'chat.completion.chunk',
            created,
            choices: [
              {
                index: 0,
                delta: { content: safeOut },
                finish_reason: null,
              },
            ],
          };
          res.write(`data: ${JSON.stringify(finalContentChunk)}\n\n`);
        }

        if (emittedChars === 0) {
          throw new Error('Empty stream response');
        }

        commitPreviewReservation();

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
        releasePreviewReservation();
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
        releasePreviewReservation();
        clearInterval(heartbeatInterval);
        if (!res.writableEnded) {
          res.end();
        }
      }
      return;
    }

    try {
      const rawReply = await chatWithFreeLlm(trustedMessages, runtimeConfig);
      const reply = isSecurityRestrictedOutput(rawReply) ? SECURITY_REFUSAL_MESSAGE : rawReply;
      commitPreviewReservation();
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
        quotas: sessionUser?.quotas,
      });
    } catch (err) {
      releasePreviewReservation();
      res.status(502).json({
        error: {
          code: 'BAD_GATEWAY',
          message:
            err instanceof Error ? err.message : 'Service temporarily unavailable',
        },
      });
    } finally {
      releasePreviewReservation();
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
