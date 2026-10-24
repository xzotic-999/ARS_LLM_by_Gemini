import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

let cachedInstruction: string | null = null;

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * Resolve the absolute path to Instruction.md relative to the module location.
 * Works in dev (backend/src/services), compiled local (backend/dist/services),
 * and inside Docker (/app/dist/services -> /app/Instruction.md).
 */
function instructionPath(): string {
  if (process.env.INSTRUCTION_PATH && existsSync(process.env.INSTRUCTION_PATH)) {
    return resolve(process.env.INSTRUCTION_PATH);
  }
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(currentDir, "../../../Instruction.md"),
    resolve(currentDir, "../../Instruction.md"),
    resolve(process.cwd(), "Instruction.md"),
    resolve(process.cwd(), "../Instruction.md"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return candidates[0];
}

/**
 * Load the corporate instruction file once at startup.
 * Throws if the file is missing or empty so the app fails fast instead of
 * silently generating without the mandatory system instructions.
 */
export function loadInstruction(): string {
  const path = instructionPath();
  let content: string;
  try {
    content = readFileSync(path, "utf-8");
  } catch (err) {
    throw new Error(
      `Failed to load mandatory Instruction.md from ${path}: ${
        err instanceof Error ? err.message : "unknown error"
      }`
    );
  }
  const trimmed = content.trim();
  if (trimmed.length === 0) {
    throw new Error(`Instruction.md is empty at ${path}`);
  }
  cachedInstruction = trimmed;
  return trimmed;
}

/**
 * Build the trusted message array for a model call.
 *
 * - Removes any client-supplied `role: "system"` messages (they are not
 *   trusted — the corporate instruction is the only system message).
 * - Prepends the mandatory corporate instruction as the first system message.
 * - Preserves user/assistant history in order.
 */
export function buildTrustedMessages(
  instruction: string,
  clientMessages: ChatMessage[]
): ChatMessage[] {
  const filtered = clientMessages.filter((m) => m.role !== "system");
  return [{ role: "system", content: instruction }, ...filtered];
}

export function getCachedInstruction(): string | null {
  return cachedInstruction;
}