# 2026-10-23-002 — ARS_LLM Backend Integration & Migration

## 1. Task and Objective
Integrate the production **ARS_LLM** backend, PostgreSQL schema migrations, session authentication, quota enforcement, and Server-Sent Events (SSE) chat completions from `ARS_LLM_GEMINI_HANDOFF.zip` with the WCAG 2.1 AA Gemini React reference frontend in this repository, while preserving the reference UI design, dark mode, Markdown (`.md`) chat export, and multilingual Text-to-Speech (`ru-RU`, `kk-KZ`, `en-US`) features.

---

## 2. Files Changed

### Backend & Infrastructure (Migrated from Handoff Archive & Hardened)
- `Instruction.md` — Created mandatory corporate system prompt required at backend startup by `loadInstruction()`.
- `HANDOFF_MANIFEST.txt` & `docs/GEMINI_HANDOVER.md` — Added handoff manifest and architecture documentation from the staging archive.
- `infra/docker-compose.yml` — Added Docker Compose orchestration for `postgres:16-alpine` and `backend`.
- `backend/Dockerfile` — Multi-stage Node 20 Alpine build; updated to copy `Instruction.md` into builder and runtime stages (`/app/Instruction.md`) so the container does not fail fast on startup.
- `backend/package.json` & `backend/tsconfig.json` — Configured TypeScript (`Node16`) build for backend and excluded `*.test.ts` from production `dist/` output.
- `backend/src/index.ts`, `backend/src/types.ts`, `backend/src/config/env.ts`, `backend/src/config/index.ts` — Express server entry point, session store (`connect-pg-simple`), CORS with credentials, rate limiting, and environment validation.
- `backend/src/db/index.ts`, `backend/src/db/migrate.ts`, `backend/src/db/seedAdmin.ts` — PostgreSQL connection pool, SQL migration runner (updated to resolve both `src/migrations` and `dist/migrations`), and initial admin bootstrap seeder.
- `backend/src/migrations/001_init.sql` .. `005_align_schema.sql` — Complete 5-step PostgreSQL schema migrations (`users`, `sessions`, `conversations`, `messages`, `quotas`, `usage_events`).
- `backend/src/middleware/auth.ts`, `backend/src/middleware/csrf.ts`, `backend/src/middleware/errorHandler.ts` — Session authentication (`requireAuth`, `requireAdmin`), CSRF helper, and centralized error handling.
- `backend/src/services/instruction.ts` — Updated `instructionPath()` to resolve `Instruction.md` across dev, compiled `dist/`, and Docker `/app/Instruction.md` paths, plus `buildTrustedMessages()` to strip client-supplied `system` messages.
- `backend/src/services/quota.ts` — Updated `getUserQuotaStatus()` and `getUserQuotaLimits()` to fall back to `env.DAILY_QUOTA_DEFAULT` (20) and `env.MONTHLY_QUOTA_DEFAULT` (500) when no custom quota row exists yet.
- `backend/src/services/freeLlm.ts` — Server-side FreeLLMAPI client (`chatWithFreeLlm` and `streamChatWithFreeLlm` async generator).
- `backend/src/routes/auth.ts` — Added `quotas` to `GET /api/v1/auth/me` and added `GET /api/v1/auth/quotas`.
- `backend/src/routes/conversations.ts` — Full CRUD for `/api/v1/conversations` (`GET`, `POST`, `PATCH /:id`, `DELETE /:id`).
- `backend/src/routes/messages.ts` — Fixed `reserveQuota` parameter ordering (`limits.daily.limit, limits.monthly.limit`) and added `defer_quota_to_completion` support so saving a user message before streaming completions does not double-decrement the user's quota.
- `backend/src/routes/chat.ts` — Fixed `reserveQuota` parameter ordering (`limits.daily.limit, limits.monthly.limit`) and preserved SSE streaming (`data: {...}\n\n`, `data: [DONE]\n\n`, and `event: error`).
- `backend/src/routes/admin.ts` — Admin user listing (`GET /api/v1/admin/users`), quota management (`GET/PUT /api/v1/admin/users/:id/quotas`), and usage analytics (`GET /api/v1/admin/usage`).
- `backend/src/services/backendLogic.test.ts` — Added unit tests for `loadInstruction`, `buildTrustedMessages`, and `periodStart`.

