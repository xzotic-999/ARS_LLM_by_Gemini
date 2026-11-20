import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import {
  acquireQuotaReservation,
  getUserQuotaStatus,
} from "../services/quota.js";
import env from "../config/index.js";
import type { ChatMessage } from "../types.js";
import {
  buildTrustedMessages,
  getCachedInstruction,
  evaluateMessagesSecurityGuardrail,
  isSecurityRestrictedOutput,
  SECURITY_REFUSAL_MESSAGE,
} from "../services/instruction.js";

const router = Router();

function flushSseResponse(res: unknown): void {
  const maybeFlush = (res as { flush?: () => void })?.flush;
  if (typeof maybeFlush === "function") {
    maybeFlush.call(res);
  }
}

router.use(requireAuth);

// POST /api/v1/chat/completions
router.post("/completions", async (req, res, next) => {
  try {
    // Never trust client-supplied user_id, role, or quota fields; use authenticated session user only
    const userId = req.user!.id;
    const body: unknown = req.body;

    if (
      typeof body !== "object" ||
      body === null ||
      !("messages" in body) ||
      !Array.isArray(body.messages)
    ) {
      res.status(400).json({
        error: { message: "Request body must contain a messages array." },
      });
      return;
    }

    const rawMessages: unknown[] = body.messages;

    if (rawMessages.length === 0 || rawMessages.length > 100) {
      res.status(400).json({
        error: { message: "Provide between 1 and 100 messages." },
      });
      return;
    }

    const messages: ChatMessage[] = [];

    for (const item of rawMessages) {
      if (
        typeof item !== "object" ||
        item === null ||
        !("role" in item) ||
        !("content" in item)
      ) {
        res.status(400).json({
          error: { message: "Each message must contain role and content." },
        });
        return;
      }

      const { role, content } = item;

      if (role !== "system" && role !== "user" && role !== "assistant") {
        res.status(400).json({
          error: { message: "Unsupported message role." },
        });
        return;
      }

      if (typeof content !== "string" || !content.trim()) {
        res.status(400).json({
          error: { message: "Message content must be a non-empty string." },
        });
        return;
      }

      if (content.length > 50_000) {
        res.status(400).json({
          error: { message: "A message cannot exceed 50000 characters." },
        });
        return;
      }

      messages.push({ role, content });
    }

    const lastMessage = messages[messages.length - 1];

    if (lastMessage.role !== "user") {
      res.status(400).json({
        error: { message: "The last message must be from the user." },
      });
      return;
    }

    const instruction = getCachedInstruction();
    if (!instruction) {
      res.status(503).json({
        error: { message: "Corporate instruction not loaded. Service unavailable." },
      });
      return;
    }

    // Atomically check and reserve quota BEFORE calling the model.
    const reservation = await acquireQuotaReservation(userId);
    if (!reservation.allowed) {
      if (
        req.headers.accept?.includes("text/event-stream") &&
        req.query.sse_errors === "1"
      ) {
        res.status(429);
        res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
        res.setHeader("Cache-Control", "no-cache, no-transform");
        res.setHeader("X-Accel-Buffering", "no");
        res.flushHeaders();
        res.write(
          `event: error\ndata: ${JSON.stringify({
            error: reservation.error,
            quotas: reservation.quotas,
          })}\n\n`
        );
        flushSseResponse(res);
        res.end();
        return;
      }

      res.status(429).json({
        error: reservation.error,
        quotas: reservation.quotas,
      });
      return;
    }

    const controller = new AbortController();
    const abortOnDisconnect = () => {
      if (!res.writableEnded) {
        controller.abort();
      }
    };
    req.on("aborted", abortOnDisconnect);
    res.on("close", abortOnDisconnect);

    try {
      // Enforce deterministic corporate security guardrail on incoming prompt
      const guardrailResult = evaluateMessagesSecurityGuardrail(messages);
      if (guardrailResult.blocked) {
        await reservation.commit({
          mode: "stream" in body && body.stream === true ? "stream" : "unary",
          guardrail_blocked: true,
          message_count: messages.length,
        });

        if ("stream" in body && body.stream === true) {
          res.status(200);
          res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
          res.setHeader("Cache-Control", "no-cache, no-transform");
          res.setHeader("Connection", "keep-alive");
          res.setHeader("X-Accel-Buffering", "no");
          res.flushHeaders();

          res.write(
            `data: ${JSON.stringify({
              id: `chatcmpl-${Date.now()}`,
              object: "chat.completion.chunk",
              choices: [
                {
                  index: 0,
                  delta: {
                    role: "assistant",
                    content: guardrailResult.refusalMessage,
                  },
                  finish_reason: null,
                },
              ],
            })}\n\n`
          );
          res.write(
            `data: ${JSON.stringify({
              object: "chat.completion.chunk",
              choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
            })}\n\n`
          );
          res.write("data: [DONE]\n\n");
          flushSseResponse(res);
          res.end();
          return;
        }

        res.status(200).json({
          id: `chatcmpl-${Date.now()}`,
          object: "chat.completion",
          model: env.FREELLM_MODEL,
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: guardrailResult.refusalMessage,
              },
              finish_reason: "stop",
            },
          ],
          quotas: reservation.quotas,
        });
        return;
      }

      const { resolveAndEnrichMessagesWithExternalTools } = await import(
        "../services/externalTools.js"
      );
      const toolEnrichment = await resolveAndEnrichMessagesWithExternalTools(messages);

      // If the user explicitly asked for weather/exchange rates and the external API is down (and no cache exists),
      // return a clear deterministic message and release the quota reservation so the model never invents numbers.
      if (
        toolEnrichment.allRequestedToolsFailed &&
        toolEnrichment.deterministicErrorReply
      ) {
        await reservation.release("external_tool_unavailable");
        const fallbackText = toolEnrichment.deterministicErrorReply;
        if ("stream" in body && body.stream === true) {
          res.status(200);
          res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
          res.setHeader("Cache-Control", "no-cache, no-transform");
          res.setHeader("Connection", "keep-alive");
          res.setHeader("X-Accel-Buffering", "no");
          res.flushHeaders();
          res.write(
            `data: ${JSON.stringify({
              id: `chatcmpl-${Date.now()}`,
              object: "chat.completion.chunk",
              choices: [
                {
                  index: 0,
                  delta: { role: "assistant", content: fallbackText },
                  finish_reason: null,
                },
              ],
            })}\n\n`
          );
          res.write(
            `data: ${JSON.stringify({
              object: "chat.completion.chunk",
              choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
            })}\n\n`
          );
          res.write("data: [DONE]\n\n");
          flushSseResponse(res);
          res.end();
          return;
        }

        const currentQuotas = await getUserQuotaStatus(userId);
        res.status(200).json({
          id: `chatcmpl-${Date.now()}`,
          object: "chat.completion",
          model: env.FREELLM_MODEL,
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: fallbackText,
              },
              finish_reason: "stop",
            },
          ],
          quotas: currentQuotas,
        });
        return;
      }

      const trustedMessages = buildTrustedMessages(
        instruction,
        toolEnrichment.messages
      );
      const { chatWithFreeLlm, streamChatWithFreeLlm } = await import(
        "../services/freeLlm.js"
      );

      if ("stream" in body && body.stream === true) {
        res.status(200);
        res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
        res.setHeader("Cache-Control", "no-cache, no-transform");
        res.setHeader("Connection", "keep-alive");
        res.setHeader("X-Accel-Buffering", "no");
        res.flushHeaders();

        try {
          const streamSentAtMs = Date.now();
          let firstTokenAtMs: number | null = null;
          let chunkCount = 0;
          let emittedCharCount = 0;
          let accumulatedOutput = "";
          let restrictedTriggered = false;

          res.write(
            `data: ${JSON.stringify({
              id: `chatcmpl-${streamSentAtMs}`,
              object: "chat.completion.chunk",
              choices: [
                {
                  index: 0,
                  delta: { role: "assistant" },
                  finish_reason: null,
                },
              ],
            })}\n\n`
          );
          flushSseResponse(res);

          for await (const token of streamChatWithFreeLlm(
            trustedMessages,
            controller.signal
          )) {
            if (controller.signal.aborted || res.destroyed) {
              throw new Error("Request aborted");
            }
            if (!token) continue;

            accumulatedOutput += token;
            if (isSecurityRestrictedOutput(accumulatedOutput)) {
              restrictedTriggered = true;
              controller.abort();
              if (emittedCharCount === 0) {
                firstTokenAtMs ??= Date.now();
                chunkCount += 1;
                emittedCharCount += SECURITY_REFUSAL_MESSAGE.length;
                res.write(
                  `data: ${JSON.stringify({
                    id: `chatcmpl-${Date.now()}`,
                    object: "chat.completion.chunk",
                    choices: [
                      {
                        index: 0,
                        delta: { content: SECURITY_REFUSAL_MESSAGE },
                        finish_reason: null,
                      },
                    ],
                  })}\n\n`
                );
              } else {
                const notice = `\n\n${SECURITY_REFUSAL_MESSAGE}`;
                chunkCount += 1;
                emittedCharCount += notice.length;
                res.write(
                  `data: ${JSON.stringify({
                    id: `chatcmpl-${Date.now()}`,
                    object: "chat.completion.chunk",
                    choices: [
                      {
                        index: 0,
                        delta: { content: notice },
                        finish_reason: null,
                      },
                    ],
                  })}\n\n`
                );
              }
              flushSseResponse(res);
              break;
            }

            if (firstTokenAtMs === null) {
              firstTokenAtMs = Date.now();
            }
            chunkCount += 1;
            emittedCharCount += token.length;
            res.write(
              `data: ${JSON.stringify({
                id: `chatcmpl-${Date.now()}`,
                object: "chat.completion.chunk",
                choices: [
                  {
                    index: 0,
                    delta: { content: token },
                    finish_reason: null,
                  },
                ],
              })}\n\n`
            );
            flushSseResponse(res);
          }

          if (!restrictedTriggered && (controller.signal.aborted || res.destroyed)) {
            throw new Error("Request aborted");
          }

          if (emittedCharCount === 0) {
            throw new Error("FreeLLMAPI returned an empty stream");
          }

          const totalMs = Date.now() - streamSentAtMs;
          const ttftMs =
            firstTokenAtMs !== null ? firstTokenAtMs - streamSentAtMs : totalMs;

          await reservation.commit({
            mode: "stream",
            message_count: messages.length,
            last_message_length: lastMessage.content.length,
            reply_length: emittedCharCount,
            ttft_ms: ttftMs,
            total_ms: totalMs,
            chunk_count: chunkCount,
          });

          if (env.NODE_ENV !== "production") {
            console.info("[chat/stream] metrics", {
              ttftMs,
              totalMs,
              chunkCount,
              replyLength: emittedCharCount,
            });
          }

          res.write(
            `data: ${JSON.stringify({
              object: "chat.completion.chunk",
              choices: [
                {
                  index: 0,
                  delta: {},
                  finish_reason: "stop",
                },
              ],
            })}\n\n`
          );

          res.write("data: [DONE]\n\n");
          flushSseResponse(res);
          res.end();
        } catch (err) {
          const isCancelled =
            controller.signal.aborted ||
            res.destroyed ||
            (err instanceof Error &&
              err.message.toLowerCase().includes("abort"));
          const isTimeout =
            !isCancelled &&
            err instanceof Error &&
            err.message.toLowerCase().includes("timeout");

          await reservation.release(
            isCancelled
              ? "client_cancelled"
              : isTimeout
                ? "provider_timeout"
                : "provider_error",
            {
              error: err instanceof Error ? err.message : "Stream failed",
            }
          );

          if (!isCancelled && !res.destroyed && !res.writableEnded) {
            const safeErrMessage =
              err instanceof Error && err.message
                ? err.message
                : "Chat generation failed.";
            console.error("Chat streaming failed:", safeErrMessage);

            res.write(
              `event: error\ndata: ${JSON.stringify({
                error: {
                  code: isTimeout ? "PROVIDER_TIMEOUT" : "PROVIDER_ERROR",
                  message: safeErrMessage,
                },
              })}\n\n`
            );

            res.end();
          }
        }
        return;
      }

      // Non-streaming completion
      try {
        const unarySentAtMs = Date.now();
        const rawReply = await chatWithFreeLlm(
          trustedMessages,
          env,
          fetch,
          controller.signal
        );
        if (controller.signal.aborted) {
          await reservation.release("client_cancelled");
          return;
        }

        const reply = isSecurityRestrictedOutput(rawReply)
          ? SECURITY_REFUSAL_MESSAGE
          : rawReply;
        const unaryTotalMs = Date.now() - unarySentAtMs;

        await reservation.commit({
          mode: "unary",
          message_count: messages.length,
          last_message_length: lastMessage.content.length,
          reply_length: reply.length,
          total_ms: unaryTotalMs,
          chunk_count: 1,
        });

        const updatedQuotas = await getUserQuotaStatus(userId);

        res.status(200).json({
          id: `chatcmpl-${Date.now()}`,
          object: "chat.completion",
          model: env.FREELLM_MODEL,
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: reply,
              },
              finish_reason: "stop",
            },
          ],
          quotas: updatedQuotas,
        });
      } catch (err) {
        const isCancelled =
          controller.signal.aborted ||
          (err instanceof Error && err.message.toLowerCase().includes("abort"));
        const isTimeout =
          !isCancelled &&
          err instanceof Error &&
          err.message.toLowerCase().includes("timeout");

        await reservation.release(
          isCancelled
            ? "client_cancelled"
            : isTimeout
              ? "provider_timeout"
              : "provider_error",
          {
            error: err instanceof Error ? err.message : "Unary call failed",
          }
        );

        if (isCancelled) {
          return;
        }
        const safeErrMessage =
          err instanceof Error && err.message
            ? err.message
            : "Ошибка генерации ответа от ИИ-провайдера.";
        console.error("Chat completion failed:", safeErrMessage);
        res.status(isTimeout ? 504 : 502).json({
          error: {
            code: isTimeout ? "PROVIDER_TIMEOUT" : "PROVIDER_ERROR",
            message: safeErrMessage,
          },
        });
        return;
      }
    } finally {
      req.off("aborted", abortOnDisconnect);
      res.off("close", abortOnDisconnect);
      if (!reservation.isSettled()) {
        await reservation.release("unexpected_exit");
      }
    }
  } catch (err) {
    next(err);
  }
});

export default router;