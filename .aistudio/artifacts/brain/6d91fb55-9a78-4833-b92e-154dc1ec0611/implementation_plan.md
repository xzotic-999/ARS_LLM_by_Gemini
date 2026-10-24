# ARS_LLM — Cloud Backend to FreeLLMAPI Dev Tunnel Integration & Verification Plan

This plan presents the results of the architectural audit of the ARS_LLM chat pipeline and defines a minimal, non-disruptive implementation to configure and verify live connectivity from the cloud backend to the FreeLLMAPI instance exposed via VS Code Dev Tunnel (`https://v7skvft7-31415.euw.devtunnels.ms/v1`) while keeping the approved UI 100% unchanged.

### User Review & Critical Decisions

> [!IMPORTANT]
> **Audit Results (Verified Against Current Repository State)**
> 1. **End-to-End Chat Request Path**:
>    - **Client SPA**: Sends authenticated chat requests via `POST /api/v1/chat/completions` (`credentials: "include"`, `stream: true`) with an array of `{ role, content }` messages.
>    - **Backend Chat Router**: Authenticates the session cookie, validates message bounds (1–100 messages, last role must be `"user"`), reserves PostgreSQL user quota, logs a privacy-preserving `model_call` metric (`message_count` and `last_message_length` only—never message contents), strips any client-supplied `system` messages, prepends the corporate system prompt (`Instruction.md`), and invokes the FreeLLM service.
>    - **FreeLLM Service**: Calls `${FREELLM_API_BASE_URL.replace(/\/+$/, "")}/chat/completions` using `POST` and relays SSE token chunks (`data: {"choices":[{"delta":{"content":"..."}}]}` and `data: [DONE]`) back to the client.
> 2. **Server-Side Secret Isolation**:
>    - `FREELLM_API_BASE_URL`, `FREELLM_API_KEY`, and `FREELLM_MODEL` are read exclusively by the Node.js backend from `process.env`.
>    - None of these variables use the `VITE_` prefix, and `vite.config.ts` does not inject them into the client bundle. Neither the API key nor private chat prompts/completions are written to application logs.
> 3. **OpenAI-Compatible API & SSE Compatibility**:
>    - **Endpoint**: Normalizes base URL (`https://v7skvft7-31415.euw.devtunnels.ms/v1`) and appends `/chat/completions` (`https://v7skvft7-31415.euw.devtunnels.ms/v1/chat/completions`).
>    - **Authorization**: Sends `Authorization: Bearer <FREELLM_API_KEY>` when `FREELLM_API_KEY` is configured.
>    - **Payload & Streaming**: Sends `{ model: "auto", messages: [...], stream: true }` (or `stream: false` for synchronous calls) and parses standard OpenAI SSE `data:` frames line-by-line, handling chunk boundaries and `[DONE]`.

- **Confirmed Cloud Environment Parameters**:
  - `FREELLM_API_BASE_URL=https://v7skvft7-31415.euw.devtunnels.ms/v1`
  - `FREELLM_MODEL=auto`
  - `FREELLM_API_KEY` provided strictly as a server-side environment secret (never logged or committed).
- **UI Preservation Commitment**: Zero changes to any frontend visual components, layout, styling, colors, or chat interface.

---

### 1. Overview & Core Concept

- **What It Does**: Configures the cloud-hosted ARS_LLM backend to route OpenAI-compatible model catalog checks (`GET /v1/models`) and chat completions (`POST /v1/chat/completions`) through the HTTPS VS Code Dev Tunnel endpoint (`https://v7skvft7-31415.euw.devtunnels.ms/v1`) using `FREELLM_MODEL=auto` and a server-side Bearer API key, accompanied by a safe diagnostic utility that tests both `/v1/models` and a short `/v1/chat/completions` generation request without exposing secrets or logging private conversations.
- **Target Audience / Persona**: System administrators and developers operating the cloud-hosted ARS_LLM backend connected to the remote FreeLLMAPI gateway.
- **Key Value**: Enables real end-to-end AI responses from the cloud environment to the user's FreeLLMAPI server while providing transparent, verifiable diagnostics if the Dev Tunnel port visibility, anti-phishing interstitial, or missing secret blocks cloud requests.

---

### 2. User Experience & Visual Design

- **Key User Flows**:
  - **Existing UI 100% Preserved**: The web interface, sidebar, chat view, message bubbles, authentication screens, and admin dashboard remain completely untouched.
  - **Server-Side Verification Flow**: Administrators or the deployment pipeline can execute a non-interactive server-side check that:
    1. Verifies whether `FREELLM_API_KEY` is present in the server environment (reporting only boolean presence, never the value).
    2. Requests `GET https://v7skvft7-31415.euw.devtunnels.ms/v1/models` with `Authorization: Bearer <FREELLM_API_KEY>` and reports HTTP status, latency, and the count of available models.
    3. Executes a minimal test generation via `POST https://v7skvft7-31415.euw.devtunnels.ms/v1/chat/completions` (`model: "auto"`, short system verification ping) and reports HTTP status, latency, and whether a valid assistant completion was returned.
    4. Detects and clearly explains VS Code Dev Tunnel-specific errors if encountered (such as HTTP `401`/`403` tunnel access token requirements when a tunnel port is set to Private instead of Public, HTTP `302` redirect to GitHub/Microsoft login, or HTML anti-phishing interstitial responses when `X-Tunnel-Skip-AntiPhishing-Page: true` is required).

