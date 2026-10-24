-- Add user_id to conversations table for ownership
ALTER TABLE conversations
ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;

-- Add last_message_at for ordering conversations
ALTER TABLE conversations
ADD COLUMN IF NOT EXISTS last_message_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

-- Add role to messages table to distinguish user vs assistant
ALTER TABLE messages
ADD COLUMN IF NOT EXISTS role VARCHAR(20) DEFAULT 'user';

-- Add index for faster conversation lookup by user
CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON conversations(user_id);

-- Add index for faster message lookup by conversation
CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);