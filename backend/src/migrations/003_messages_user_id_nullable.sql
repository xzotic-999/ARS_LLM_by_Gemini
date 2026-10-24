-- Allow messages to be created without a known user (no auth yet).
ALTER TABLE messages
ALTER COLUMN user_id DROP NOT NULL;