import dotenv from 'dotenv';
import express, { type Request, type Response } from 'express';
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  sanitizeMessagesUntrustedAttachments,
  extractAndValidateAttachmentNode,
  MAX_ATTACHMENT_FILE_BYTES,
} from './backend/src/services/attachmentExtractor.ts';
import {
  fetchWeatherData,
  fetchExchangeRatesData,
  resolveAndEnrichMessagesWithExternalTools,
} from './backend/src/services/externalTools.ts';
import {
  checkFreeLlmHealth,
  testFreeLlmGeneration,
} from './backend/src/services/freeLlmDiagnostics.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const SECURITY_REFUSAL_MESSAGE =
  'В соответствии с политикой информационной безопасности ARS LLM я не обсуждаю уязвимости, векторы и типы атак, методы обхода защитных механизмов или способы компрометации ИИ-систем и инфраструктуры — в том числе в теоретическом или ознакомительном формате.\n\nЯ готов помочь вам с решением прикладных рабочих задач: разработкой и оптимизацией кода, анализом рабочей документации, подготовкой отчётов и планированием проектов.';

const RESTRICTED_PROMPT_PATTERNS: RegExp[] = [
  /(?:атак[а-яa-z]*|уязвимост[а-яa-z]*|взлом[а-яa-z]*|скомпрометир[а-яa-z]*|компрометац[а-яa-z]*|обойти|обход[а-яa-z]*|сломать|хакнуть)[\s\S]{0,80}(?:ars[\s_-]*llm|арс[\s_-]*ллм|ии[\s-]*систем|llm|языков[а-я]+\s+модел|нейросет|ассистент|бот|чат)/i,
  /(?:ars[\s_-]*llm|арс[\s_-]*ллм|ии[\s-]*систем[а-яa-z]*|llm|языков[а-я]+\s+модел[а-яa-z]*|нейросет[а-яa-z]*)[\s\S]{0,80}(?:подвержен[а-яa-z]*\s+атак|уязвимост|атак[а-яa-z]*|взлом[а-яa-z]*|обойти|обход|компрометац)/i,
  /(?:типы|виды|категории|categories|классификаци[а-я]+|векторы|методы|способы)\s+(?:атак|уязвимост|взлома)/i,
  /(?:атак[а-яa-z]+\s+на\s+модел|model\s+attacks|атак[а-яa-z]+\s+на\s+инфраструктур|infrastructure\s+attacks|атак[а-яa-z]+\s+на\s+параметры|model\s+parameter\s+attacks|атак[а-яa-z]+\s+на\s+цепочку\s+рассуждений)/i,
  /\b(?:prompt\s*injection|indirect\s*prompt\s*injection|adversarial\s*examples?|model\s*inversion|membership\s*inference|data\s*poisoning|jailbreak|джейлбрейк)\b/i,
  /(?:промпт[\s-]*инъекц|инъекци[а-я]+\s+промпт|инъекци[а-я]+\s+инструкц|косвенн[а-я]+\s+инъекц|прям[а-я]+\s+инъекц|состязательн[а-я]+\s+пример|состязательн[а-я]+\s+атак|отравлени[а-я]+\s+данных)/i,
  /(?:как\s+обойти|способ[а-я]*\s+обойти|обход[а-я]*)\s+(?:квот[а-я]*|лимит[а-я]*|ограничени[а-я]*|защит[а-я]*|фильтр[а-я]*|инструкци[а-я]*|правил[а-я]*|rate\s*limit)/i,
  /(?:игнорируй|забудь|отмени|пренебреги)[\s\S]{0,40}(?:предыдущ[а-я]+|системн[а-я]+|все)\s+(?:инструкци[а-я]+|правил[а-я]+|указани[а-я]+)/i,
  /\b(?:ignore|disregard|forget)\s+(?:all\s+)?(?:previous|prior|system)\s+(?:instructions|prompts|rules)\b/i,
  /(?:покажи|выведи|раскрой|напиши|повтори|цитируй)[\s\S]{0,40}(?:системн[а-я]+\s+промпт|системн[а-я]+\s+инструкци|instruction\.md)/i,
  /\b(?:show|reveal|print|repeat|dump)\s+(?:your\s+)?(?:system\s+prompt|system\s+instructions|initial\s+instructions)\b/i,
];

