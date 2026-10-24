import env from "../config/index.js";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
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

export async function chatWithFreeLlm(
  messages: ChatMessage[]
): Promise<string> {
  if (!env.FREELLM_API_KEY) {
    throw new Error("FreeLLMAPI is not configured");
  }

  const response = await fetch(
    `${env.FREELLM_API_BASE_URL.replace(/\/+$/, "")}/chat/completions`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.FREELLM_API_KEY}`,
      },
      body: JSON.stringify({
        model: env.FREELLM_MODEL,
        messages,
        stream: false,
      }),
      signal: AbortSignal.timeout(120_000),
    }
  );

  const data = (await response.json().catch(() => null)) as
    | FreeLlmResponse
    | null;

  if (!response.ok) {
    console.error("FreeLLMAPI request failed:", response.status);

    throw new Error(
      response.status === 401 || response.status === 403
        ? "FreeLLMAPI authentication failed"
        : `FreeLLMAPI returned HTTP ${response.status}`
    );
  }

  const content = data?.choices?.[0]?.message?.content;

  if (typeof content !== "string" || !content.trim()) {
    throw new Error("FreeLLMAPI returned an empty response");
  }

  return content;
}

export async function* streamChatWithFreeLlm(
  messages: ChatMessage[],
  signal?: AbortSignal
): AsyncGenerator<string> {
  if (!env.FREELLM_API_KEY) {
    throw new Error("FreeLLMAPI is not configured");
  }

  const response = await fetch(
    `${env.FREELLM_API_BASE_URL.replace(/\/+$/, "")}/chat/completions`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.FREELLM_API_KEY}`,
      },
      body: JSON.stringify({
        model: env.FREELLM_MODEL,
        messages,
        stream: true,
      }),
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(120_000)])
        : AbortSignal.timeout(120_000),
    }
  );

  if (!response.ok) {
    console.error("FreeLLMAPI streaming request failed:", response.status);

    throw new Error(
      response.status === 401 || response.status === 403
        ? "FreeLLMAPI authentication failed"
        : `FreeLLMAPI returned HTTP ${response.status}`
    );
  }

  if (!response.body) {
    throw new Error("FreeLLMAPI returned an empty stream");
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
