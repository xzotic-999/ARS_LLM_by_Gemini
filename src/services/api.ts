export interface QuotaLimits {
  daily: { used: number; limit: number | null };
  monthly: { used: number; limit: number | null };
}

export type UserRole = 'user' | 'employee' | 'admin';

export interface UserProfile {
  id: number;
  email: string;
  name?: string;
  role: UserRole;
  quotas?: QuotaLimits;
}

export interface ConversationRecord {
  id: number;
  title: string | null;
  created_at: string;
  last_message_at: string | null;
  messages?: MessageRecord[];
}

export interface MessageRecord {
  id: number;
  conversation_id: number;
  role: 'user' | 'assistant' | 'system';
  text: string;
  created_at: string;
}

export interface AdminUserRecord {
  id: number;
  email: string;
  name?: string;
  role: UserRole;
  created_at: string;
  quotas: QuotaLimits;
}

export interface AdminUsageResponse {
  summary: Array<{ event_type: string; count: number }>;
  daily: Array<{ date: string; event_type: string; count: number }>;
  events: Array<{
    id: number;
    user_id: number;
    user_email: string;
    event_type: string;
    metadata: Record<string, unknown> | null;
    created_at: string;
  }>;
}

export interface ApiErrorDetails {
  code?: string;
  reason?: 'daily_limit_exceeded' | 'monthly_limit_exceeded' | string;
  period?: 'daily' | 'monthly';
  contactAdmin?: boolean;
  quotas?: QuotaLimits;
}

export class ApiError extends Error {
  status: number;
  code?: string;
  reason?: string;
  period?: 'daily' | 'monthly';
  contactAdmin?: boolean;
  quotas?: QuotaLimits;

  constructor(status: number, message: string, details?: ApiErrorDetails) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = details?.code;
    this.reason = details?.reason;
    this.period = details?.period;
    this.contactAdmin = details?.contactAdmin;
    this.quotas = details?.quotas;
  }
}

export type ParsedSseEvent =
  | { type: 'delta'; content: string }
  | { type: 'done' }
  | {
      type: 'error';
      message: string;
      code?: string;
      reason?: string;
      period?: 'daily' | 'monthly';
      contactAdmin?: boolean;
      quotas?: QuotaLimits;
    };

/**
 * Validates corporate email addresses including .local intranet addresses (e.g. admin@ars_llm.local).
 */
export function isValidCorporateEmail(email: string): boolean {
  const trimmed = email.trim();
  if (!trimmed || trimmed.length > 255) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

/**
 * Pure parser for Server-Sent Events (SSE) chunks from POST /api/v1/chat/completions.
 * Handles multi-line `event: error` + `data: {...}`, OpenAI-compatible `delta.content`, and `data: [DONE]`.
 */
export function parseSseLines(rawBuffer: string): {
  events: ParsedSseEvent[];
  remainingBuffer: string;
} {
  const normalized = rawBuffer.replace(/\r\n/g, '\n');
  const lastNewlineIdx = normalized.lastIndexOf('\n');
  if (lastNewlineIdx === -1) {
    return { events: [], remainingBuffer: rawBuffer };
  }

  const completePart = normalized.slice(0, lastNewlineIdx);
  const remainingBuffer = normalized.slice(lastNewlineIdx + 1);
  const lines = completePart.split('\n');

  const events: ParsedSseEvent[] = [];
  let pendingErrorEvent = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      pendingErrorEvent = false;
      continue;
    }

    if (line.startsWith('event:')) {
      const eventName = line.slice(6).trim();
      pendingErrorEvent = eventName === 'error';
      continue;
    }

    if (!line.startsWith('data:')) {
      continue;
    }

    const payload = line.slice(5).trim();
    if (payload === '[DONE]') {
      events.push({ type: 'done' });
      pendingErrorEvent = false;
      continue;
    }

    try {
      const parsed = JSON.parse(payload);
      if (pendingErrorEvent || parsed?.error) {
        const errObj = parsed?.error ?? {};
        const msg =
          typeof errObj?.message === 'string'
            ? errObj.message
            : 'Ошибка генерации ответа.';
        const extractedQuotas =
          extractQuotaLimits(errObj?.quotas) ?? extractQuotaLimits(parsed?.quotas) ?? undefined;
        const errEvent: ParsedSseEvent = {
          type: 'error',
          message: msg,
        };
        if (typeof errObj?.code === 'string') {
          errEvent.code = errObj.code;
        }
        if (typeof errObj?.reason === 'string') {
          errEvent.reason = errObj.reason;
        }
        if (errObj?.period === 'daily' || errObj?.period === 'monthly') {
          errEvent.period = errObj.period;
        }
        if (typeof errObj?.contact_admin === 'boolean') {
          errEvent.contactAdmin = errObj.contact_admin;
        }
        if (extractedQuotas) {
          errEvent.quotas = extractedQuotas;
        }
        events.push(errEvent);
        pendingErrorEvent = false;
        continue;
      }

      const token = parsed?.choices?.[0]?.delta?.content;
      if (typeof token === 'string' && token.length > 0) {
        events.push({ type: 'delta', content: token });
      }
    } catch {
      // Ignore malformed partial JSON lines
    }
  }

  return { events, remainingBuffer };
}

