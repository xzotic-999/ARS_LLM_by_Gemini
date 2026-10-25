export interface QuotaLimits {
  daily: { used: number; limit: number | null };
  monthly: { used: number; limit: number | null };
}

export interface UserProfile {
  id: number;
  email: string;
  name?: string;
  role: 'user' | 'admin';
  quotas?: QuotaLimits;
}

export interface ConversationRecord {
  id: number;
  title: string | null;
  created_at: string;
  last_message_at: string | null;
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
  role: 'user' | 'admin';
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

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export type ParsedSseEvent =
  | { type: 'delta'; content: string }
  | { type: 'done' }
  | { type: 'error'; message: string };

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
        const msg =
          typeof parsed?.error?.message === 'string'
            ? parsed.error.message
            : 'Ошибка генерации ответа.';
        events.push({ type: 'error', message: msg });
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

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  };

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
      'Сервер ARS_LLM недоступен. Запустите локальный backend через Docker Compose или войдите в эталонный демо-режим.'
    );
  }

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    const message =
      data?.error?.message ||
      data?.message ||
      (res.status === 401
        ? 'Сессия истекла или требуется авторизация.'
        : res.status === 429
          ? 'Превышен лимит запросов. Обратитесь к администратору.'
          : `Ошибка запроса (HTTP ${res.status})`);
    throw new ApiError(res.status, message);
  }

  return data as T;
}

export const authApi = {
  login: (email: string, password: string) =>
    request<{ user: UserProfile }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: email.trim(), password }),
    }),

  logout: () =>
    request<{ ok: boolean }>('/auth/logout', {
      method: 'POST',
    }),

  me: () => request<{ user: UserProfile }>('/auth/me'),

  quotas: () => request<{ quotas: QuotaLimits }>('/auth/quotas'),
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
        const res = await fetch(`${API_BASE}/chat/completions`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
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
          const message =
            data?.error?.message ||
            (res.status === 429
              ? 'Превышен лимит запросов. Обратитесь к администратору.'
              : res.status === 401
                ? 'Сессия истекла. Пожалуйста, войдите снова.'
                : `Ошибка генерации ответа (HTTP ${res.status})`);
          throw new ApiError(res.status, message);
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
        let streamErrorMsg: string | null = null;

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
              streamErrorMsg = ev.message;
              break;
            } else if (ev.type === 'done') {
              finished = true;
              if (receivedAnyToken || signal?.aborted) {
                onDone();
                return;
              }
              streamErrorMsg =
                'Сервер завершил поток без текста ответа. Проверьте подключение к FreeLLMAPI.';
              break;
            }
          }
        }

        if (streamErrorMsg) {
          throw new Error(streamErrorMsg);
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