### Frontend & Root Configuration
- `.env.example` & `.gitignore` — Added all PostgreSQL, session, quota, admin bootstrap, and server-side FreeLLMAPI environment variable placeholders; ignored `backend/node_modules/`, `backend/dist/`, and `.playwright-cli/`.
- `tsconfig.json` & `vite.config.ts` — Excluded `backend` from browser `tsconfig.json` (since `backend` compiles with `backend/tsconfig.json`) and configured `/api` proxy in `vite.config.ts`.
- `src/services/api.ts` — Created typed API client (`authApi`, `conversationsApi`, `messagesApi`, `chatApi`, `adminApi`) using `credentials: 'include'`, `parseSseLines()` SSE stream parser, and `isValidCorporateEmail()` supporting `.local` intranet addresses.
- `src/components/LoginPage.tsx` — Created accessible login view wired to `POST /api/v1/auth/login` with light/dark theme switcher and an explicit offline UI preview button (`?demo=1`).
- `src/components/Sidebar.tsx` — Integrated live conversations list (`НЕДАВНИЕ ДИАЛОГИ`) with inline rename and delete actions, user profile & role display, daily/monthly quota counter card, conditional `Админ-панель` navigation item (`user.role === 'admin'`), and logout action.
- `src/components/ChatThreadView.tsx` — Added live SSE streaming indicator (`печатает...`), `Остановить генерацию` abort button (`AbortController`), and retryable error banner while preserving Text-to-Speech (`ru-RU`, `kk-KZ`, `en-US`) and Markdown copy.
- `src/components/WorkspaceModalsAndViews.tsx` — Added `AdminPanelView` (`activeNav === 'admin'`) wired to `adminApi.listUsers()`, `adminApi.setUserQuotas()`, and `adminApi.getUsage()`.
- `src/App.tsx` — Connected startup session check (`GET /api/v1/auth/me`), login/logout lifecycle, conversation CRUD, message persistence, real-time SSE completion streaming, quota refresh, and fixed the stale message state bug when switching to empty conversations.
- `src/utils/dashboardLogic.ts` & `src/utils/dashboardLogic.test.ts` — Added `mapBackendConversationToSession` and `formatTimestampShort`, and expanded unit test suite to 9 tests covering SSE parsing, `.local` email validation, and conversation mapping.

---

## 3. Implementation Details
1. **Fixing Quota Double-Counting & Argument Mismatch**:
   - In the handoff archive, both `POST /api/v1/messages` (`role: 'user'`) and `POST /api/v1/chat/completions` called `reserveQuota(userId, "daily", limits.daily.limit, limits.daily.limit)` and `reserveQuota(userId, "monthly", limits.monthly.limit, limits.monthly.limit)`. That passed the wrong 3rd/4th arguments and consumed 2 quota units per user prompt.
   - We fixed the arguments to `(userId, period, limits.daily.limit, limits.monthly.limit)` in both files, and added `defer_quota_to_completion: true` on `POST /api/v1/messages` so it checks quota (`checkQuota`) without incrementing `used`, letting `POST /api/v1/chat/completions` perform the single atomic `reserveQuota` increment.
2. **Startup Instruction Resolution**:
   - `backend/src/index.ts` calls `loadInstruction()` on startup and exits (`process.exit(1)`) if `Instruction.md` is missing. We created `/Instruction.md` at the repository root, updated `backend/Dockerfile` to copy it into `/app/Instruction.md`, and updated `backend/src/services/instruction.ts` to search candidate paths across dev, compiled `dist/`, and Docker layouts.
3. **Preserving the Reference UI & Fixing Stale Conversation State**:
   - In the handoff archive's `frontend/src/App.tsx`, switching to a conversation with `0` messages failed to clear `messages` because of a `if (historyMessages.length > 0)` guard. In our integrated `src/App.tsx`, `handleSelectSession` unconditionally replaces the conversation's `messages` array with the backend response.