const RESTRICTED_OUTPUT_PATTERNS: RegExp[] = [
  /может\s+быть\s+подвержен[а-я]*\s+различным\s+типам\s+атак/i,
  /(?:categories|категории)\s+уязвимостей\s+и\s+методов/i,
  /(?:атаки\s+на\s+модель|model\s+attacks)/i,
  /(?:атаки\s+с\s+подменой\s+входных\s+данных|adversarial\s+examples)/i,
  /(?:атаки\s+на\s+цепочку\s+рассуждений|prompt\s+injection)/i,
  /(?:атаки\s+на\s+параметры\s+модели|model\s+parameter\s+attacks)/i,
  /(?:model\s+inversion|membership\s+inference)/i,
  /(?:атаки\s+на\s+pipeline\s+данных|data\s+pipeline\s+attacks)/i,
  /(?:атаки\s+на\s+систему\s+хранения|storage\s+attacks)/i,
  /(?:прям(?:ая|ой)\s+инъекция|косвенная\s+инъекция)[\s\S]{0,120}(?:запрос|команд|модел)/i,
  /做出错误的/,
];

function isSecurityRestrictedPrompt(text: string): boolean {
  if (!text || typeof text !== 'string') return false;
  const normalized = text.trim();
  if (!normalized) return false;
  return RESTRICTED_PROMPT_PATTERNS.some((pattern) => pattern.test(normalized));
}

function isSecurityRestrictedOutput(outputText: string): boolean {
  if (!outputText || typeof outputText !== 'string') return false;
  const normalized = outputText.trim();
  if (!normalized) return false;
  return RESTRICTED_OUTPUT_PATTERNS.some((pattern) => pattern.test(normalized));
}

function stripUntrustedAttachmentBlocksForGuardrail(text: string): string {
  return text
    .replace(/<untrusted_file_content\b[^>]*>[\s\S]*?<\/untrusted_file_content>/gi, ' ')
    .replace(/---\s*Содержимое файла\s+"[^"]+"\s*---[\s\S]*?---\s*Конец файла\s+"[^"]+"\s*---/g, ' ')
    .trim();
}

