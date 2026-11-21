-- Additive, non-destructive migration for conversation archiving and soft deletion.
ALTER TABLE conversations
ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP NULL;

ALTER TABLE conversations
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_user_state
ON conversations(user_id, deleted_at, archived_at, last_message_at DESC);
