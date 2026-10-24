# ARS_LLM — Security Patch: Bootstrap Admin

This security patch eliminates automatic privilege escalation during initial administrator bootstrap, enforces strict validation of bootstrap and production secrets, and expands automated unit test coverage to guarantee that existing non-admin accounts are never promoted or modified at startup.

### User Review & Critical Decisions

> [!IMPORTANT]
> All requirements in the security specification are unambiguous. No existing user account without administrator privileges will ever be promoted or altered by the bootstrap process.

- **Confirmed Decision 1 — Prevent Privilege Escalation of Existing Non-Admin Users**: If no active administrator exists and `ADMIN_BOOTSTRAP_EMAIL` matches an existing user record, bootstrap immediately throws a clear error (`[BOOTSTRAP] Cannot create bootstrap admin: a user with the configured ADMIN_BOOTSTRAP_EMAIL already exists without active admin privileges.`) without modifying the user's role, active status, or password hash.
- **Confirmed Decision 2 — Strict Removal of `promoted_existing_user`**: The return union of the bootstrap routine is restricted to `"existing_admin" | "created_admin"`, and all promotion queries and tests expecting automatic promotion are removed.

### 1. Overview & Core Concept

- **What It Does**: Hardens the backend startup administrator initialization flow and environment secret validation so that an administrator account is created only when no active administrator exists and the configured `ADMIN_BOOTSTRAP_EMAIL` does not collide with an existing user account.
- **Target Audience / Persona**: Security engineers, DevOps administrators, and backend maintainers operating `ARS_LLM` in local Docker Compose and production environments.
- **Key Value**: Prevents accidental or malicious privilege escalation if an existing standard user registers or possesses the email configured in `ADMIN_BOOTSTRAP_EMAIL`, while ensuring zero leakage of passwords, hashes, or secrets in logs and error messages.

### 2. User Experience & Visual Design

- **Key User Flows**:
  - **Existing Active Admin Flow**: When the backend starts and at least one active administrator (`role = 'admin' AND is_active = true`) exists in PostgreSQL, bootstrap returns `"existing_admin"` immediately after a single `SELECT` check without modifying any database records.
  - **Collision with Existing Non-Admin User Flow**: When no active administrator exists, if `SELECT id FROM users WHERE email = $1` finds an existing account, bootstrap aborts with a descriptive error and performs zero `UPDATE` or `INSERT` statements.
  - **Fresh Bootstrap Admin Creation Flow**: When no active administrator exists and the email is unused, bootstrap validates `ADMIN_BOOTSTRAP_EMAIL` and `ADMIN_BOOTSTRAP_PASSWORD` (rejecting empty values and `ChangeMe123!`), hashes the password with `bcrypt`, inserts the new administrator, and returns `"created_admin"`.
- **Visual Identity & Theme**:
  - *Aesthetic Direction*: Utilitarian backend security patch; no changes to the React UI, chat views, or visual theme tokens (`--background`, `--primary`, `--accent`).
  - *Console & Log Hygiene*: All startup warnings and bootstrap log messages use clean ASCII punctuation (replacing the UTF-8 em-dash `—` with `-` in the development `SESSION_SECRET` warning to prevent mojibake in Windows terminals) and never include raw passwords, password hashes, or secret tokens.

### 3. Key Product Decisions & Trade-Offs

- **Decision 1: Fail-Closed on Email Collision During Bootstrap**
  - *Chosen Approach*: Throw an explicit error if `ADMIN_BOOTSTRAP_EMAIL` already belongs to a non-admin user when no active admin exists.
  - *Why*: Automatically promoting an existing user based solely on email match creates an account-takeover / privilege-escalation vector if a standard user account was previously created with that address.
  - *Alternatives Considered*: Overwriting the user's password and promoting them was rejected because it mutates existing account state and risks destructive account overwrite.
- **Decision 2: Strict Production Secret Enforcement**
  - *Chosen Approach*: Validate `POSTGRES_PASSWORD`, `SESSION_SECRET` (minimum 32 characters, non-placeholder), `FREELLM_API_KEY`, `ADMIN_BOOTSTRAP_EMAIL`, and `ADMIN_BOOTSTRAP_PASSWORD` at startup in `production`, and forbid `ChangeMe123!` across all environments.
  - *Why*: Ensures misconfigured containers fail fast on startup before serving traffic.

### 4. Technical Architecture & Data Strategy *(Technical Reference)*

- **Architecture & Component Diagram**:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        Backend Startup Sequence                         │
└───────────────────────────────────┬─────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                  Environment Validator (validateEnvConfig)              │
│  • Checks POSTGRES_USER / POSTGRES_PASSWORD / POSTGRES_DB               │
│  • Enforces production secrets: SESSION_SECRET, FREELLM_API_KEY,        │
│    POSTGRES_PASSWORD, ADMIN_BOOTSTRAP_EMAIL, ADMIN_BOOTSTRAP_PASSWORD   │
│  • Rejects 'ChangeMe123!' in all environments                           │
│  • Emits clean ASCII warning when generating dev-only SESSION_SECRET    │
└───────────────────────────────────┬─────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│               Bootstrap Service (ensureBootstrapAdmin)                  │
│                                                                         │
│  1. SELECT id FROM users WHERE role = 'admin' AND is_active = true      │
│     ├─► Row found ──► Return "existing_admin" (0 mutations)             │
│     │                                                                   │
│  2. validateBootstrapCredentials(config)                                │
│     ├─► Missing email/password or 'ChangeMe123!' ──► Throw Error        │
│     │                                                                   │
│  3. SELECT id FROM users WHERE email = $1                               │
│     ├─► Row found ──► Throw Collision Error (0 mutations, no promotion) │
│     │                                                                   │
│  4. hashPassword(password) + INSERT INTO users (... role='admin')       │
│     └─► Return "created_admin" (never logs password or hash)            │
└─────────────────────────────────────────────────────────────────────────┘
```

- **Data Model & State**:
  - Operates on the `users` table (`id`, `name`, `email`, `password`, `role`, `is_active`, `email_verified`).
  - Return state of `ensureBootstrapAdmin`: `"existing_admin" | "created_admin"`.
- **Interactive Component & State Mapping (Unit Test Verification Suite)**:
  1. **Existing active admin**: Verifies `ensureBootstrapAdmin` returns `"existing_admin"` and executes only the single `SELECT` query without altering the user.
  2. **Existing standard user collision**: Verifies `ensureBootstrapAdmin` throws an error when `ADMIN_BOOTSTRAP_EMAIL` matches an existing user, executes no `UPDATE` or `INSERT`, and does not promote or modify the user.
  3. **Missing bootstrap password**: Verifies `ensureBootstrapAdmin` throws when `ADMIN_BOOTSTRAP_PASSWORD` is empty and performs no database write.
  4. **Insecure password `ChangeMe123!`**: Verifies both `validateEnvConfig` and `ensureBootstrapAdmin` reject `ChangeMe123!` and perform no database write.
  5. **Valid new admin creation**: Verifies `ensureBootstrapAdmin` creates the admin and returns `"created_admin"` only when valid credentials are provided and no collision exists, without leaking the password or hash in console output or error messages.
  6. **Production secret validation**: Verifies `validateEnvConfig` in `NODE_ENV=production` rejects missing or placeholder `POSTGRES_PASSWORD`, `SESSION_SECRET`, and `FREELLM_API_KEY`.
