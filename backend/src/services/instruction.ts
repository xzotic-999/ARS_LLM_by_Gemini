import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { sanitizeMessagesUntrustedAttachments } from "./attachmentExtractor.js";

let cachedInstruction: string | null = null;

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export const SECURITY_REFUSAL_MESSAGE =
  "В соответствии с политикой информационной безопасности ARS LLM я не обсуждаю уязвимости, векторы и типы атак, методы обхода защитных механизмов или способы компрометации ИИ-систем и инфраструктуры — в том числе в теоретическом или ознакомительном формате.\n\nЯ готов помочь вам с решением прикладных рабочих задач: разработкой и оптимизацией кода, анализом рабочей документации, подготовкой отчётов и планированием проектов.";

const RESTRICTED_PROMPT_PATTERNS: RegExp[] = [
  // Direct or theoretical questions about attacking / vulnerabilities of ARS LLM or AI/LLM systems
  /(?:атак[а-яa-z]*|уязвимост[а-яa-z]*|взлом[а-яa-z]*|скомпрометир[а-яa-z]*|компрометац[а-яa-z]*|обойти|обход[а-яa-z]*|сломать|хакнуть)[\s\S]{0,80}(?:ars[\s_-]*llm|арс[\s_-]*ллм|ии[\s-]*систем|llm|языков[а-я]+\s+модел|нейросет|ассистент|бот|чат)/i,
  /(?:ars[\s_-]*llm|арс[\s_-]*ллм|ии[\s-]*систем[а-яa-z]*|llm|языков[а-я]+\s+модел[а-яa-z]*|нейросет[а-яa-z]*)[\s\S]{0,80}(?:подвержен[а-яa-z]*\s+атак|уязвимост|атак[а-яa-z]*|взлом[а-яa-z]*|обойти|обход|компрометац)/i,
  // Theoretical / classification of attacks on models, AI, or infrastructure
  /(?:типы|виды|категории|categories|классификаци[а-я]+|векторы|методы|способы)\s+(?:атак|уязвимост|взлома)/i,
  /(?:атак[а-яa-z]+\s+на\s+модел|model\s+attacks|атак[а-яa-z]+\s+на\s+инфраструктур|infrastructure\s+attacks|атак[а-яa-z]+\s+на\s+параметры|model\s+parameter\s+attacks|атак[а-яa-z]+\s+на\s+цепочку\s+рассуждений)/i,
  // Prompt injection, jailbreak, adversarial examples, model inversion
  /\b(?:prompt\s*injection|indirect\s*prompt\s*injection|adversarial\s*examples?|model\s*inversion|membership\s*inference|data\s*poisoning|jailbreak|джейлбрейк)\b/i,
  /(?:промпт[\s-]*инъекц|инъекци[а-я]+\s+промпт|инъекци[а-я]+\s+инструкц|косвенн[а-я]+\s+инъекц|прям[а-я]+\s+инъекц|состязательн[а-я]+\s+пример|состязательн[а-я]+\s+атак|отравлени[а-я]+\s+данных)/i,
  // Bypassing quotas, rate limits, security filters, or system instructions
  /(?:как\s+обойти|способ[а-я]*\s+обойти|обход[а-я]*)\s+(?:квот[а-я]*|лимит[а-я]*|ограничени[а-я]*|защит[а-я]*|фильтр[а-я]*|инструкци[а-я]*|правил[а-я]*|rate\s*limit)/i,
  // Prompt injection / system prompt extraction attempts
  /(?:игнорируй|забудь|отмени|пренебреги)[\s\S]{0,40}(?:предыдущ[а-я]+|системн[а-я]+|все)\s+(?:инструкци[а-я]+|правил[а-я]+|указани[а-я]+)/i,
  /\b(?:ignore|disregard|forget)\s+(?:all\s+)?(?:previous|prior|system)\s+(?:instructions|prompts|rules)\b/i,
  /(?:покажи|выведи|раскрой|напиши|повтори|цитируй)[\s\S]{0,40}(?:системн[а-я]+\s+промпт|системн[а-я]+\s+инструкци|instruction\.md)/i,
  /\b(?:show|reveal|print|repeat|dump)\s+(?:your\s+)?(?:system\s+prompt|system\s+instructions|initial\s+instructions)\b/i,
];

