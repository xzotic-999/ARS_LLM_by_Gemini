# Development Journal — Report 004: DEV-003 Local Docker Compose & Bootstrap Security Hardening

- **Date:** 2026-10-24
- **Report ID:** `2026-10-24-004-dev-003-local-docker-compose`
- **Author:** Gemini 4 Argon (Lead Integration Engineer)
- **Status:** Implemented & Verified (Static Build, Typecheck & Unit Tests Passed; Docker CLI Runtime Deferred to Host Windows Environment)

---

## 1. Task and Objective

Prepare and harden the local Docker Compose configuration (`infra/docker-compose.yml`), backend environment validation (`backend/src/config/env.ts`), and administrator bootstrap service (`backend/src/services/bootstrap.ts`) so that PostgreSQL and the `ARS_LLM` backend can be safely started locally on Windows via Docker Desktop while the frontend runs locally on the host.

Key objectives:
1. Pass all required environment variables (`SESSION_SECRET`, `ADMIN_BOOTSTRAP_EMAIL`, `ADMIN_BOOTSTRAP_PASSWORD`, `ADMIN_BOOTSTRAP_NAME`, `FREELLM_*`, quotas, rate limits, and PostgreSQL credentials) into the `backend` service in `infra/docker-compose.yml`.
2. Preserve internal backend-to-PostgreSQL connectivity via the Docker service name `postgres` (`POSTGRES_HOST: postgres`, `POSTGRES_PORT: 5432`) and FreeLLMAPI connectivity via `http://host.docker.internal:31415/v1`.
3. Do not publish the PostgreSQL port (`5432`) to host network interfaces in `infra/docker-compose.yml`, keeping database access strictly internal to `ars_llm_network`.
4. Eliminate the hardcoded fallback password `ChangeMe123!` and remove password logging in `backend/src/services/bootstrap.ts`. Enforce fail-fast validation in `backend/src/config/env.ts` when required secrets are missing or insecure placeholders are used in `production`.
5. Guarantee that `ensureBootstrapAdmin()` is strictly idempotent: if an active administrator already exists, or if an existing user is promoted to administrator, existing passwords are never overwritten on subsequent restarts.
6. Harden `.gitignore` against `.env`, backup files, database dumps, and private keys, and align `.env.example` using safe placeholder values.
7. Keep `frontend` out of `infra/docker-compose.yml` and provide a clean local Windows workflow (`npm run dev:local` on port `5173` proxying `/api` to `http://localhost:3000`).

---

## 2. Files Changed