function evaluateMessagesSecurityGuardrail(
  messages: ChatMessage[]
): { blocked: true; refusalMessage: string } | { blocked: false } {
  const userMessages = messages.filter((m) => m.role === 'user');
  if (userMessages.length === 0) {
    return { blocked: false };
  }
  const latestUserMessage = userMessages[userMessages.length - 1];
  const userDirectPrompt = stripUntrustedAttachmentBlocksForGuardrail(latestUserMessage.content);
  if (isSecurityRestrictedPrompt(userDirectPrompt)) {
    return {
      blocked: true,
      refusalMessage: SECURITY_REFUSAL_MESSAGE,
    };
  }
  return { blocked: false };
}

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

  const isProd = process.env.NODE_ENV === 'production';
  let fileFallback: Partial<FreeLlmRuntimeConfig> = {};
  if (!isProd) {
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
  }

  const configuredBaseUrl =
    process.env.FREELLM_API_BASE_URL?.trim() ||
    (!isProd ? fileFallback.FREELLM_API_BASE_URL?.trim() || '' : '');

  const resolvedBaseUrl =
    isProd && configuredBaseUrl.toLowerCase().includes('.devtunnels.ms')
      ? ''
      : configuredBaseUrl;

  return {
    FREELLM_API_BASE_URL: resolvedBaseUrl,
    FREELLM_API_KEY:
      process.env.FREELLM_API_KEY?.trim() ||
      (!isProd ? fileFallback.FREELLM_API_KEY?.trim() || '' : ''),
    FREELLM_MODEL:
      process.env.FREELLM_MODEL?.trim() ||
      (!isProd ? fileFallback.FREELLM_MODEL?.trim() || 'auto' : 'auto'),
    FREELLM_TIMEOUT_MS: Number(
      process.env.FREELLM_TIMEOUT_MS ??
        (!isProd ? fileFallback.FREELLM_TIMEOUT_MS : undefined) ??
        120_000
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
  const nonSystemMessages = sanitizeMessagesUntrustedAttachments(
    clientMessages.filter((m) => m.role !== 'system')
  );
  if (!corporateInstruction.trim()) {
    return nonSystemMessages;
  }
  return [
    { role: 'system', content: corporateInstruction.trim() },
    ...nonSystemMessages,
  ];
}

function normalizeV1BaseUrl(rawBaseUrl: string): string {
  let trimmed = rawBaseUrl.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  if (trimmed.endsWith('/chat/completions')) {
    trimmed = trimmed.slice(0, -'/chat/completions'.length).replace(/\/+$/, '');
  }
  if (/\/(?:v\d+(?:beta\d*)?(?:\/openai)?|openai)$/i.test(trimmed)) {
    return trimmed;
  }
  return `${trimmed}/v1`;
}

function isDevTunnelHost(rawBaseUrl: string): boolean {
  try {
    const host = new URL(rawBaseUrl.trim()).hostname.toLowerCase();
    return host === 'devtunnels.ms' || host.endsWith('.devtunnels.ms');
  } catch {
    return false;
  }
}

function buildHeaders(apiKey: string, baseUrl: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  };
  if (apiKey && apiKey.trim().length > 0) {
    headers['Authorization'] = `Bearer ${apiKey.trim()}`;
  }
  if (isDevTunnelHost(baseUrl)) {
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
    if (!normalizedBase) {
      throw new Error('FREELLM_API_BASE_URL is not configured');
    }
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
      if (!normalizedBase) {
        throw new Error('FREELLM_API_BASE_URL is not configured');
      }
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
  role: 'user' | 'employee' | 'admin';
  is_active: boolean;
  passwordHash: string;
  created_at: string;
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
  archived_at: string | null;
  deleted_at: string | null;
  messages: PreviewMessageRecord[];
}

interface PreviewUsageEventRecord {
  id: number;
  user_id: number;
  user_email: string;
  event_type: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

function hashPreviewPassword(plainPassword: string): string {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(plainPassword, salt, 64).toString('hex');
  return `scrypt:${salt}:${derived}`;
}

function verifyPreviewPassword(plainPassword: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, salt, hashHex] = parts;
  if (!salt || !hashHex) return false;
  try {
    const expected = Buffer.from(hashHex, 'hex');
    const actual = scryptSync(plainPassword, salt, 64);
    if (expected.length !== actual.length) return false;
    return timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

const initialAdminEmail = (process.env.PREVIEW_ADMIN_EMAIL || 'admin@ars_llm.local').trim().toLowerCase();
const initialAdminPassword = process.env.PREVIEW_ADMIN_PASSWORD || 'ArsAdmin#2026';
const initialEmployeeEmail = 'employee@company.kz';
const initialEmployeePassword = process.env.PREVIEW_EMPLOYEE_PASSWORD || 'Employee#2026';

const previewUsers = new Map<string, PreviewUserRecord>([
  [
    initialAdminEmail,
    {
      id: 1,
      email: initialAdminEmail,
      name: 'Администратор ИТ',
      role: 'admin',
      is_active: true,
      passwordHash: hashPreviewPassword(initialAdminPassword),
      created_at: '2026-10-01T08:00:00.000Z',
      personalInstructions: '',
      quotas: {
        daily: { used: 3, limit: 100 },
        monthly: { used: 42, limit: 2000 },
      },
    },
  ],
  [
    initialEmployeeEmail,
    {
      id: 2,
      email: initialEmployeeEmail,
      name: 'Сотрудник',
      role: 'employee',
      is_active: true,
      passwordHash: hashPreviewPassword(initialEmployeePassword),
      created_at: '2026-10-05T09:30:00.000Z',
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
const previewUsageEvents: PreviewUsageEventRecord[] = [];
let nextPreviewUserId = 3;
let nextPreviewConvId = 101;
let nextPreviewMsgId = 1001;
let nextPreviewUsageEventId = 1;

function recordPreviewUsageEvent(
  user: PreviewUserRecord | null | undefined,
  eventType: string,
  metadata: Record<string, unknown> | null = null
): void {
  if (!user) return;
  previewUsageEvents.unshift({
    id: nextPreviewUsageEventId++,
    user_id: user.id,
    user_email: user.email,
    event_type: eventType,
    metadata,
    created_at: new Date().toISOString(),
  });
  if (previewUsageEvents.length > 200) {
    previewUsageEvents.length = 200;
  }
}

function extractPreviewSessionTokens(req: Request): string[] {
  const tokens: string[] = [];
  const authHeader = req.headers.authorization;
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    if (token) tokens.push(token);
  }
  const cookieHeader = req.headers.cookie;
  if (typeof cookieHeader === 'string') {
    const match = cookieHeader
      .split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith('ars_session='));
    if (match) {
      try {
        const token = decodeURIComponent(match.slice('ars_session='.length)).trim();
        if (token && !tokens.includes(token)) tokens.push(token);
      } catch {
        // Ignore malformed cookie encoding
      }
    }
  }
  return tokens;
}

function revokePreviewSessionsForEmail(email: string): void {
  const normalized = email.trim().toLowerCase();
  for (const [token, sessionEmail] of previewSessions.entries()) {
    if (sessionEmail.toLowerCase() === normalized) {
      previewSessions.delete(token);
    }
  }
}

function getPreviewSessionUser(req: Request): PreviewUserRecord | null {
  const tokens = extractPreviewSessionTokens(req);
  for (const token of tokens) {
    const email = previewSessions.get(token);
    if (!email) continue;
    const userRecord = previewUsers.get(email);
    if (!userRecord || !userRecord.is_active) {
      previewSessions.delete(token);
      continue;
    }
    return userRecord;
  }
  return null;
}

function requirePreviewAdmin(req: Request, res: Response): PreviewUserRecord | null {
  const actor = getPreviewSessionUser(req);
  if (!actor) {
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Требуется вход в систему.' } });
    return null;
  }
  if (actor.role !== 'admin') {
    res.status(403).json({
      error: {
        code: 'FORBIDDEN',
        message: 'Недостаточно прав. Доступ разрешён только администратору.',
      },
    });
    return null;
  }
  return actor;
}

function toPublicPreviewUser(u: PreviewUserRecord) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    is_active: u.is_active,
    email_verified: true,
    created_at: u.created_at,
    quotas: u.quotas,
  };
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT || 3000);

  app.use(express.json({ limit: '15mb' }));

  app.get('/api/v1/health', (_req: Request, res: Response) => {
    const cfg = loadRuntimeConfig();
    res.status(200).json({
      status: 'ok',
      providerConfigured: Boolean(cfg.FREELLM_API_BASE_URL && cfg.FREELLM_API_KEY),
      model: cfg.FREELLM_MODEL || 'auto',
    });
  });

  // --- Auth & Profile API (/api/v1/auth/*) ---
  // Public self-registration is strictly disabled: only accounts created by an administrator may log in.
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

    const userRecord = previewUsers.get(rawEmail);
    if (!userRecord || !verifyPreviewPassword(rawPassword, userRecord.passwordHash)) {
      res.status(401).json({
        error: {
          code: 'INVALID_CREDENTIALS',
          message:
            'Неверный корпоративный Email или пароль. Самостоятельная регистрация отключена — для получения доступа обратитесь к администратору.',
        },
      });
      return;
    }

    if (!userRecord.is_active) {
      res.status(403).json({
        error: {
          code: 'ACCOUNT_DISABLED',
          message: 'Учётная запись заблокирована администратором.',
        },
      });
      return;
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
        is_active: userRecord.is_active,
        quotas: userRecord.quotas,
      },
      quotas: userRecord.quotas,
      sessionToken,
    });
  });

  app.post('/api/v1/auth/logout', (req: Request, res: Response) => {
    for (const token of extractPreviewSessionTokens(req)) {
      previewSessions.delete(token);
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
        is_active: userRecord.is_active,
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
  app.post('/api/v1/admin/users', (req: Request, res: Response) => {
    const actor = requirePreviewAdmin(req, res);
    if (!actor) return;

    const body = (req.body ?? {}) as Record<string, unknown>;
    const rawName = typeof body.name === 'string' ? body.name.trim() : '';
    const rawEmail = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const rawPassword = typeof body.password === 'string' ? body.password : '';
    const rawRole = body.role === undefined ? 'employee' : body.role;
    const rawDaily = body.daily_limit;
    const rawMonthly = body.monthly_limit;

    if (!rawName || rawName.length > 120) {
      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Укажите имя сотрудника (от 1 до 120 символов).',
        },
      });
      return;
    }

    if (!rawEmail || rawEmail.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail)) {
      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Укажите корректный корпоративный Email.',
        },
      });
      return;
    }

    if (rawPassword.length < 8 || rawPassword.length > 128) {
      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Временный пароль должен содержать от 8 до 128 символов.',
        },
      });
      return;
    }

    if (rawRole !== 'employee' && rawRole !== 'admin') {
      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Допустимые роли пользователя: employee или admin.',
        },
      });
      return;
    }

    if (previewUsers.has(rawEmail)) {
      res.status(409).json({
        error: {
          code: 'CONFLICT',
          message: 'Пользователь с таким корпоративным Email уже существует.',
        },
      });
      return;
    }

    const dailyLimit: number | null =
      rawDaily === undefined || rawDaily === null
        ? null
        : typeof rawDaily === 'number' && Number.isInteger(rawDaily) && rawDaily >= 0
          ? rawDaily
          : NaN;
    const monthlyLimit: number | null =
      rawMonthly === undefined || rawMonthly === null
        ? null
        : typeof rawMonthly === 'number' && Number.isInteger(rawMonthly) && rawMonthly >= 0
          ? rawMonthly
          : NaN;

    if (Number.isNaN(dailyLimit) || Number.isNaN(monthlyLimit)) {
      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Лимиты должны быть целыми неотрицательными числами или null.',
        },
      });
      return;
    }

    if (dailyLimit !== null && monthlyLimit !== null && monthlyLimit < dailyLimit) {
      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Месячный лимит не может быть меньше дневного лимита.',
        },
      });
      return;
    }

    const createdUser: PreviewUserRecord = {
      id: nextPreviewUserId++,
      email: rawEmail,
      name: rawName,
      role: rawRole,
      is_active: true,
      passwordHash: hashPreviewPassword(rawPassword),
      created_at: new Date().toISOString(),
      personalInstructions: '',
      quotas: {
        daily: { used: 0, limit: dailyLimit },
        monthly: { used: 0, limit: monthlyLimit },
      },
    };
    previewUsers.set(createdUser.email, createdUser);

    recordPreviewUsageEvent(actor, 'admin_user_created', {
      target_user_id: createdUser.id,
      role: createdUser.role,
    });

    res.status(201).json(toPublicPreviewUser(createdUser));
  });

  app.get('/api/v1/admin/users', (req: Request, res: Response) => {
    const actor = requirePreviewAdmin(req, res);
    if (!actor) return;
    const users = Array.from(previewUsers.values())
      .sort((a, b) => a.id - b.id)
      .map(toPublicPreviewUser);
    res.status(200).json({ users });
  });

  app.get('/api/v1/admin/users/:id', (req: Request, res: Response) => {
    const actor = requirePreviewAdmin(req, res);
    if (!actor) return;

    const targetId = Number(req.params.id);
    if (!Number.isInteger(targetId) || targetId <= 0) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Некорректный ID пользователя.' } });
      return;
    }

    const targetUser = Array.from(previewUsers.values()).find((u) => u.id === targetId);
    if (!targetUser) {
      res.status(404).json({ error: { message: 'Пользователь не найден.' } });
      return;
    }

    res.status(200).json(toPublicPreviewUser(targetUser));
  });

  app.patch('/api/v1/admin/users/:id', (req: Request, res: Response) => {
    const actor = requirePreviewAdmin(req, res);
    if (!actor) return;

    const targetId = Number(req.params.id);
    if (!Number.isInteger(targetId) || targetId <= 0) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Некорректный ID пользователя.' } });
      return;
    }

    const targetUser = Array.from(previewUsers.values()).find((u) => u.id === targetId);
    if (!targetUser) {
      res.status(404).json({ error: { message: 'Пользователь не найден.' } });
      return;
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const { role, is_active } = body;

    if (role !== undefined && role !== 'admin' && role !== 'employee') {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Допустимые роли: employee или admin.' } });
      return;
    }

    if (is_active !== undefined && typeof is_active !== 'boolean') {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Поле is_active должно быть логического типа.' } });
      return;
    }

    if (actor.id === targetUser.id && (is_active === false || (role !== undefined && role !== 'admin'))) {
      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Нельзя заблокировать или понизить собственную учётную запись администратора.',
        },
      });
      return;
    }

    if (role !== undefined) {
      targetUser.role = role;
    }
    if (is_active !== undefined) {
      targetUser.is_active = is_active;
      if (!is_active) {
        revokePreviewSessionsForEmail(targetUser.email);
      }
      recordPreviewUsageEvent(
        actor,
        is_active ? 'admin_user_unblocked' : 'admin_user_blocked',
        { target_user_id: targetUser.id }
      );
    }

    previewUsers.set(targetUser.email, targetUser);
    res.status(200).json(toPublicPreviewUser(targetUser));
  });

  app.delete('/api/v1/admin/users/:id', (req: Request, res: Response) => {
    const actor = requirePreviewAdmin(req, res);
    if (!actor) return;

    const targetId = Number(req.params.id);
    if (!Number.isInteger(targetId) || targetId <= 0) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Некорректный ID пользователя.' } });
      return;
    }

    if (actor.id === targetId) {
      res.status(400).json({ error: { message: 'Нельзя деактивировать собственную учётную запись.' } });
      return;
    }

    const targetUser = Array.from(previewUsers.values()).find((u) => u.id === targetId);
    if (!targetUser) {
      res.status(404).json({ error: { message: 'Пользователь не найден.' } });
      return;
    }

    targetUser.is_active = false;
    previewUsers.set(targetUser.email, targetUser);
    revokePreviewSessionsForEmail(targetUser.email);
    recordPreviewUsageEvent(actor, 'admin_user_blocked', { target_user_id: targetUser.id });
    res.status(204).end();
  });

  app.get('/api/v1/admin/usage', (req: Request, res: Response) => {
    const actor = requirePreviewAdmin(req, res);
    if (!actor) return;

    const rawDays = parseInt(String(req.query.days ?? ''), 10);
    const days = Number.isFinite(rawDays) && rawDays > 0 ? Math.min(365, rawDays) : 30;
    const cutoffMs = Date.now() - days * 86_400_000;

    const filteredEvents = previewUsageEvents.filter(
      (ev) => new Date(ev.created_at).getTime() >= cutoffMs
    );

    const summaryMap = new Map<string, number>();
    const dailyMap = new Map<string, number>();
    for (const ev of filteredEvents) {
      summaryMap.set(ev.event_type, (summaryMap.get(ev.event_type) ?? 0) + 1);
      const dayKey = `${ev.created_at.slice(0, 10)}|${ev.event_type}`;
      dailyMap.set(dayKey, (dailyMap.get(dayKey) ?? 0) + 1);
    }

    const summary = Array.from(summaryMap.entries()).map(([event_type, count]) => ({
      event_type,
      count,
    }));
    const daily = Array.from(dailyMap.entries()).map(([key, count]) => {
      const [date, event_type] = key.split('|');
      return { date, event_type, count };
    });

    res.status(200).json({
      summary,
      daily,
      events: filteredEvents.slice(0, 50),
    });
  });

  app.put('/api/v1/admin/users/:id/quotas', (req: Request, res: Response) => {
    const actor = requirePreviewAdmin(req, res);
    if (!actor) return;

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

  app.get('/api/v1/admin/freellm/health', async (req: Request, res: Response) => {
    const actor = requirePreviewAdmin(req, res);
    if (!actor) return;

    res.setHeader('Cache-Control', 'no-store');
    const cfg = loadRuntimeConfig();
    const health = await checkFreeLlmHealth(cfg);
    res.status(200).json(health);
  });

  app.post('/api/v1/admin/freellm/test-generation', async (req: Request, res: Response) => {
    const actor = requirePreviewAdmin(req, res);
    if (!actor) return;

    res.setHeader('Cache-Control', 'no-store');
    const cfg = loadRuntimeConfig();
    const result = await testFreeLlmGeneration(cfg);
    res.status(200).json(result);
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
    const rawStatus = typeof req.query.status === 'string' ? req.query.status : 'active';
    const list = Array.from(previewConversations.values())
      .filter((c) => {
        if (c.user_id !== userRecord.id) return false;
        if (rawStatus === 'all') return true;
        if (rawStatus === 'deleted') return Boolean(c.deleted_at);
        if (rawStatus === 'archived') return !c.deleted_at && Boolean(c.archived_at);
        return !c.deleted_at && !c.archived_at;
      })
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
      archived_at: null,
      deleted_at: null,
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
    if (!conv || (userRecord.role !== 'admin' && conv.user_id !== userRecord.id)) {
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
    if (!conv || (userRecord.role !== 'admin' && conv.user_id !== userRecord.id)) {
      res.status(404).json({ error: { message: 'Диалог не найден.' } });
      return;
    }
    const { title, archived, deleted } = req.body ?? {};
    if (title === undefined && archived === undefined && deleted === undefined) {
      res.status(400).json({ error: { message: 'Не переданы поля для обновления.' } });
      return;
    }
    if (archived === true && conv.deleted_at && deleted !== false) {
      res.status(409).json({
        error: { message: 'Нельзя архивировать удалённый диалог. Сначала восстановите его.' },
      });
      return;
    }
    if (typeof title === 'string' && title.trim()) {
      conv.title = title.trim();
    }
    if (typeof archived === 'boolean') {
      conv.archived_at = archived ? conv.archived_at || new Date().toISOString() : null;
    }
    if (typeof deleted === 'boolean') {
      conv.deleted_at = deleted ? conv.deleted_at || new Date().toISOString() : null;
    }
    res.status(200).json(conv);
  });

  app.post('/api/v1/conversations/:id/restore', (req: Request, res: Response) => {
    const userRecord = getPreviewSessionUser(req);
    if (!userRecord) {
      res.status(401).json({ error: { message: 'Сессия не авторизована.' } });
      return;
    }
    const convId = Number(req.params.id);
    const conv = previewConversations.get(convId);
    if (!conv || (userRecord.role !== 'admin' && conv.user_id !== userRecord.id)) {
      res.status(404).json({ error: { message: 'Диалог не найден.' } });
      return;
    }
    if (req.body?.fromArchive) {
      conv.archived_at = null;
    } else {
      conv.deleted_at = null;
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
    if (!conv || (userRecord.role !== 'admin' && conv.user_id !== userRecord.id)) {
      res.status(404).json({ error: { message: 'Диалог не найден.' } });
      return;
    }
    const isPermanent = req.query.permanent === 'true' || req.query.permanent === '1';
    if (isPermanent) {
      previewConversations.delete(convId);
      res.status(204).end();
      return;
    }
    conv.deleted_at = conv.deleted_at || new Date().toISOString();
    res.status(200).json(conv);
  });

  app.get('/api/v1/messages', (req: Request, res: Response) => {
    const userRecord = getPreviewSessionUser(req);
    if (!userRecord) {
      res.status(401).json({ error: { message: 'Сессия не авторизована.' } });
      return;
    }
    const convId = Number(req.query.conversation_id);
    if (!Number.isInteger(convId) || convId <= 0) {
      res.status(400).json({ error: { message: 'Укажите корректный conversation_id.' } });
      return;
    }
    const conv = previewConversations.get(convId);
    if (!conv || (userRecord.role !== 'admin' && conv.user_id !== userRecord.id)) {
      res.status(404).json({ error: { message: 'Диалог не найден.' } });
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

    const existingConv = previewConversations.get(convId);
    if (existingConv && existingConv.user_id !== userRecord.id) {
      res.status(404).json({ error: { message: 'Диалог не найден.' } });
      return;
    }
    if (existingConv && existingConv.deleted_at) {
      res.status(409).json({
        error: { message: 'Нельзя отправлять сообщения в удалённый диалог. Сначала восстановите его.' },
      });
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

    let conv = existingConv;
    const now = new Date().toISOString();
    if (!conv) {
      conv = {
        id: Number.isFinite(convId) && convId > 0 ? convId : nextPreviewConvId++,
        user_id: userRecord.id,
        title: text.slice(0, 60),
        created_at: now,
        last_message_at: now,
        archived_at: null,
        deleted_at: null,
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

    if (role === 'user') {
      recordPreviewUsageEvent(userRecord, 'message_sent', {
        conversation_id: conv.id,
        text_length: text.length,
      });
    }

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

    // Require authenticated active session BEFORE calling FreeLLMAPI (matches backend/src/routes/chat.ts)
    const sessionUser = getPreviewSessionUser(req);
    if (!sessionUser) {
      res.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Сессия не авторизована или учётная запись заблокирована.',
        },
      });
      return;
    }

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

    const toolEnrichment = await resolveAndEnrichMessagesWithExternalTools(validMessages);

    if (
      toolEnrichment.allRequestedToolsFailed &&
      toolEnrichment.deterministicErrorReply
    ) {
      releasePreviewReservation();
      const fallbackText = toolEnrichment.deterministicErrorReply;
      if (stream) {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders();
        res.write(
          `data: ${JSON.stringify({
            id: completionId,
            object: 'chat.completion.chunk',
            created,
            choices: [
              {
                index: 0,
                delta: { content: fallbackText },
                finish_reason: null,
              },
            ],
          })}\n\n`
        );
        res.write(
          `data: ${JSON.stringify({
            id: completionId,
            object: 'chat.completion.chunk',
            created,
            choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
          })}\n\n`
        );
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
              content: fallbackText,
            },
            finish_reason: 'stop',
          },
        ],
        quotas: sessionUser?.quotas,
      });
      return;
    }

    const corporateInstruction = getCorporateInstruction();
    const trustedMessages = buildTrustedMessages(
      corporateInstruction,
      toolEnrichment.messages
    );
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
        const streamSentAtMs = Date.now();
        let firstTokenAtMs: number | null = null;
        let chunkCount = 0;
        let emittedChars = 0;
        let accumulatedOutput = '';
        let restrictedTriggered = false;

        for await (const token of streamChatWithFreeLlm(
          trustedMessages,
          abortController.signal,
          runtimeConfig
        )) {
          if (res.writableEnded || abortController.signal.aborted) {
            throw new Error('Request aborted');
          }
          if (!token) continue;

          accumulatedOutput += token;
          if (isSecurityRestrictedOutput(accumulatedOutput)) {
            restrictedTriggered = true;
            abortController.abort();
            const refusalText =
              emittedChars === 0
                ? SECURITY_REFUSAL_MESSAGE
                : `\n\n${SECURITY_REFUSAL_MESSAGE}`;
            firstTokenAtMs ??= Date.now();
            chunkCount += 1;
            emittedChars += refusalText.length;
            res.write(
              `data: ${JSON.stringify({
                id: completionId,
                object: 'chat.completion.chunk',
                created,
                choices: [
                  {
                    index: 0,
                    delta: { content: refusalText },
                    finish_reason: null,
                  },
                ],
              })}\n\n`
            );
            (res as unknown as { flush?: () => void }).flush?.();
            break;
          }

          if (firstTokenAtMs === null) {
            firstTokenAtMs = Date.now();
          }
          chunkCount += 1;
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
          (res as unknown as { flush?: () => void }).flush?.();
        }

        if (!restrictedTriggered && abortController.signal.aborted) {
          throw new Error('Request aborted');
        }

        if (emittedChars === 0) {
          throw new Error('Empty stream response');
        }

        const totalMs = Date.now() - streamSentAtMs;
        const ttftMs =
          firstTokenAtMs !== null ? firstTokenAtMs - streamSentAtMs : totalMs;
        if (process.env.NODE_ENV !== 'production') {
          console.info('[preview/chat/stream] metrics', {
            ttftMs,
            totalMs,
            chunkCount,
            replyLength: emittedChars,
          });
        }

        commitPreviewReservation();
        recordPreviewUsageEvent(sessionUser, 'model_call', {
          mode: 'stream',
          ttft_ms: ttftMs,
          total_ms: totalMs,
          chunk_count: chunkCount,
          reply_length: emittedChars,
        });

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
          (res as unknown as { flush?: () => void }).flush?.();
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
          (res as unknown as { flush?: () => void }).flush?.();
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
      recordPreviewUsageEvent(sessionUser, 'model_call', {
        mode: 'unary',
        reply_length: reply.length,
      });
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

  // --- External Tools & Attachment Extraction API (/api/v1/tools/*) ---
  app.get('/api/v1/tools/weather', async (req: Request, res: Response) => {
    const rawCity =
      typeof req.query.city === 'string' && req.query.city.trim()
        ? req.query.city.trim()
        : 'Алматы';
    const result = await fetchWeatherData(rawCity);
    res.status(result.available ? 200 : 503).json(result);
  });

  app.get('/api/v1/tools/rates', async (req: Request, res: Response) => {
    const baseCurrency =
      typeof req.query.base === 'string' && req.query.base.trim()
        ? req.query.base.trim().toUpperCase()
        : 'USD';
    const targetCurrencies =
      typeof req.query.symbols === 'string' && req.query.symbols.trim()
        ? req.query.symbols
            .split(',')
            .map((s) => s.trim().toUpperCase())
            .filter(Boolean)
        : ['KZT', 'EUR', 'RUB', 'CNY', 'GBP'];
    const rawAmount = Number(req.query.amount ?? 1);
    const amount = Number.isFinite(rawAmount) && rawAmount > 0 ? rawAmount : 1;

    const result = await fetchExchangeRatesData({
      baseCurrency,
      targetCurrencies,
      amount,
    });
    res.status(result.available ? 200 : 503).json(result);
  });

  app.post('/api/v1/tools/attachments/extract', (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const mimeType =
      typeof body.mimeType === 'string'
        ? body.mimeType.trim()
        : 'application/octet-stream';
    const contentBase64 =
      typeof body.contentBase64 === 'string' ? body.contentBase64.trim() : '';

    if (!name) {
      res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'Не указано имя файла вложения.' },
      });
      return;
    }

    let bytes: Uint8Array;
    try {
      bytes = Buffer.from(contentBase64, 'base64');
    } catch {
      res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'Некорректное кодирование файла (Base64).' },
      });
      return;
    }

    if (bytes.byteLength > MAX_ATTACHMENT_FILE_BYTES) {
      res.status(413).json({
        error: {
          code: 'PAYLOAD_TOO_LARGE',
          message: 'Размер файла превышает допустимый лимит 10 МБ.',
        },
      });
      return;
    }

    const extracted = extractAndValidateAttachmentNode({
      name,
      mimeType,
      bytes,
    });
    res.status(200).json(extracted);
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
