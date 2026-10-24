# ARS_LLM Technical Handover for Gemini AI Studio

> **Source:** Audited from `D:\projects\ARS_LLM` on 2026-10-24  
> **Scope:** Frontend (React 18 + Vite + TypeScript) + Backend (Express + PostgreSQL + FreeLLMAPI)  
> **Constraint:** No secrets, no `.env`, no user data, no code changes

---

## 1. Architecture Overview

### Frontend
- **Location:** `D:\projects\ARS_LLM\frontend`
- **Stack:** React 18, TypeScript, Vite, Tailwind CSS (via custom tokens), lucide-react
- **Entry:** `src/main.tsx` → `src/App.tsx`
- **State:** React Context (Auth, Conversations), `useTheme` (localStorage + `.dark` class on `<html>`)
- **Build:** `npm run build` → `tsc -b && vite build`, output to `dist/`
- **Dev proxy:** Vite proxies `/api/*` → `http://localhost:3000` (`vite.config.ts:21-24`)

### Backend
- **Location:** `D:\projects\ARS_LLM\backend`
- **Stack:** Express (ESM), TypeScript, PostgreSQL (`pg`), session auth via `express-session` + `connect-pg-simple`
- **Entry:** `src/index.ts` → compiled to `dist/index.js`
- **Port:** `env.PORT || 3000` (`src/index.ts:106`)
- **Session store:** PostgreSQL table `sessions`
- **Rate limiting:** `express-rate-limit` (auth: 10/window, general: `env.RATE_LIMIT_MAX_REQUESTS`)

### Database
- **Pool:** `src/db/index.ts` (exports `pool`)
- **Migrations:** `src/db/migrate.ts` + `src/migrations/*.sql` (5 migrations including users, conversations, messages, quotas, usage_events)

---

## 2. API Routes (All under `/api/v1`)

| Method | Path | Auth | Description | Source |
|--------|------|------|-------------|--------|
| POST | `/auth/login` | — | Email/password → sets session cookie | `src/routes/auth.ts:6` |
| POST | `/auth/logout` | ✓ | Destroys session, clears cookie | `src/routes/auth.ts:57` |
| GET | `/auth/me` | ✓ | Returns current user from session | `src/routes/auth.ts:74` |
| GET | `/conversations` | ✓ | List user's conversations (ordered by `last_message_at` desc) | `src/routes/conversations.ts:9` |
| GET | `/conversations/:id` | ✓ | Get single conversation (ownership check) | `src/routes/conversations.ts:30` |
| POST | `/conversations` | ✓ | Create conversation `{ title }` | `src/routes/conversations.ts:53` |
| PATCH | `/conversations/:id` | ✓ | Rename conversation `{ title }` | `src/routes/conversations.ts:77` |
| DELETE | `/conversations/:id` | ✓ | Delete conversation (cascade deletes messages) | `src/routes/conversations.ts:114` |
| GET | `/messages?conversation_id=X` | ✓ | List messages for conversation (ASC by `created_at`) | `src/routes/messages.ts:9` |
| POST | `/messages` | ✓ | Create message `{ conversation_id, role?, text }`; reserves quota for `role=user` | `src/routes/messages.ts:48` |
| POST | `/chat/completions` | ✓ | Model call (non-streaming or SSE); enforces quota; injects corporate instruction | `src/routes/chat.ts:9` |
| POST | `/admin/users` | admin | Create user `{ name, email, password, role? }` | `src/routes/admin.ts:12` |
| GET | `/admin/users` | admin | List all users | `src/routes/admin.ts:52` |
| GET | `/admin/users/:id` | admin | Get single user | `src/routes/admin.ts:70` |
| PATCH | `/admin/users/:id` | admin | Update role/is_active | `src/routes/admin.ts:90` |
| DELETE | `/admin/users/:id` | admin | Deactivate user (soft delete) | `src/routes/admin.ts:114` |
| GET | `/admin/users/:id/quotas` | admin | Get user quota status & limits | `src/routes/admin.ts:138` |
| PUT | `/admin/users/:id/quotas` | admin | Set quota limits `{ daily_limit?, monthly_limit? }` | `src/routes/admin.ts:158` |
| GET | `/admin/usage?limit=50` | admin | Recent usage events | `src/routes/admin.ts:180` |

