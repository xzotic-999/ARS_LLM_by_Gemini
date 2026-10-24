import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import dotenv from 'dotenv';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'path';
import { defineConfig, type Plugin } from 'vite';
import type { ChatMessage, FreeLlmRuntimeConfig } from './backend/src/services/freeLlm';

function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf-8').trim();
        resolve(raw ? (JSON.parse(raw) as Record<string, unknown>) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function getServerFreeLlmConfig(): FreeLlmRuntimeConfig {
  dotenv.config({ path: path.resolve(__dirname, '.env'), override: true });
  return {
    FREELLM_API_BASE_URL:
      process.env.FREELLM_API_BASE_URL?.trim() ||
      'https://v7skvft7-31415.euw.devtunnels.ms/v1',
    FREELLM_API_KEY: process.env.FREELLM_API_KEY?.trim() || '',
    FREELLM_MODEL: process.env.FREELLM_MODEL?.trim() || 'auto',
    FREELLM_TIMEOUT_MS: Number(process.env.FREELLM_TIMEOUT_MS ?? 120_000),
    FREELLM_FALLBACK_BASE_URL: process.env.FREELLM_FALLBACK_BASE_URL?.trim() || '',
    FREELLM_FALLBACK_API_KEY: process.env.FREELLM_FALLBACK_API_KEY?.trim() || '',
    FREELLM_FALLBACK_MODEL: process.env.FREELLM_FALLBACK_MODEL?.trim() || 'auto',
  };
}

function arsLlmServerChatMiddleware(): Plugin {
  return {
    name: 'ars-llm-server-chat-middleware',
    configureServer(server) {
      dotenv.config({ path: path.resolve(__dirname, '.env') });
      process.env.POSTGRES_USER = process.env.POSTGRES_USER || 'ars_llm_user';
      process.env.POSTGRES_PASSWORD =
        process.env.POSTGRES_PASSWORD || 'dev_preview_postgres_password';
      process.env.POSTGRES_DB = process.env.POSTGRES_DB || 'ars_llm_db';

      server.middlewares.use(
        async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
          const url = req.url?.split('?')[0] ?? '';
          if (req.method !== 'POST' || url !== '/api/v1/chat/completions') {
            next();
            return;
          }

          const [
            { chatWithFreeLlm, streamChatWithFreeLlm },
            { buildTrustedMessages, getCachedInstruction, loadInstruction },
          ] = await Promise.all([
            import('./backend/src/services/freeLlm'),
            import('./backend/src/services/instruction'),
          ]);

          let body: Record<string, unknown>;
          try {
            body = await readJsonBody(req);
          } catch {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(
              JSON.stringify({
                error: { code: 'VALIDATION_ERROR', message: 'Invalid JSON body' },
              })
            );
            return;
          }

          const rawMessages = body.messages;
          const stream = body.stream;

          if (!Array.isArray(rawMessages) || rawMessages.length === 0 || rawMessages.length > 100) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(
              JSON.stringify({
                error: {
                  code: 'VALIDATION_ERROR',
                  message: 'messages must be an array with 1 to 100 items',
                },
              })
            );
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
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json; charset=utf-8');
              res.end(
                JSON.stringify({
                  error: {
                    code: 'VALIDATION_ERROR',
                    message: 'Each message must have a valid role and non-empty string content',
                  },
                })
              );
              return;
            }
            validMessages.push({
              role: (msg as ChatMessage).role,
              content: (msg as ChatMessage).content,
            });
          }

          if (validMessages[validMessages.length - 1].role !== 'user') {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(
              JSON.stringify({
                error: {
                  code: 'VALIDATION_ERROR',
                  message: 'The last message must have role "user"',
                },
              })
            );
            return;
          }

          let corporateInstruction = '';
          try {
            corporateInstruction = getCachedInstruction() || loadInstruction();
          } catch {
            corporateInstruction = '';
          }

          const trustedMessages = corporateInstruction
            ? buildTrustedMessages(corporateInstruction, validMessages)
            : validMessages.filter((m) => m.role !== 'system');

          const runtimeConfig = getServerFreeLlmConfig();
          const completionId = `chatcmpl-${randomUUID()}`;
          const created = Math.floor(Date.now() / 1000);

          if (stream) {
            res.statusCode = 200;
            res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
            res.setHeader('Cache-Control', 'no-cache, no-transform');
            res.setHeader('Connection', 'keep-alive');
            res.setHeader('X-Accel-Buffering', 'no');

            const abortController = new AbortController();
            req.on('close', () => abortController.abort());

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
                res.end();
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
                res.end();
              }
            }
            return;
          }

          try {
            const reply = await chatWithFreeLlm(trustedMessages, runtimeConfig);
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(
              JSON.stringify({
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
              })
            );
          } catch (err) {
            res.statusCode = 502;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(
              JSON.stringify({
                error: {
                  code: 'BAD_GATEWAY',
                  message:
                    err instanceof Error ? err.message : 'Service temporarily unavailable',
                },
              })
            );
          }
        }
      );
    },
  };
}

export default defineConfig(() => {
  const backendTarget =
    process.env.BACKEND_URL ||
    (process.env.npm_lifecycle_event === 'dev:local' ? 'http://localhost:3000' : '');

  return {
    plugins: [
      react(),
      tailwindcss(),
      ...(!backendTarget ? [arsLlmServerChatMiddleware()] : []),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
      ...(backendTarget
        ? {
            proxy: {
              '/api': {
                target: backendTarget,
                changeOrigin: true,
              },
            },
          }
        : {}),
    },
  };
});