const RESTRICTED_OUTPUT_PATTERNS: RegExp[] = [
  /может\s+быть\s+подвержен[а-я]*\s+различным\s+типам\s+атак/i,
  /(?:categories|категории)\s+уязвимостей\s+и\s+методов/i,
  /(?:атаки\s+на\s+модель|model\s+attacks)/i,
  /(?:атаки\s+с\s+подменой\s+входных\s+данных|adversarial\s+examples)/i,
  /(?:атаки\s+на\s+цепочку\s+рассуждений|prompt\s+injection)/i,
  /(?:атаки\s+на\s+параметры\s+модели|model\s+parameter\s+attacks)/i,
  /(?:model\s+inversion|membership\s+inference)/i,
  /(?:атаки\s+на\s+pipeline\s+данных|data\s+pipeline\s+attacks)/i,
  /(?:атаки\s+на\s+систему\s+хранения|storage\s+attacks)/i,
  /(?:прям(?:ая|ой)\s+инъекция|косвенная\s+инъекция)[\s\S]{0,120}(?:запрос|команд|модел)/i,
  /做出错误的/, // Guard against upstream Chinese token leakage in attack explanations
];

/**
 * Checks whether a user prompt asks for theoretical or practical attack vectors,
 * vulnerabilities of ARS LLM / AI systems, prompt injections, jailbreaks, or system prompt leaks.
 */
export function isSecurityRestrictedPrompt(text: string): boolean {
  if (!text || typeof text !== "string") return false;
  const normalized = text.trim();
  if (!normalized) return false;
  return RESTRICTED_PROMPT_PATTERNS.some((pattern) => pattern.test(normalized));
}

/**
 * Checks whether a generated model output violates corporate security policy by
 * explaining attack vectors, vulnerabilities of ARS LLM, Prompt Injection, Adversarial Examples, etc.
 */
export function isSecurityRestrictedOutput(outputText: string): boolean {
  if (!outputText || typeof outputText !== "string") return false;
  const normalized = outputText.trim();
  if (!normalized) return false;
  return RESTRICTED_OUTPUT_PATTERNS.some((pattern) => pattern.test(normalized));
}

/**
 * Strips `<untrusted_file_content>` envelopes before checking whether the user's own prompt
 * is requesting prohibited attack instructions. Untrusted file content is sanitized separately
 * by `sanitizeMessagesUntrustedAttachments`.
 */
function stripUntrustedAttachmentBlocksForGuardrail(text: string): string {
  return text
    .replace(/<untrusted_file_content\b[^>]*>[\s\S]*?<\/untrusted_file_content>/gi, " ")
    .replace(/---\s*Содержимое файла\s+"[^"]+"\s*---[\s\S]*?---\s*Конец файла\s+"[^"]+"\s*---/g, " ")
    .trim();
}

/**
 * Evaluates a conversation history before sending to the LLM.
 * Inspects the latest user message (outside untrusted file envelopes) for restricted attack prompts.
 */
export function evaluateMessagesSecurityGuardrail(
  messages: ChatMessage[]
): { blocked: true; refusalMessage: string } | { blocked: false } {
  const userMessages = messages.filter((m) => m.role === "user");
  if (userMessages.length === 0) {
    return { blocked: false };
  }

  const latestUserMessage = userMessages[userMessages.length - 1];
  const userDirectPrompt = stripUntrustedAttachmentBlocksForGuardrail(
    latestUserMessage.content
  );
  if (isSecurityRestrictedPrompt(userDirectPrompt)) {
    return {
      blocked: true,
      refusalMessage: SECURITY_REFUSAL_MESSAGE,
    };
  }

  return { blocked: false };
}

