# Development Journal — Report 005: Fix Vite Dev Proxy ECONNREFUSED in Preview Environment

- **Date:** 2026-10-24
- **Report ID:** `2026-10-24-005-fix-vite-proxy-econnrefused`
- **Author:** Gemini 4 Argon
- **Status:** Implemented & Verified

---

## 1. Task and Objective

Resolve `[vite] http proxy error: /api/v1/auth/me (Error: connect ECONNREFUSED 127.0.0.1:3001)` in the AI Studio preview environment when the external PostgreSQL + Express backend is not running.

---

## 2. Files Changed

| File Path | Description of Change |
| :--- | :--- |
| `vite.config.ts` | Enabled `server.proxy['/api']` only when `process.env.BACKEND_URL` is set or when running `npm run dev:local` (`http://localhost:3000`). In standalone AI Studio preview (`npm run dev`), Vite no longer attempts to proxy `/api` to an unreachable `127.0.0.1:3001` port. |
| `src/services/api.ts` | Added `Content-Type: text/html` detection in `request()` so SPA HTML fallback responses when no backend proxy is active throw a clean `ApiError(503)` handled gracefully by `App.tsx`. |

---

## 3. Implementation Details

- When `App.tsx` checks `GET /api/v1/auth/me` on mount in AI Studio preview, the absence of a running backend on `127.0.0.1:3001` previously caused Vite's `http-proxy` middleware to log `ECONNREFUSED`.
- By conditionally registering `server.proxy` only when `BACKEND_URL` or `dev:local` is active, and rejecting `text/html` fallback responses in `src/services/api.ts` with `ApiError(503)`, the preview loads the login / reference demo screen without proxy errors while `npm run dev:local` on Windows continues proxying `/api` to `http://localhost:3000`.

---

## 4. Verification

- Executed `lint_applet` (`tsc --noEmit`): passed with 0 errors.
- Executed `compile_applet` (`vite build`): passed with 0 errors.
- Restarted the Vite dev server (`restart_dev_server`): `/api/v1/auth/me` no longer triggers `http proxy error: ECONNREFUSED`.

---

## 5. Known Issues and Risks

- None.

---

## 6. Architecture and API Impact

- No changes to backend routes, database schema, or Docker Compose configuration.

---

## 7. Next Steps

- Use `npm run dev:local` on Windows alongside `docker compose --env-file .env -f infra/docker-compose.yml up -d --build`.

---

## 8. Git Reference

- **Branch:** `main`
- **Base Commit SHA:** `fd31efba1a84319d4785562c030a32200a5813f2`