---

### 3. Key Product Decisions & Trade-Offs

- **Decision 1: Safe Cloud Environment Defaults + Secret Injection**
  - *Chosen Approach*: Set `FREELLM_API_BASE_URL="https://v7skvft7-31415.euw.devtunnels.ms/v1"` and `FREELLM_MODEL="auto"` in the environment configuration template and cloud runtime defaults while reading `FREELLM_API_KEY` strictly from the environment secret store.
  - *Why*: Eliminates any dependency on `127.0.0.1:31415` or `host.docker.internal` in cloud execution while keeping the API key out of source control and logs.
  - *Alternatives Considered*: Hardcoding fallback keys or exposing provider URLs in frontend settings (rejected due to strict security and UI preservation rules).
- **Decision 2: Dev Tunnel Anti-Phishing Header Support & Transparent Diagnostics**
  - *Chosen Approach*: Include standard non-auth request headers (`Accept: application/json`, and `X-Tunnel-Skip-AntiPhishing-Page: true` which allows programmatic API clients to bypass the HTML warning page on public VS Code Dev Tunnels without bypassing authentication) and inspect `Content-Type` so HTML tunnel login/interstitial responses are reported clearly rather than causing opaque JSON parse errors.
  - *Why*: VS Code Dev Tunnels often return an HTML interstitial page on first non-browser request unless `X-Tunnel-Skip-AntiPhishing-Page: true` is sent, and return a `302`/`401` if the tunnel port is private. Handling this cleanly ensures accurate diagnostics without weakening security.
  - *Alternatives Considered*: Ignoring response content types (rejected because HTML interstitials would surface as confusing JSON syntax errors).

---

### 4. Technical Architecture & Data Strategy *(Technical Reference)*

- **Architecture & Component Diagram**:
```
┌──────────────────────────────────────────────────────────────────────────┐
│                        Browser Client (Unchanged SPA)                    │
│        POST /api/v1/chat/completions (Session Cookie, No API Key)        │
└────────────────────────────────────┬─────────────────────────────────────┘
                                     │
                                     ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                      Cloud ARS_LLM Backend (Node.js)                     │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │ Auth & Quota Guard -> Prepends Corporate Instruction.md            │  │
│  │ (Strips client system prompts; logs metadata only, never content)  │  │
│  └─────────────────────────────────┬──────────────────────────────────┘  │
│                                    │                                     │
│                                    ▼                                     │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │ FreeLLM Client & Diagnostic Probe                                  │  │
│  │ • FREELLM_API_BASE_URL: https://v7skvft7-31415.euw.devtunnels.ms/v1│  │
│  │ • FREELLM_MODEL: auto                                              │  │
│  │ • Authorization: Bearer <FREELLM_API_KEY> (Server-Side Secret)     │  │
│  │ • X-Tunnel-Skip-AntiPhishing-Page: true                            │  │
│  └─────────────────────────────────┬──────────────────────────────────┘  │
└────────────────────────────────────┼─────────────────────────────────────┘
                                     │ HTTPS (TLS)
                                     ▼
┌──────────────────────────────────────────────────────────────────────────┐
│        VS Code Dev Tunnel (v7skvft7-31415.euw.devtunnels.ms/v1)          │
│     Forwards to Windows Host FreeLLMAPI (127.0.0.1:31415)                │
│     • GET  /v1/models           -> Model catalog (109 models)            │
│     • POST /v1/chat/completions -> OpenAI JSON / SSE Stream              │
└──────────────────────────────────────────────────────────────────────────┘
```

- **Data Model & State**:
  - **Environment Configuration**:
    - `FREELLM_API_BASE_URL`: Defaults to `https://v7skvft7-31415.euw.devtunnels.ms/v1` when not overridden.
    - `FREELLM_MODEL`: `auto`.
    - `FREELLM_API_KEY`: Secret string read from `process.env.FREELLM_API_KEY` (required in production and validated before live requests; never printed in logs or returned in responses).
  - **Verification Result Contract**:
    - Structured diagnostic report containing `baseUrl`, `model`, `apiKeyConfigured` (boolean), `modelsCheck` (`ok`, `status`, `modelCount`, `latencyMs`, `error`), and `completionCheck` (`ok`, `status`, `replyPreviewLength`, `latencyMs`, `error`).

- **Interactive Component & State Mapping**:
  - **FreeLLM Client Request Handler**:
    - Appends `/models` or `/chat/completions` to normalized `FREELLM_API_BASE_URL`.
    - Attaches `Authorization: Bearer ${env.FREELLM_API_KEY}` and `X-Tunnel-Skip-AntiPhishing-Page: true`.
    - Detects non-JSON / HTML tunnel responses or `401`/`403` statuses and produces a clear diagnostic message indicating whether the failure is due to a missing `FREELLM_API_KEY`, an invalid Bearer token, or VS Code Dev Tunnel port visibility/authentication restrictions.
  - **Server-Side Connectivity & Generation Probe**:
    - Runs from the cloud backend environment against `https://v7skvft7-31415.euw.devtunnels.ms/v1/models` and `/v1/chat/completions` (`model: "auto"`, short verification message) and outputs sanitized diagnostic results with zero secret exposure.