export type ProfileSelfUpdateValidationResult =
  | {
      ok: true;
      name: string;
      personalInstructions: string;
    }
  | {
      ok: false;
      status: 400 | 403;
      error: string;
    };

/**
 * Validates a user profile self-update request (`PATCH /api/v1/auth/profile`).
 * Enforces read-only corporate email and role, non-empty name (1..120 chars),
 * and validates optional personal instructions (0..1500 chars + security guardrail).
 */
export function validateProfileSelfUpdatePayload(
  body: unknown,
  sessionUser: { email: string; role: string }
): ProfileSelfUpdateValidationResult {
  if (!body || typeof body !== "object") {
    return {
      ok: false,
      status: 400,
      error: "Некорректный формат запроса профиля.",
    };
  }

  const payload = body as Record<string, unknown>;

  if (
    payload.email !== undefined &&
    (typeof payload.email !== "string" ||
      payload.email.trim().toLowerCase() !== sessionUser.email.trim().toLowerCase())
  ) {
    return {
      ok: false,
      status: 403,
      error: "Корпоративная почта доступна только для чтения и не может быть изменена.",
    };
  }

  if (payload.role !== undefined && payload.role !== sessionUser.role) {
    return {
      ok: false,
      status: 403,
      error: "Изменение роли учётной записи запрещено.",
    };
  }

  if (
    payload.quotas !== undefined ||
    payload.daily_limit !== undefined ||
    payload.monthly_limit !== undefined ||
    payload.dailyLimit !== undefined ||
    payload.monthlyLimit !== undefined ||
    payload.used !== undefined
  ) {
    return {
      ok: false,
      status: 403,
      error: "Сотрудник не может изменять свои квоты запросов. Обратитесь к администратору.",
    };
  }

  if (typeof payload.name !== "string") {
    return {
      ok: false,
      status: 400,
      error: "Укажите имя сотрудника.",
    };
  }

  const trimmedName = payload.name.trim();
  if (trimmedName.length === 0) {
    return {
      ok: false,
      status: 400,
      error: "Имя сотрудника не может быть пустым.",
    };
  }

  if (trimmedName.length > 120) {
    return {
      ok: false,
      status: 400,
      error: "Имя сотрудника не должно превышать 120 символов.",
    };
  }

  let personalInstructions = "";
  if (payload.personalInstructions !== undefined && payload.personalInstructions !== null) {
    if (typeof payload.personalInstructions !== "string") {
      return {
        ok: false,
        status: 400,
        error: "Персональные инструкции должны быть строкой.",
      };
    }
    personalInstructions = payload.personalInstructions.trim();
    if (personalInstructions.length > 1500) {
      return {
        ok: false,
        status: 400,
        error: "Персональные инструкции не должны превышать 1500 символов.",
      };
    }
    if (isSecurityRestrictedPrompt(personalInstructions)) {
      return {
        ok: false,
        status: 400,
        error: "Персональные инструкции содержат недопустимые директивы безопасности.",
      };
    }
  }

  return {
    ok: true,
    name: trimmedName,
    personalInstructions,
  };
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
 * - Sanitizes any `<untrusted_file_content>` or attachment blocks against prompt injection.
 * - Prepends the mandatory corporate instruction as the first system message.
 * - Preserves user/assistant history in order.
 */
export function buildTrustedMessages(
  instruction: string,
  clientMessages: ChatMessage[]
): ChatMessage[] {
  const filtered = sanitizeMessagesUntrustedAttachments(
    clientMessages.filter((m) => m.role !== "system")
  );
  return [{ role: "system", content: instruction }, ...filtered];
}

export function getCachedInstruction(): string | null {
  return cachedInstruction;
}