const API_BASE = '/api/v1';
const SESSION_TOKEN_KEY = 'ars_llm_session_token_v1';

function readStoredSessionToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(SESSION_TOKEN_KEY);
  } catch {
    return null;
  }
}

function writeStoredSessionToken(token: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (token) {
      window.localStorage.setItem(SESSION_TOKEN_KEY, token);
    } else {
      window.localStorage.removeItem(SESSION_TOKEN_KEY);
    }
  } catch {
    // Ignore storage errors in restricted environments
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  };

  const sessionToken = readStoredSessionToken();
  if (sessionToken && !headers['Authorization']) {
    headers['Authorization'] = `Bearer ${sessionToken}`;
  }

  if (options.body && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: 'include',
    headers,
  });

  if (res.status === 204) {
    return undefined as T;
  }

  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('text/html')) {
    throw new ApiError(
      503,
      'Сервер ARS_LLM временно недоступен. Повторите попытку входа через несколько секунд.'
    );
  }

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    const errObj = data?.error ?? {};
    const message =
      errObj?.message ||
      data?.message ||
      (res.status === 401
        ? 'Сессия истекла или требуется авторизация.'
        : res.status === 429
          ? 'Превышен лимит запросов. Обратитесь к администратору.'
          : `Ошибка запроса (HTTP ${res.status})`);
    const extractedQuotas =
      extractQuotaLimits(errObj?.quotas) ?? extractQuotaLimits(data?.quotas) ?? undefined;
    throw new ApiError(res.status, message, {
      code: typeof errObj?.code === 'string' ? errObj.code : undefined,
      reason: typeof errObj?.reason === 'string' ? errObj.reason : undefined,
      period:
        errObj?.period === 'daily' || errObj?.period === 'monthly'
          ? errObj.period
          : undefined,
      contactAdmin: Boolean(errObj?.contact_admin || res.status === 429),
      quotas: extractedQuotas,
    });
  }

  return data as T;
}

export function extractQuotaLimits(payload: unknown): QuotaLimits | null {
  if (!payload || typeof payload !== 'object') return null;
  const obj = payload as Record<string, unknown>;
  const candidate = (obj.quotas && typeof obj.quotas === 'object' ? obj.quotas : obj) as Record<
    string,
    unknown
  >;
  if (
    candidate.daily &&
    typeof candidate.daily === 'object' &&
    candidate.monthly &&
    typeof candidate.monthly === 'object'
  ) {
    const daily = candidate.daily as { used?: unknown; limit?: unknown };
    const monthly = candidate.monthly as { used?: unknown; limit?: unknown };
    return {
      daily: {
        used: typeof daily.used === 'number' ? daily.used : 0,
        limit: typeof daily.limit === 'number' ? daily.limit : null,
      },
      monthly: {
        used: typeof monthly.used === 'number' ? monthly.used : 0,
        limit: typeof monthly.limit === 'number' ? monthly.limit : null,
      },
    };
  }
  return null;
}

