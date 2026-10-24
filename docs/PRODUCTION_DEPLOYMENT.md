# ARS_LLM — Production Architecture & Deployment Guide

This guide documents the production architecture of `ARS_LLM`, explaining how the frontend, backend, PostgreSQL database, and FreeLLMAPI AI gateway operate on remote infrastructure with **zero dependency on the developer's workstation**.

---

## 1. Architecture Overview (Independent of Developer's Computer)

In local development, `infra/docker-compose.yml` connects to a desktop instance of FreeLLMAPI at `http://host.docker.internal:31415/v1`. **That local desktop instance cannot and must not be used in production.**

In `NODE_ENV=production`, `ARS_LLM` enforces the following architecture:

1. **Unified Single-Service Container (`Dockerfile` / `backend/Dockerfile`)**:
   - Stage 1 (`frontend-builder`) compiles the approved React SPA (`dist/`) without altering any visual design or UI components.
   - Stage 2 (`backend-builder`) compiles the Express TypeScript backend (`backend/dist/`).
   - Stage 3 (`runtime`) packages the compiled backend, SQL migrations (`dist/migrations`), mandatory `Instruction.md`, and compiled React SPA (`frontend-dist`) into a single Node 20 Alpine container.
   - Express enables `trust proxy` (`TRUST_PROXY=true`) for HTTPS load balancers, serves static SPA assets on the same origin, and mounts all `/api/v1/*` and `/health` routes.
2. **Startup Guard Against Local Addresses (`backend/src/config/env.ts`)**:
   - When `NODE_ENV=production`, `validateEnvConfig()` explicitly rejects `localhost`, `127.0.0.1`, `0.0.0.0`, `::1`, and `host.docker.internal` for `FREELLM_API_BASE_URL`, `FREELLM_FALLBACK_BASE_URL`, and `POSTGRES_HOST`.
   - If a deployment is accidentally configured with `host.docker.internal:31415`, the container fails fast at startup with a clear error message.
3. **Cloud PostgreSQL Persistence (`DATABASE_URL` & TLS/SSL)**:
   - Supports standard cloud connection strings (`DATABASE_URL` or `DB_URL`) as well as discrete `POSTGRES_*` variables.
   - Supports encrypted connections via `POSTGRES_SSL=true` and automatic startup schema migration via `AUTO_MIGRATE=true`.
4. **Remote FreeLLMAPI Gateway & Optional Failover (`backend/src/services/freeLlm.ts`)**:
   - Authenticates server-side using `Authorization: Bearer ${FREELLM_API_KEY}` against a remotely hosted FreeLLMAPI gateway or cloud OpenAI-compatible `/v1` endpoint.
   - Supports an optional secondary cloud failover endpoint (`FREELLM_FALLBACK_BASE_URL`, `FREELLM_FALLBACK_API_KEY`, `FREELLM_FALLBACK_MODEL`) that is automatically used if the primary gateway returns HTTP `408`, `429`, or `5xx` or experiences a network error.

---

## 2. Remote AI API Integration Options (Using Your `FREELLM_API_KEY`)

Because FreeLLMAPI is an open-source, self-hosted OpenAI-compatible `/v1` router that aggregates provider free tiers, there are two supported ways to run it in production without the developer's PC:

### Option A: Cloud-Hosted FreeLLMAPI Gateway Service (Recommended for FreeLLMAPI Keys)
Deploy the FreeLLMAPI gateway container as a private companion service on the same cloud platform (Render Private Service, Railway service, Fly.io app, or VPS Docker network) with a persistent volume for its encrypted SQLite state:
- **Endpoint (`FREELLM_API_BASE_URL`):** `http://freellm-gateway:31415/v1` (internal cloud private network) or `https://freellm.your-domain.com/v1`.
- **Authentication (`FREELLM_API_KEY`):** Your FreeLLMAPI key generated in the cloud gateway instance.
- **Model (`FREELLM_MODEL`):** `auto` (or a specific routed model ID).