---

## 3. Request / Response Formats (Confirmed by Source)

### Auth
**POST /auth/login** → 200
```json
{ "user": { "id": 1, "name": "Ivan", "email": "ivan@company.kz", "role": "employee", "is_active": true, "email_verified": false, "created_at": "2026-01-15T10:00:00.000Z" } }
```
Sets `connect.sid` cookie (HttpOnly, SameSite=Lax, Secure in prod).

**GET /auth/me** → 200
```json
{ "user": { "id": 1, "name": "Ivan", "email": "ivan@company.kz", "role": "employee", "is_active": true, "email_verified": false, "created_at": "2026-01-15T10:00:00.000Z" } }
```
401 if no session.

### Conversations
**GET /conversations** → 200
```json
[
  { "id": 5, "title": "Биллинг оптимизация", "created_at": "2026-10-20T12:00:00.000Z", "last_message_at": "2026-10-23T11:45:00.000Z" }
]
```

**POST /conversations** (body: `{ "title": "Новый чат" }`) → 201
```json
{ "id": 6, "title": "Новый чат", "created_at": "2026-10-24T09:00:00.000Z", "last_message_at": "2026-10-24T09:00:00.000Z" }
```

### Messages
**GET /messages?conversation_id=5** → 200
```json
[
  { "id": 10, "conversation_id": 5, "role": "user", "text": "Привет", "created_at": "2026-10-23T11:40:00.000Z" },
  { "id": 11, "conversation_id": 5, "role": "assistant", "text": "Здравствуйте!", "created_at": "2026-10-23T11:40:05.000Z" }
]
```

**POST /messages** (body: `{ "conversation_id": 5, "role": "user", "text": "Как дела?" }`) → 201
```json
{ "id": 12, "conversation_id": 5, "role": "user", "text": "Как дела?", "created_at": "2026-10-24T09:05:00.000Z" }
```
Also updates `conversations.last_message_at`.

### Chat Completions (SSE)
**POST /chat/completions**  
Request body:
```json
{
  "messages": [
    { "role": "system", "content": "..." },
    { "role": "user", "content": "Как оптимизировать SQL?" }
  ],
  "stream": true
}
```
- Client-supplied `system` messages are **filtered out** by `buildTrustedMessages` (`src/services/instruction.ts`).
- Corporate instruction from `Instruction.md` is prepended as a single system message.
- Quota checked **before** calling FreeLLM (`reserveQuota` for daily/monthly).

#### SSE Stream Format (confirmed by `src/routes/chat.ts:98-142` and `src/services/freeLlm.ts:70-140`)

1. **Role chunk** (immediately after headers):
```
data: {"id":"chatcmpl-1729753200000","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}

```

2. **Content chunks** (repeated):
```
data: {"id":"chatcmpl-1729753200000","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"SQL"},"finish_reason":null}]}

```

3. **Finish chunk**:
```
data: {"object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}

```

4. **End marker**:
```
data: [DONE]

```

5. **Error event** (if upstream fails):
```
event: error
data: {"error":{"message":"Chat generation failed."}}

```

**Headers:** `Content-Type: text/event-stream; charset=utf-8`, `Cache-Control: no-cache, no-transform`, `Connection: keep-alive`

---

## 4. Authentication & Error Handling

- **Cookie-based sessions** (PostgreSQL-backed). Frontend calls with `credentials: "include"` (`frontend/src/services/conversations.ts:17-24`, `frontend/src/App.tsx:126`).
- **401 Unauthorized**: No valid session (`requireAuth`, `requireAdmin` in `src/middleware/auth.ts`). Frontend should redirect to login.
- **403 Forbidden**: Authenticated but insufficient role (non-admin accessing admin routes) or deactivated account (`src/routes/auth.ts:34-39`).
- **429 Too Many Requests**: Quota exceeded (daily/monthly) — returned by `/chat/completions` and `/messages` (user role) before calling model. Response:
  ```json
  { "error": { "message": "Превышен лимит запросов. Обратитесь к администратору." } }
  ```