---

## 4. Verification

| Check | Command / Method | Result | Notes |
| :--- | :--- | :--- | :--- |
| Frontend Unit Tests | `./node_modules/.bin/tsx --test src/utils/dashboardLogic.test.ts` | **PASSED** (9/9) | Tested theme toggle, WCAG contrast, custom lists, search filter, chat submission, model params, `.md` export, TTS language detection, SSE parser, `.local` email validation, and conversation mapping. |
| Backend Unit Tests | `./node_modules/.bin/tsx --test backend/src/services/backendLogic.test.ts` | **PASSED** (3/3) | Tested `loadInstruction`, `buildTrustedMessages` (system role stripping), and `periodStart` UTC boundaries. |
| Frontend Typecheck | `npm run lint` (`tsc --noEmit`) | **PASSED** (0 errors) | Clean TypeScript verification across all `/src` modules. |
| Frontend Production Build | `npm run build` (`vite build`) / `compile_applet` | **PASSED** | Built production bundle cleanly to `dist/`. |
| Backend TypeScript Build | `npm --prefix backend run build` (`tsc`) | **PASSED** (0 errors) | Compiled backend TypeScript to `backend/dist/`. |
| Browser UI Verification | `playwright-cli` (`http://localhost:3000` & `http://localhost:3000/?demo=1`) | **PASSED** | Verified `<LoginPage />` auth gate on unauthenticated root and full workspace, quota card, conversation list, and `Админ-панель` in browser. |
| Live PostgreSQL Migrations & Docker Compose | `docker compose up` / `npm --prefix backend run migrate` | **BLOCKED** (Environment) | Container sandbox does not have `docker`, `psql`, or a running PostgreSQL server instance installed. |

---

## 5. Known Issues and Risks
- **Sandbox PostgreSQL / FreeLLMAPI Availability**: Because this build container does not run a PostgreSQL daemon or Docker engine, end-to-end database queries against a live PostgreSQL instance could not be executed inside the sandbox. Full SQL migrations (`001`–`005`) and Docker Compose configuration are staged and verified at the TypeScript compilation level for execution in the target deployment environment.
- **Legacy `csurf` Package Deprecation Warning**: `backend/package.json` includes `csurf` from the original backend snapshot; however, active session protection relies on `SameSite=Lax`, `HttpOnly` cookies, and strict CORS origin allowlisting.

---

## 6. Architecture and API Impact
- **Authentication**: `POST /api/v1/auth/login`, `POST /api/v1/auth/logout`, `GET /api/v1/auth/me` (now includes `quotas`), and `GET /api/v1/auth/quotas`.
- **Conversations & Messages**: `GET/POST /api/v1/conversations`, `GET/PATCH/DELETE /api/v1/conversations/:id`, and `GET/POST /api/v1/messages` (with `defer_quota_to_completion`).
- **Completions**: `POST /api/v1/chat/completions` (`stream: true` SSE and `stream: false` JSON) with server-side `Instruction.md` prepending and client `system` role filtering.
- **Admin**: `GET /api/v1/admin/users`, `GET/PUT /api/v1/admin/users/:id/quotas`, and `GET /api/v1/admin/usage`.

---

## 7. Next Steps
1. In the target deployment or local Docker environment, copy `.env.example` to `.env` and populate `POSTGRES_PASSWORD`, `SESSION_SECRET`, `ADMIN_BOOTSTRAP_PASSWORD`, and `FREELLM_API_KEY`.
2. Run `docker compose -f infra/docker-compose.yml up --build -d` and execute `docker compose -f infra/docker-compose.yml exec backend node dist/db/migrate.js` to apply migrations `001`–`005` against the live PostgreSQL 16 container.

---

## 8. Git Reference
- **Repository**: `xzotic-999/ARS_LLM_by_Gemini`
- **Git Status in Sandbox**: Local `.git` directory is not mounted inside `/app/applet` in the AI Studio container; changes are saved directly in the connected workspace filesystem for platform sync/commit.