### Option B: Cloud OpenAI-Compatible Provider Endpoint (Direct Cloud API or Fallback)
Because `backend/src/services/freeLlm.ts` speaks the standard OpenAI `/v1/chat/completions` protocol (both unary JSON and SSE `data: ...` streaming), you can point either `FREELLM_API_BASE_URL` or `FREELLM_FALLBACK_BASE_URL` directly to any managed cloud OpenAI-compatible endpoint:
- **OpenRouter:** `https://openrouter.ai/api/v1`
- **Google Gemini OpenAI-Compatible Endpoint:** `https://generativelanguage.googleapis.com/v1beta/openai`
- **Groq Cloud:** `https://api.groq.com/openai/v1`
- **DeepSeek / Together / Mistral:** `https://api.deepseek.com/v1`

> **Best Practice (High Availability):** Set `FREELLM_API_BASE_URL` + `FREELLM_API_KEY` to your primary cloud-hosted FreeLLMAPI gateway, and set `FREELLM_FALLBACK_BASE_URL` + `FREELLM_FALLBACK_API_KEY` to a managed cloud OpenAI-compatible endpoint (such as Gemini or OpenRouter) so chat generation continues uninterrupted even if upstream free-tier quotas rotate.

---

## 3. Required Environment Variables for Production

| Variable | Required in Prod | Example / Value | Description |
| :--- | :---: | :--- | :--- |
| `NODE_ENV` | Yes | `production` | Enables strict security checks, `secure` cookies, and local-host rejection. |
| `PORT` | No | `3000` | HTTP port inside the container. |
| `TRUST_PROXY` | No | `true` | Trusts `X-Forwarded-Proto` from cloud HTTPS load balancers. |
| `SERVE_STATIC_SPA` | No | `true` | Serves the compiled React SPA from `/app/frontend-dist`. |
| `AUTO_MIGRATE` | No | `true` | Automatically applies SQL migrations (`001_initial_schema.sql`, etc.) on startup. |
| `DATABASE_URL` | Yes* | `postgresql://user:pass@ep-xyz.neon.tech:5432/ars_llm_db` | Cloud PostgreSQL URL (*or* set `POSTGRES_HOST`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`). |
| `POSTGRES_SSL` | No | `true` | Set to `true` for managed cloud PostgreSQL providers requiring TLS. |
| `SESSION_SECRET` | Yes | 64-char hex string | Secret for signing PostgreSQL-backed session cookies (>= 32 chars). |
| `ADMIN_BOOTSTRAP_EMAIL` | Yes | `admin@company.kz` | Email for initial administrator creation (must not collide with a non-admin user). |
| `ADMIN_BOOTSTRAP_PASSWORD` | Yes | Strong unique password | Password for initial administrator creation (`ChangeMe123!` is forbidden). |
| `FREELLM_API_BASE_URL` | Yes | `https://freellm-gateway.internal/v1` | Remote FreeLLMAPI gateway or cloud OpenAI-compatible `/v1` base URL. |
| `FREELLM_API_KEY` | Yes | `flm_live_...` | Server-side API key for the primary AI gateway. |
| `FREELLM_MODEL` | No | `auto` | Model identifier sent to the primary gateway. |
| `FREELLM_FALLBACK_BASE_URL` | No | `https://openrouter.ai/api/v1` | Optional secondary cloud OpenAI-compatible base URL for automatic failover. |
| `FREELLM_FALLBACK_API_KEY` | No | `sk-or-v1-...` | Optional server-side API key for the fallback endpoint. |
| `FREELLM_FALLBACK_MODEL` | No | `google/gemini-2.5-flash` | Optional model identifier for the fallback endpoint. |

---

## 4. Step-by-Step Production Deployment

### Deployment Path 1: Managed Cloud PaaS (Render / Railway / Fly.io / Cloud Run)
1. **Provision Managed PostgreSQL**:
   - Create a PostgreSQL 15+ instance (e.g. Neon, Render PostgreSQL, Railway PostgreSQL, or Supabase) and copy its `DATABASE_URL`.
2. **Deploy Remote FreeLLMAPI Gateway (or Select Cloud Endpoint)**:
   - Deploy your FreeLLMAPI container as a cloud service with a persistent volume and record its internal/HTTPS URL (`https://<your-freellm-service>/v1`) and `FREELLM_API_KEY`.
3. **Deploy the Unified `ARS_LLM` Web Service**:
   - Connect the GitHub repository (`xzotic-999/ARS_LLM_by_Gemini`) and select the root `Dockerfile`.
   - Set the environment variables from Section 3 (`NODE_ENV=production`, `AUTO_MIGRATE=true`, `POSTGRES_SSL=true`, `DATABASE_URL`, `SESSION_SECRET`, `ADMIN_BOOTSTRAP_EMAIL`, `ADMIN_BOOTSTRAP_PASSWORD`, `FREELLM_API_BASE_URL`, `FREELLM_API_KEY`).
4. **Verify Health**:
   - Check `GET https://<your-app-domain>/health` -> returns `200 OK {"status":"ok"}`.
   - Open `https://<your-app-domain>/` -> loads the ARS_LLM interface and logs in with `ADMIN_BOOTSTRAP_EMAIL`.

### Deployment Path 2: Cloud VPS with Docker Compose (`infra/docker-compose.prod.yml`)
1. Provision a Linux VPS (Ubuntu 22.04/24.04) with Docker Engine and Docker Compose plugin, plus a reverse proxy (Caddy or Nginx with Let's Encrypt HTTPS).
2. Clone the repository and create `.env` from `.env.example` with production secrets and a remote `FREELLM_API_BASE_URL`.
3. Start the production stack:
   ```bash
   docker compose --env-file .env -f infra/docker-compose.prod.yml up -d --build
   ```
4. With `AUTO_MIGRATE=true` (default in `infra/docker-compose.prod.yml`), database migrations and initial administrator bootstrap run automatically on startup.

---

## 5. Limitations & Operational Cost Breakdown

### Limitations
- **Free-Tier Provider Rate Limits:** When FreeLLMAPI routes across upstream free tiers, individual upstream providers may impose burst rate limits (RPM/TPM) or temporary capacity caps. Configuring `FREELLM_FALLBACK_BASE_URL` + `FREELLM_FALLBACK_API_KEY` mitigates upstream exhaustion.
- **Session Cookie HTTPS Requirement:** In `NODE_ENV=production`, `express-session` sets `cookie.secure = true`. The production container must be accessed over HTTPS (via cloud PaaS TLS termination or Nginx/Caddy reverse proxy) with `TRUST_PROXY=true`.

### Estimated Ongoing Monthly Costs
| Component | Low-Cost / Free-Tier Cloud | Standard Corporate Production |
| :--- | :--- | :--- |
| **Unified App Container (`ars_llm`)** | **$0 – $7 / mo** (Render Starter / Fly.io / Railway) | **$7 – $20 / mo** (1–2 GB RAM dedicated container) |
| **Cloud PostgreSQL Database** | **$0 / mo** (Neon / Supabase Free Tier, 0.5 GB) | **$7 – $19 / mo** (Managed PostgreSQL with automated backups) |
| **Remote FreeLLMAPI Gateway** | **$0 – $5 / mo** (256–512 MB RAM companion container) | **$5 – $10 / mo** (Private service container) |
| **AI Token Usage** | **$0 / mo** (Aggregated provider free tiers via FreeLLMAPI) | **$0 / mo** primary + pay-as-you-go fallback if triggered |
| **Total Estimated Cost** | **$0 – $12 / month** | **$19 – $49 / month** |