| File Path | Description of Change |
| :--- | :--- |
| `infra/docker-compose.yml` | Added all required backend environment variables (`SESSION_SECRET`, `ADMIN_BOOTSTRAP_EMAIL`, `ADMIN_BOOTSTRAP_PASSWORD`, `ADMIN_BOOTSTRAP_NAME`, `NODE_ENV`, `PORT`, `SESSION_MAX_AGE_MS`, `RATE_LIMIT_*`, `DAILY_QUOTA_DEFAULT`, `MONTHLY_QUOTA_DEFAULT`, `FREELLM_*`, `POSTGRES_*`); kept `postgres` internal-only on `ars_llm_network` without host port publishing; added PostgreSQL `healthcheck` (`pg_isready`) and `depends_on: condition: service_healthy`; added `extra_hosts: ["host.docker.internal:host-gateway"]`; bound backend host port to `127.0.0.1:${PORT:-3000}:3000`. |
| `backend/Dockerfile` | Updated dependency copy and installation (`COPY backend/package*.json ./` and conditional `npm ci` / `npm install`) so image builds succeed whether or not `backend/package-lock.json` is present. |
| `backend/src/config/env.ts` | Extracted and exported `validateEnvConfig(rawEnv)` with strict fail-fast validation: rejects `"ChangeMe123!"` in all environments, and in `production` requires non-placeholder `POSTGRES_PASSWORD`, `SESSION_SECRET` (>= 32 chars), `FREELLM_API_KEY`, `ADMIN_BOOTSTRAP_EMAIL`, and `ADMIN_BOOTSTRAP_PASSWORD`. |
| `backend/src/services/bootstrap.ts` | Removed `"ChangeMe123!"` fallback password and removed all password warning logs. Exported `validateBootstrapCredentials()` and updated `ensureBootstrapAdmin()` to accept an injectable `QueryExecutor` and return status (`"existing_admin" \| "promoted_existing_user" \| "created_admin"`), ensuring existing admins or promoted users never have their passwords overwritten. |
| `backend/src/index.ts` | Updated the startup `ensureBootstrapAdmin()` error handler so bootstrap failures in `production` terminate the process (`process.exit(1)`) rather than running in a broken state. |
| `backend/src/services/backendLogic.test.ts` | Added 3 unit tests covering `validateEnvConfig`, `ensureBootstrapAdmin` idempotency/non-overwrite guarantees, and `infra/docker-compose.yml` variable/port security assertions (total 6 backend unit tests). |
| `.gitignore` | Added explicit rules for `.env`, `.env.*` (with `!.env.example`), key/certificate files (`*.pem`, `*.key`, `*.crt`, `*.p12`, `secrets/`), and backup/dump files (`*.bak`, `*.backup`, `*.old`, `*.orig`, `*.tmp`, `*.swp`, `*.dump`, `*.sql.gz`). |
| `.env.example` | Aligned `POSTGRES_DB="ars_llm_db"` and `DB_URL` with `infra/docker-compose.yml` and documented safe placeholder values for local and Docker Compose deployment. |
| `package.json` | Added `"dev:local": "vite --port=5173"` script so local Windows developers can run the frontend on port `5173` while Docker Compose `backend` listens on port `3000`. |
| `vite.config.ts` | Updated `/api` proxy target to route to `http://localhost:3000` automatically when started via `npm run dev:local` (or `process.env.BACKEND_URL`), while preserving port `3001` default on `npm run dev` (`:3000`) to avoid self-proxy loops in AI Studio preview. |

---

## 3. Implementation Details

1. **Docker Compose Network & Port Security (`infra/docker-compose.yml`)**:
   - The `postgres` container does not expose `5432` to the host (`ports:` is omitted; a commented `127.0.0.1:5432:5432` snippet is left for optional local debugging). The backend connects internally via `POSTGRES_HOST: postgres` and `POSTGRES_PORT: 5432` over `ars_llm_network`.
   - Required secrets (`POSTGRES_PASSWORD`, `SESSION_SECRET`, `ADMIN_BOOTSTRAP_EMAIL`, `ADMIN_BOOTSTRAP_PASSWORD`, `FREELLM_API_KEY`) use Docker Compose required interpolation syntax (`${VAR:?VAR required}`) so `docker compose up` fails immediately at the CLI level if `.env` is incomplete.
   - Added `extra_hosts: ["host.docker.internal:host-gateway"]` so `http://host.docker.internal:31415/v1` resolves reliably across Windows Docker Desktop (WSL2 backend) and Linux Docker engines.
2. **Elimination of `ChangeMe123!` and Idempotent Admin Bootstrap (`backend/src/services/bootstrap.ts` & `backend/src/config/env.ts`)**:
   - Previously, `bootstrap.ts` fell back to `"ChangeMe123!"` and printed the default password in stdout logs. Both behaviors have been completely removed.
   - `ensureBootstrapAdmin()` first checks `SELECT id FROM users WHERE role = 'admin' AND is_active = true LIMIT 1`. If an active admin exists, it logs `[BOOTSTRAP] Active admin already exists; skipping bootstrap.` and exits without touching any user record or password hash.
   - If no active admin exists, `validateBootstrapCredentials()` verifies that `ADMIN_BOOTSTRAP_EMAIL` and `ADMIN_BOOTSTRAP_PASSWORD` are non-empty and not `"ChangeMe123!"`. If a user with `ADMIN_BOOTSTRAP_EMAIL` already exists in `users`, they are promoted via `UPDATE users SET role = 'admin', is_active = true WHERE email = $1` without altering their password hash.

---

## 4. Verification

The following commands were executed in `/app/applet` and their actual outputs observed:

1. **Docker Compose Config Check (`docker compose --env-file .env.example -f infra/docker-compose.yml config`)**:
   - **Result:** `sh: 1: docker: not found` (Docker CLI and daemon are not installed inside the AI Studio Linux sandbox container).
   - **Mitigation:** Added an automated structural validation test in `backend/src/services/backendLogic.test.ts` that parses `infra/docker-compose.yml` and verifies all required environment variables, internal `postgres` hostname, `host.docker.internal:31415/v1` endpoint, and absence of `0.0.0.0:5432` port publishing.
2. **Backend TypeScript Compilation (`npm --prefix backend run build` -> `tsc`)**:
   - **Result:** Passed with exit code `0` and zero TypeScript errors.
3. **Backend Unit Tests (`./node_modules/.bin/tsx --test backend/src/services/backendLogic.test.ts`)**:
   - **Result:** `6 passed, 0 failed` (`loadInstruction`, `buildTrustedMessages`, `periodStart`, `validateEnvConfig`, `ensureBootstrapAdmin`, and `infra/docker-compose.yml` verification).
4. **Frontend Unit Tests (`./node_modules/.bin/tsx --test src/utils/dashboardLogic.test.ts`)**:
   - **Result:** `9 passed, 0 failed`.
5. **Frontend TypeScript Lint (`npm run lint` / `lint_applet`) & Production Build (`npm run build` / `compile_applet`)**:
   - **Result:** Passed with zero errors.

---

## 5. Known Issues and Risks

- **Untested in Sandbox:** Live container startup (`docker compose -f infra/docker-compose.yml up --build`) and live PostgreSQL migration execution (`backend/src/db/migrate.ts`) could not be executed inside the AI Studio container because Docker and PostgreSQL binaries are not installed in this environment. They must be run on the Windows host with Docker Desktop using the exact commands documented in Section 7.
- **Database Migration Prerequisite:** Remember that `connect-pg-simple` (`createTableIfMissing: false`) and `ensureBootstrapAdmin()` expect the `users` and `sessions` tables from `backend/src/migrations/001_initial_schema.sql` to exist. On a fresh PostgreSQL volume, run the migration once inside the backend container (`docker compose --env-file .env -f infra/docker-compose.yml exec backend node dist/db/migrate.js`) after starting the stack.

---

## 6. Architecture and API Impact

- **No Breaking API Changes:** HTTP routes (`/api/v1/*`), SSE streaming (`/api/v1/chat`), session cookies (`connect.sid`), and database schema (`001_initial_schema.sql` and `002_seed_data.sql`) remain unchanged.
- **Configuration & Startup Hardening:** `backend` now fails fast at startup if required secrets are missing or if `ChangeMe123!` is supplied.
- **Local Dev Port Separation:** On Windows, Docker Compose `backend` binds `127.0.0.1:3000:3000`, while the local Vite frontend runs on `http://localhost:5173` via `npm run dev:local` and proxies `/api` requests to `http://localhost:3000`.

---

## 7. Next Steps (Local Windows Execution Guide)

1. **Create `.env` from `.env.example`** in the repository root (`D:\projects\ARS_LLM\.env`) and replace all `CHANGE_ME_*` placeholders with strong secrets.
2. **Validate and start Docker Compose** from the project root on Windows:
   ```powershell
   docker compose --env-file .env -f infra/docker-compose.yml config
   docker compose --env-file .env -f infra/docker-compose.yml up -d --build
   ```
3. **Run database migrations on first launch**:
   ```powershell
   docker compose --env-file .env -f infra/docker-compose.yml exec backend node dist/db/migrate.js
   docker compose --env-file .env -f infra/docker-compose.yml restart backend
   ```
4. **Start the Frontend locally on Windows**:
   ```powershell
   npm run dev:local
   ```
   Open `http://localhost:5173` in the browser (Vite automatically proxies `/api/*` to the Docker backend at `http://localhost:3000`).

---

## 8. Git Reference

- **Target Repository:** `https://github.com/xzotic-999/ARS_LLM_by_Gemini`
- **Branch:** `main`
- **Base Commit SHA:** `fd31efba1a84319d4785562c030a32200a5813f2`
- **Workspace Status:** All changes are saved in the AI Studio workspace VFS (which syncs with AI Studio's GitHub export) and bundled in `public/ars-llm-integrated-release.tar.gz`.
