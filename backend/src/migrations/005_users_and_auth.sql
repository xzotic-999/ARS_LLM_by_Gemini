-- Ensure roles column exists on users table (idempotent-safe)
ALTER TABLE users
ADD COLUMN IF NOT EXISTS role VARCHAR(32) DEFAULT 'employee';

ALTER TABLE users
ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;

ALTER TABLE users
ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT FALSE;

ALTER TABLE users
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

-- Session table for express-session with connect-pg-simple
CREATE TABLE IF NOT EXISTS sessions (
    sid VARCHAR NOT NULL PRIMARY KEY,
    sess JSON NOT NULL,
    expire TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS sessions_expire_idx ON sessions(expire);

-- Quota tracking per user per month/day
CREATE TABLE IF NOT EXISTS quotas (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    period_type VARCHAR(16) NOT NULL CHECK (period_type IN ('daily', 'monthly')),
    period_start DATE NOT NULL,
    used INTEGER NOT NULL DEFAULT 0,
    daily_limit INTEGER,
    monthly_limit INTEGER,
    UNIQUE (user_id, period_type, period_start)
);

CREATE INDEX IF NOT EXISTS quotas_user_period_idx ON quotas(user_id, period_type, period_start);

-- Usage events (existing table, ensure columns)
ALTER TABLE usage_events
ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE usage_events
ADD COLUMN IF NOT EXISTS metadata JSONB;