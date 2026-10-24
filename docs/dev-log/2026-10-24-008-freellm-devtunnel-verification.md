# 2026-10-24-008 — FreeLLMAPI VS Code Dev Tunnel Integration & Live Cloud Verification

- **Date**: 2026-10-24
- **Task / Issue ID**: DEV-008 (Cloud Backend to FreeLLMAPI Dev Tunnel Integration & Preview SSE Streaming)
- **Objective**:
  1. Audit the end-to-end chat request path and FreeLLMAPI client in `ARS_LLM`.
  2. Verify server-side isolation of `FREELLM_API_BASE_URL`, `FREELLM_API_KEY`, and `FREELLM_MODEL`.
  3. Confirm compatibility with FreeLLMAPI's OpenAI-compatible `/v1/chat/completions` endpoint, Bearer authorization, message payload, and SSE streaming.
  4. Configure safe cloud defaults (`FREELLM_API_BASE_URL=https://v7skvft7-31415.euw.devtunnels.ms/v1`, `FREELLM_MODEL=auto`), normalize base URLs (handling trailing slashes or omitted `/v1` suffix), and add a non-intrusive server-side connectivity and short generation verification utility (`verifyFreeLlmConnection` / `npm --prefix backend run verify:freellm`).
  5. Replace the static template reply in preview/demo workspace mode (`src/App.tsx`) with real SSE streaming via server-side `/api/v1/chat/completions` (`vite.config.ts` middleware -> `streamChatWithFreeLlm` + `Instruction.md`) while keeping the UI 100% unchanged.

## Files Created / Modified / Deleted
- **Modified**:
  - `.env.example` — Updated default `FREELLM_API_BASE_URL` to `https://v7skvft7-31415.euw.devtunnels.ms/v1` and `FREELLM_MODEL` to `auto`, documenting secret injection for `FREELLM_API_KEY`.
  - `backend/src/config/env.ts` — Updated fallback default `FREELLM_API_BASE_URL` when unset in environment variables to `https://v7skvft7-31415.euw.devtunnels.ms/v1` and added automatic `/v1` suffix normalization.
  - `backend/src/services/freeLlm.ts` — Added `normalizeFreeLlmBaseUrl()`, `buildFreeLlmHeaders()` (including `X-Tunnel-Skip-AntiPhishing-Page: true` and `Accept: application/json`), Dev Tunnel HTML/redirect diagnostic classification, and `verifyFreeLlmConnection()` for `GET /models` and `POST /chat/completions`.
  - `backend/package.json` — Added `"verify:freellm": "tsx src/scripts/verifyFreeLlm.ts"`.
  - `backend/src/services/backendLogic.test.ts` — Added unit tests for `verifyFreeLlmConnection`, Dev Tunnel header injection, secret non-exposure, and tunnel redirect detection.
  - `vite.config.ts` — Mounted server-side `POST /api/v1/chat/completions` middleware (`arsLlmServerChatMiddleware`) in standalone preview mode so requests apply `Instruction.md` and stream from FreeLLMAPI without exposing `FREELLM_API_KEY` to the browser.
  - `src/App.tsx` — Updated `handleSubmitPrompt` in preview/demo workspace mode to stream real completions via `chatApi.streamCompletions()` instead of returning canned placeholder text, preserving 100% of the visual UI.
- **Created**:
  - `backend/src/scripts/verifyFreeLlm.ts` — CLI diagnostic runner that outputs a sanitized JSON report for `GET /v1/models` and `POST /v1/chat/completions`.
  - `docs/dev-log/2026-10-24-008-freellm-devtunnel-verification.md` — This development log entry.

## Architectural & Technical Rationale
- **Secret Isolation**: `FREELLM_API_KEY` is stored only in gitignored runtime environment configuration (`.env` / server secrets), read exclusively on the server (`process.env.FREELLM_API_KEY`), never prefixed with `VITE_`, and never logged in error output or diagnostic reports.
- **Real Responses in Preview**: Previously, entering the preview workspace (`isDemoMode`) invoked `submitChatPrompt()`, which returned a static template string (`"Запрос обработан моделью **ars-llm-pro-2.5**..."`). Routing preview chat submissions through `POST /api/v1/chat/completions` on the server ensures real FreeLLMAPI SSE streaming with `Instruction.md` applied.
- **UI Preservation**: Zero visual components, styles, layouts, or markup were modified.

## Commands Executed & Verification Results
- `npm --prefix backend run build` -> **PASS** (0 TypeScript errors)
- `npx tsx --test backend/src/services/backendLogic.test.ts src/utils/dashboardLogic.test.ts` -> **PASS** (22/22 unit tests passed: 13 backend + 9 frontend)
- `npm --prefix backend run verify:freellm` -> **PASS**:
  - `GET https://v7skvft7-31415.euw.devtunnels.ms/v1/models`: `ok: true`, `status: 200`, `latencyMs: 1714`, `modelCount: 288`.
  - `POST https://v7skvft7-31415.euw.devtunnels.ms/v1/chat/completions`: `ok: true`, `status: 200`, `latencyMs: 4629`.
- `curl -sS -N -X POST http://localhost:3000/api/v1/chat/completions ...` -> **PASS**:
  - Streamed real SSE chunks: `"Меня зовут ARS LLM, я корпоративный ИИ-ассистент компании ARS."` followed by `data: [DONE]`.