export const authApi = {
  login: async (email: string, password: string) => {
    const raw = await request<{
      user: UserProfile;
      quotas?: QuotaLimits;
      sessionToken?: string;
    }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: email.trim(), password }),
    });
    if (typeof raw.sessionToken === 'string' && raw.sessionToken) {
      writeStoredSessionToken(raw.sessionToken);
    }
    const quotas = extractQuotaLimits(raw) ?? raw.user?.quotas ?? undefined;
    return {
      user: quotas ? { ...raw.user, quotas } : raw.user,
      quotas,
    };
  },

  logout: async () => {
    try {
      return await request<{ ok: boolean }>('/auth/logout', {
        method: 'POST',
      });
    } finally {
      writeStoredSessionToken(null);
    }
  },

  me: async () => {
    const raw = await request<{ user: UserProfile; quotas?: QuotaLimits }>('/auth/me');
    const quotas = extractQuotaLimits(raw) ?? raw.user?.quotas ?? undefined;
    return {
      user: quotas ? { ...raw.user, quotas } : raw.user,
      quotas,
    };
  },

  quotas: async (): Promise<{ quotas: QuotaLimits }> => {
    const raw = await request<unknown>('/auth/quotas');
    const quotas = extractQuotaLimits(raw);
    if (!quotas) {
      throw new Error('Invalid quota response format');
    }
    return { quotas };
  },

  updateProfile: async (payload: {
    name: string;
    personalInstructions?: string;
  }): Promise<{ user: UserProfile; personalInstructions?: string }> => {
    return request<{ user: UserProfile; personalInstructions?: string }>('/auth/profile', {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },
};

export const conversationsApi = {
  list: () => request<ConversationRecord[]>('/conversations'),

  get: (id: number) =>
    request<ConversationRecord & { messages: MessageRecord[] }>(`/conversations/${id}`),

  create: (title?: string) =>
    request<ConversationRecord>('/conversations', {
      method: 'POST',
      body: JSON.stringify({ title }),
    }),

  rename: (id: number, title: string) =>
    request<ConversationRecord>(`/conversations/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ title }),
    }),

  delete: (id: number) =>
    request<void>(`/conversations/${id}`, {
      method: 'DELETE',
    }),
};

export const messagesApi = {
  list: (conversationId: number) =>
    request<MessageRecord[]>(`/messages?conversation_id=${encodeURIComponent(conversationId)}`),

  send: (
    conversationId: number,
    text: string,
    role: 'user' | 'assistant' | 'system' = 'user',
    deferQuotaToCompletion = false
  ) =>
    request<MessageRecord>('/messages', {
      method: 'POST',
      body: JSON.stringify({
        conversation_id: conversationId,
        text,
        role,
        defer_quota_to_completion: deferQuotaToCompletion,
      }),
    }),
};

export const chatApi = {
  completions: (messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>) =>
    request<{
      id: string;
      choices: Array<{ index: number; message: { role: string; content: string } }>;
    }>('/chat/completions', {
      method: 'POST',
      body: JSON.stringify({ messages, stream: false }),
    }),

  streamCompletions: async (
    messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>,
    onToken: (token: string) => void,
    onDone: () => void,
    onError: (err: Error) => void,
    signal?: AbortSignal
  ): Promise<void> => {
    const maxClientAttempts = 2;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxClientAttempts; attempt++) {
      let receivedAnyToken = false;

      try {
        // On second client attempt, allow non-streaming fallback if first stream attempt failed
        const useStream = attempt === 0;
        const streamHeaders: Record<string, string> = {
          'Content-Type': 'application/json',
        };
        const sessionToken = readStoredSessionToken();
        if (sessionToken) {
          streamHeaders['Authorization'] = `Bearer ${sessionToken}`;
        }

        const res = await fetch(`${API_BASE}/chat/completions`, {
          method: 'POST',
          credentials: 'include',
          headers: streamHeaders,
          body: JSON.stringify({ messages, stream: useStream }),
          signal,
        });

        const contentType = res.headers.get('content-type') || '';
        if (contentType.includes('text/html')) {
          throw new ApiError(
            503,
            'Серверный шлюз чата (/api/v1/chat/completions) вернул HTML вместо потока данных. Опубликуйте актуальную версию приложения (Publish) или проверьте работу VS Code Dev Tunnel.'
          );
        }

        if (!res.ok) {
          const data = await res.json().catch(() => null);
          const errObj = data?.error ?? {};
          const message =
            errObj?.message ||
            (res.status === 429
              ? 'Превышен лимит запросов. Обратитесь к администратору.'
              : res.status === 401
                ? 'Сессия истекла. Пожалуйста, войдите снова.'
                : `Ошибка генерации ответа (HTTP ${res.status})`);
          const extractedQuotas =
            extractQuotaLimits(errObj?.quotas) ?? extractQuotaLimits(data?.quotas) ?? undefined;
          throw new ApiError(res.status, message, {
            code: typeof errObj?.code === 'string' ? errObj.code : undefined,
            reason: typeof errObj?.reason === 'string' ? errObj.reason : undefined,
            period:
              errObj?.period === 'daily' || errObj?.period === 'monthly'
                ? errObj.period
                : undefined,
            contactAdmin: Boolean(errObj?.contact_admin || res.status === 429),
            quotas: extractedQuotas,
          });
        }

        if (contentType.includes('application/json')) {
          const data = await res.json().catch(() => null);
          const fullText = data?.choices?.[0]?.message?.content;
          if (typeof fullText === 'string' && fullText.trim().length > 0) {
            receivedAnyToken = true;
            onToken(fullText);
            onDone();
            return;
          }
          throw new Error(data?.error?.message || 'Сервер вернул пустой ответ.');
        }

        const reader = res.body?.getReader();
        if (!reader) {
          throw new Error('Поток ответа недоступен');
        }

        const decoder = new TextDecoder();
        let buffer = '';
        let finished = false;
        let streamErrorObj: Error | null = null;

        while (!finished) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const { events, remainingBuffer } = parseSseLines(buffer);
          buffer = remainingBuffer;

          for (const ev of events) {
            if (ev.type === 'delta') {
              receivedAnyToken = true;
              onToken(ev.content);
            } else if (ev.type === 'error') {
              finished = true;
              streamErrorObj =
                ev.code === 'QUOTA_EXCEEDED'
                  ? new ApiError(429, ev.message, {
                      code: ev.code,
                      reason: ev.reason,
                      period: ev.period,
                      contactAdmin: ev.contactAdmin ?? true,
                      quotas: ev.quotas,
                    })
                  : new Error(ev.message);
              break;
            } else if (ev.type === 'done') {
              finished = true;
              if (receivedAnyToken || signal?.aborted) {
                onDone();
                return;
              }
              streamErrorObj = new Error(
                'Сервер завершил поток без текста ответа. Проверьте подключение к FreeLLMAPI.'
              );
              break;
            }
          }
        }

        if (streamErrorObj) {
          throw streamErrorObj;
        }

        if (!receivedAnyToken && !signal?.aborted) {
          throw new Error(
            'Не получен ответ от модели. Убедитесь, что FreeLLMAPI и VS Code Dev Tunnel активны.'
          );
        }

        onDone();
        return;
      } catch (err) {
        if (signal?.aborted) {
          onDone();
          return;
        }
        lastError = err instanceof Error ? err : new Error(String(err));
        // If we already emitted partial tokens or if it's an auth/429 error, don't retry
        if (
          receivedAnyToken ||
          (err instanceof ApiError && (err.status === 401 || err.status === 429))
        ) {
          onError(lastError);
          return;
        }
      }
    }

    onError(
      lastError ??
        new Error('Сервер генерации временно недоступен. Нажмите «Повторить запрос».')
    );
  },
};

export const adminApi = {
  listUsers: () => request<{ users: AdminUserRecord[] }>('/admin/users'),

  getUserQuotas: (userId: number) =>
    request<{ user: { id: number; email: string; role: string }; quotas: QuotaLimits }>(
      `/admin/users/${userId}/quotas`
    ),

  setUserQuotas: (
    userId: number,
    dailyLimit: number | null,
    monthlyLimit: number | null
  ) =>
    request<{ user_id: number; quotas: QuotaLimits }>(`/admin/users/${userId}/quotas`, {
      method: 'PUT',
      body: JSON.stringify({
        daily_limit: dailyLimit,
        monthly_limit: monthlyLimit,
      }),
    }),

  getUsage: (params?: { userId?: number; eventType?: string; days?: number }) => {
    const query = new URLSearchParams();
    if (params?.userId) query.set('user_id', String(params.userId));
    if (params?.eventType) query.set('event_type', params.eventType);
    if (params?.days) query.set('days', String(params.days));
    const qs = query.toString();
    return request<AdminUsageResponse>(`/admin/usage${qs ? `?${qs}` : ''}`);
  },
};
