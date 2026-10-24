// Shared TypeScript types for the ARS_LLM backend.

export type UserRole = "admin" | "employee";

export interface User {
  id: number;
  name: string;
  email: string;
  password: string;
  role: UserRole;
  is_active: boolean;
  email_verified: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface UserPublic {
  id: number;
  name: string;
  email: string;
  role: UserRole;
  is_active: boolean;
  email_verified: boolean;
  created_at: Date;
}

export interface Conversation {
  id: number;
  title: string;
  user_id: number | null;
  created_at: Date;
  last_message_at: Date;
}

export interface Message {
  id: number;
  conversation_id: number;
  user_id: number | null;
  role: "user" | "assistant" | "system";
  text: string;
  created_at: Date;
}

export interface Quota {
  id: number;
  user_id: number;
  period_type: "daily" | "monthly";
  period_start: Date;
  used: number;
  daily_limit: number | null;
  monthly_limit: number | null;
}

export interface UsageEvent {
  id: number;
  user_id: number | null;
  event_type: string;
  event_data: Record<string, unknown>;
  metadata: Record<string, unknown> | null;
  created_at: Date;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

// Express augmentation for authenticated requests.
declare global {
  namespace Express {
    interface Request {
      user?: UserPublic;
    }
  }
}

export {};