- **400 Bad Request**: Validation errors (missing fields, length limits, invalid IDs).
- **404 Not Found**: Conversation/message not found or ownership mismatch (returns 404 to avoid enumeration).
- **500/503**: Upstream FreeLLMAPI failure, missing corporate instruction, DB errors → passed through `errorHandler` middleware.

---

## 5. Quota System

- **Location:** `src/services/quota.ts`
- **Tables:** `quotas` (user_id, period_type, period_start, used, daily_limit, monthly_limit), `usage_events`
- **Periods:** `daily` (UTC midnight), `monthly` (UTC 1st day)
- **Enforcement:** Atomic upsert + increment in `reserveQuota` with CHECK constraint on `used <= limit`. Called in:
  - `src/routes/messages.ts:77-86` (only for `role === "user"`)
  - `src/routes/chat.ts:79-90` (before every model call)
- **Admin controls:** `setUserQuotaLimits`, `getUserQuotaStatus`, `getUserQuotaLimits` (all in `src/services/quota.ts`)

---

## 6. FreeLLMAPI Integration

- **Location:** `src/services/freeLlm.ts`
- **Config:** `env.FREELLM_API_BASE_URL`, `env.FREELLM_API_KEY`, `env.FREELLM_MODEL` (`src/config/index.ts` used in `freeLlm.ts:6, 28, 78`)
- **Non-streaming:** `chatWithFreeLlm(messages)` → `Promise<string>` (returns `choices[0].message.content`)
- **Streaming:** `streamChatWithFreeLlm(messages, signal?)` → `AsyncGenerator<string>` (yields token strings)
- **Timeout:** 120s (both)
- **Error handling:** 401/403 → "FreeLLMAPI authentication failed"; other status → "FreeLLMAPI returned HTTP N"; empty response → "FreeLLMAPI returned an empty response"
- **No retries, no fallback models** (single model from env)

---

## 7. Corporate Instruction Injection

- **Source:** `Instruction.md` at repo root (loaded at startup, fatal if missing — `src/index.ts:15-25`)
- **Service:** `src/services/instruction.ts` — `loadInstruction()` (sync read), `getCachedInstruction()`, `buildTrustedMessages(instruction, messages)`
- **Behavior:** Client `system` messages are **dropped**; instruction is prepended as a single system message.
- **Frontend must NOT send system messages** — they are ignored by backend.

---

## 8. Frontend File Map (Key Files)

| File | Purpose |
|------|---------|
| `src/main.tsx` | Bootstrap, providers (Auth, Conversations, Theme) |
| `src/App.tsx` | Main shell: sidebar, topbar, ChatArea, handles SSE streaming, auth state |
| `src/contexts/auth.tsx` | `AuthProvider` (login, logout, me, session refresh), `ConversationsProvider` (CRUD + SSE sendMessage) |
| `src/services/conversations.ts` | Typed API client (`fetchWithAuth` with credentials) |
| `src/lib/theme.tsx` | `ThemeProvider` — localStorage + `document.documentElement.classList.add/remove('dark')` |
| `src/styles/tokens.css` | Design tokens (CSS custom properties); light default, `.dark` override |
| `src/styles/globals.css` | Global reset, layout (`.app`, `.sidebar`, `.main`), typography, components |
| `src/components/sidebar/index.tsx` | Collapsible sidebar: search, nav (Chats/Projects/Templates/Documents/History), conversation list, context menu |
| `src/components/sidebar/index.css` | Sidebar styles incl. `.collapsed` variant |
| `src/components/chat/ChatArea.tsx` | Chat view: WelcomeScreen, MessageBubble (copy btn), TypingIndicator, ChatComposer, Context Bar |
| `src/components/chat/ChatArea.css` | Chat styles |
| `src/components/topbar.tsx` | Top bar: title, theme toggle, settings, new chat |
| `src/components/ArsLogo.tsx` | Gradient 'A' SVG logo (from Gemini reference) |
| `src/components/QuickPrompts.tsx` | 5 quick-prompt chips (image/code/summarize/plan/idea) with colored icon badges |
| `src/components/LoginPage.tsx` | Login form (email/password) |
| `src/components/icon/index.tsx` | Lucide icon wrapper |
| `src/components/input/index.tsx` | MessageInput (auto-growing textarea + send) |
| `src/hooks/useConversations.ts` | Hook wrapper for ConversationsContext |

