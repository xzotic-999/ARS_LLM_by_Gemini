import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import {
  reserveQuota,
  recordUsage,
  getUserQuotaLimits,
} from "../services/quota.js";
import env from "../config/index.js";
import type { ChatMessage } from "../types.js";
import { buildTrustedMessages, getCachedInstruction } from "../services/instruction.js";

const router = Router();

router.use(requireAuth);

// POST /api/v1/chat/completions
router.post("/completions", async (req, res, next) => {
  try {
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

    // Enforce quotas before calling the model (pass daily.limit and monthly.limit accurately).
    const limits = await getUserQuotaLimits(userId);

    const dailyOk = await reserveQuota(
      userId,
      "daily",
      limits.daily.limit,
      limits.monthly.limit
    );
    const monthlyOk = await reserveQuota(
      userId,
      "monthly",
      limits.daily.limit,
      limits.monthly.limit
    );

    if (!dailyOk || !monthlyOk) {
      res.status(429).json({
        error: {
          message: "Превышен лимит запросов. Обратитесь к администратору.",
        },
      });
      return;
    }

    await recordUsage(userId, "model_call", {
      message_count: messages.length,
      last_message_length: lastMessage.content.length,
    });

    // Build trusted message array with corporate instruction prepended.
    // Client-supplied system messages are filtered out.
    const instruction = getCachedInstruction();
    if (!instruction) {
      res.status(503).json({
        error: { message: "Corporate instruction not loaded. Service unavailable." },
      });
      return;
    }

    const trustedMessages = buildTrustedMessages(instruction, messages);

    const { chatWithFreeLlm, streamChatWithFreeLlm } = await import("../services/freeLlm.js");

    if ("stream" in body && body.stream === true) {
      const controller = new AbortController();

      res.status(200);
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders();

      const abortOnDisconnect = () => {
        if (!res.writableEnded) {
          controller.abort();
        }
      };

      res.on("close", abortOnDisconnect);

      try {
        res.write(
          `data: ${JSON.stringify({
            id: `chatcmpl-${Date.now()}`,
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

        for await (const token of streamChatWithFreeLlm(trustedMessages, controller.signal)) {
          if (controller.signal.aborted || res.destroyed) break;

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
        }

        if (!controller.signal.aborted && !res.destroyed) {
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
          res.end();
        }
      } catch (err) {
        if (!controller.signal.aborted && !res.destroyed) {
          console.error(
            "Chat streaming failed:",
            err instanceof Error ? err.message : "Unknown error"
          );

          res.write(
            `event: error\ndata: ${JSON.stringify({
              error: { message: "Chat generation failed." },
            })}\n\n`
          );

          res.end();
        }
      } finally {
        res.off("close", abortOnDisconnect);
      }

      return;
    }

    const reply = await chatWithFreeLlm(trustedMessages);

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
    });
  } catch (err) {
    next(err);
  }
});

export default router;