---

## 9. What Must Be Preserved When Integrating Gemini UI

| Feature | Current Implementation | Must Keep |
|---------|------------------------|-----------|
| Authentication | Cookie-based session, `credentials: "include"` | ✅ Yes |
| Conversation persistence | PostgreSQL, `conversations` + `messages` tables | ✅ Yes |
| SSE streaming | `/chat/completions` with `stream: true`, `TextDecoder` loop | ✅ Yes |
| Quota enforcement | Daily/monthly, checked before model call | ✅ Yes |
| Corporate instruction | Injected server-side from `Instruction.md` | ✅ Yes |
| Theme system | `.dark` class on `<html>`, localStorage, CSS tokens | ✅ Yes |
| Sidebar collapse | CSS transition, `var(--sidebar-width-collapsed)` | ✅ Yes |
| Conversation list + context menu | Rename/delete via API | ✅ Yes |
| Search filter | Client-side filter on `conversations` array | ✅ Yes |
| Error boundary | `ErrorBoundary` wraps App | ✅ Yes |

---

## 10. Gemini Reference UI Components (To Adopt Design, Not Logic)

**Source:** `D:\projects\ARS_LLM\ars-llm-workspace/src/components/`

| Component | Current in Main | Notes |
|-----------|----------------|-------|
| `ArsLogo.tsx` | ✅ Created & integrated in Sidebar | Gradient 'A' SVG, `collapsed` prop |
| `QuickPrompts.tsx` | ✅ Created (not yet wired to `handleSend`) | 5 chips with icon badges |
| `WorkspaceModalsAndViews.tsx` | ❌ Not yet created | Contains: `WorkspaceSectionView` (Projects/Templates/Documents/History), `PromptLibraryModal`, `ModelParamsModal`, `CommandSearchModal` |
| `QuickPrompts` data | `QUICK_PROMPTS` in `dashboardLogic.ts:82-128` | Static prompts with `promptText` + `assistantReply` (demo only) |

**Do NOT copy:**
- Local demo state (`useState` for sessions, templates, projects, documents)
- Fake assistant replies (`assistantReply` in `QUICK_PROMPTS`)
- `generateAssistantReply` / `submitChatPrompt` local logic
- `CommandSearchModal` local filtering

---

## 11. Unknown / Not Fully Audited (Cannot Guess)

| Area | Status |
|------|--------|
| `src/db/index.ts` pool configuration | File exists, not fully read |
| `src/config/index.ts` env schema | Referenced but not read |
| `src/services/instruction.ts` full implementation | Referenced in chat.ts, not read |
| `src/services/password.ts` hash/verify details | Imported, not read |
| `src/services/bootstrap.ts` admin bootstrap | Referenced, not read |
| `src/middleware/errorHandler.ts` error shape | Not read |
| Database schema (exact columns, constraints) | Only inferred from queries |
| `env.FREELLM_API_BASE_URL` actual value | In `.env` (excluded) |
| Frontend `LoginPage.tsx` exact UI | Not read |
| Frontend `ErrorBoundary.tsx` behavior | Not read |
| SSE retry / reconnection logic | None visible in frontend |

---

## 12. Verification

- Document path: `D:\projects\ARS_LLM\docs\GEMINI_HANDOVER.md`
- Created: 2026-10-24
- Source files read: 22 backend files + 17 frontend files (listed in sections 1-8)
- No source files modified
- No secrets included