import { randomUUID } from "node:crypto";
import { pool } from "../db/index.js";
import env from "../config/index.js";
import type { ChatMessage, Quota } from "../types.js";
import {
  buildTrustedMessages,
  evaluateMessagesSecurityGuardrail,
  isSecurityRestrictedOutput,
  SECURITY_REFUSAL_MESSAGE,
} from "./instruction.js";

export type PeriodType = "daily" | "monthly";

export interface QuotaQueryable {
  query(
    sql: string,
    params?: unknown[]
  ): Promise<{ rows: any[]; rowCount?: number | null }>;
}

export interface QuotaStatusSnapshot {
  daily: { used: number; limit: number | null };
  monthly: { used: number; limit: number | null };
}

export type QuotaExceededReason =
  | "daily_limit_exceeded"
  | "monthly_limit_exceeded";

export interface QuotaExceededErrorPayload {
  code: "QUOTA_EXCEEDED";
  reason: QuotaExceededReason;
  period: PeriodType;
  message: string;
  contact_admin: true;
  quotas: QuotaStatusSnapshot;
}

export type QuotaReservationResult =
  | {
      allowed: true;
      reservationId: string;
      userId: number;
      dailyStart: Date;
      monthlyStart: Date;
      quotas: QuotaStatusSnapshot;
      isSettled: () => boolean;
      getSettlementState: () => "pending" | "committed" | "released";
      commit: (metadata?: Record<string, unknown>) => Promise<boolean>;
      release: (
        reason: string,
        metadata?: Record<string, unknown>
      ) => Promise<boolean>;
    }
  | {
      allowed: false;
      error: QuotaExceededErrorPayload;
      quotas: QuotaStatusSnapshot;
    };

// Per-user FIFO mutex to serialize concurrent quota checks/reservations in-process
// alongside conditional SQL UPDATE guards in PostgreSQL.
const userQuotaLocks = new Map<number, Promise<unknown>>();

export async function withUserQuotaLock<T>(
  userId: number,
  fn: () => Promise<T>
): Promise<T> {
  const prev = userQuotaLocks.get(userId) ?? Promise.resolve();
  let releaseNext!: () => void;
  const currentGate = new Promise<void>((resolve) => {
    releaseNext = resolve;
  });
  const chained = prev.then(() => currentGate);
  userQuotaLocks.set(userId, chained);

  await prev;
  try {
    return await fn();
  } finally {
    releaseNext();
    if (userQuotaLocks.get(userId) === chained) {
      userQuotaLocks.delete(userId);
    }
  }
}

export function periodStart(type: PeriodType, now: Date = new Date()): Date {
  if (type === "daily") {
    return new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
    );
  }
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export function buildQuotaExceededError(
  period: PeriodType,
  quotas: QuotaStatusSnapshot
): QuotaExceededErrorPayload {
  if (period === "daily") {
    const limitLabel =
      quotas.daily.limit !== null ? `${quotas.daily.used} из ${quotas.daily.limit}` : `${quotas.daily.used}`;
    return {
      code: "QUOTA_EXCEEDED",
      reason: "daily_limit_exceeded",
      period: "daily",
      message: `Исчерпан дневной лимит запросов (${limitLabel}). Обратитесь к администратору для увеличения квоты.`,
      contact_admin: true,
      quotas,
    };
  }
  const limitLabel =
    quotas.monthly.limit !== null
      ? `${quotas.monthly.used} из ${quotas.monthly.limit}`
      : `${quotas.monthly.used}`;
  return {
    code: "QUOTA_EXCEEDED",
    reason: "monthly_limit_exceeded",
    period: "monthly",
    message: `Исчерпан месячный лимит запросов (${limitLabel}). Обратитесь к администратору для увеличения квоты.`,
    contact_admin: true,
    quotas,
  };
}

function isSameUtcDate(a: unknown, b: Date): boolean {
  if (!a) return false;
  const d = a instanceof Date ? a : new Date(String(a));
  if (Number.isNaN(d.getTime())) return false;
  return (
    d.getUTCFullYear() === b.getUTCFullYear() &&
    d.getUTCMonth() === b.getUTCMonth() &&
    d.getUTCDate() === b.getUTCDate()
  );
}

async function ensurePeriodRowsUnlocked(
  userId: number,
  dailyStart: Date,
  monthlyStart: Date,
  db: QuotaQueryable = pool,
  overrideDailyLimit?: number | null,
  overrideMonthlyLimit?: number | null
): Promise<QuotaStatusSnapshot> {
  const existingRes = await db.query(
    `SELECT period_type, period_start, used, daily_limit, monthly_limit
     FROM quotas
     WHERE user_id = $1
     ORDER BY period_start DESC, id DESC`,
    [userId]
  );

  let inheritedDailyLimit: number | null =
    overrideDailyLimit !== undefined
      ? overrideDailyLimit
      : (env.DAILY_QUOTA_DEFAULT ?? null);
  let inheritedMonthlyLimit: number | null =
    overrideMonthlyLimit !== undefined
      ? overrideMonthlyLimit
      : (env.MONTHLY_QUOTA_DEFAULT ?? null);

  let hasInheritedDaily = overrideDailyLimit !== undefined;
  let hasInheritedMonthly = overrideMonthlyLimit !== undefined;

  let currentDailyRow: {
    used: number;
    daily_limit: number | null;
    monthly_limit: number | null;
  } | null = null;
  let currentMonthlyRow: {
    used: number;
    daily_limit: number | null;
    monthly_limit: number | null;
  } | null = null;

  for (const row of existingRes.rows) {
    if (!hasInheritedDaily && row.period_type === "daily") {
      inheritedDailyLimit = row.daily_limit;
      hasInheritedDaily = true;
    }
    if (!hasInheritedMonthly && row.period_type === "monthly") {
      inheritedMonthlyLimit = row.monthly_limit;
      hasInheritedMonthly = true;
    }
    if (
      row.period_type === "daily" &&
      isSameUtcDate(row.period_start, dailyStart) &&
      !currentDailyRow
    ) {
      currentDailyRow = {
        used: Number(row.used ?? 0),
        daily_limit: row.daily_limit,
        monthly_limit: row.monthly_limit,
      };
    }
    if (
      row.period_type === "monthly" &&
      isSameUtcDate(row.period_start, monthlyStart) &&
      !currentMonthlyRow
    ) {
      currentMonthlyRow = {
        used: Number(row.used ?? 0),
        daily_limit: row.daily_limit,
        monthly_limit: row.monthly_limit,
      };
    }
  }

  if (!currentDailyRow) {
    const insDaily = await db.query(
      `INSERT INTO quotas (user_id, period_type, period_start, daily_limit, monthly_limit, used)
       VALUES ($1, 'daily', $2, $3, $4, 0)
       ON CONFLICT (user_id, period_type, period_start)
       DO UPDATE SET user_id = EXCLUDED.user_id
       RETURNING used, daily_limit, monthly_limit`,
      [userId, dailyStart, inheritedDailyLimit, inheritedMonthlyLimit]
    );
    const r = insDaily.rows[0];
    currentDailyRow = {
      used: Number(r?.used ?? 0),
      daily_limit: r ? r.daily_limit : inheritedDailyLimit,
      monthly_limit: r ? r.monthly_limit : inheritedMonthlyLimit,
    };
  }

  if (!currentMonthlyRow) {
    const insMonthly = await db.query(
      `INSERT INTO quotas (user_id, period_type, period_start, daily_limit, monthly_limit, used)
       VALUES ($1, 'monthly', $2, $3, $4, 0)
       ON CONFLICT (user_id, period_type, period_start)
       DO UPDATE SET user_id = EXCLUDED.user_id
       RETURNING used, daily_limit, monthly_limit`,
      [userId, monthlyStart, inheritedDailyLimit, inheritedMonthlyLimit]
    );
    const r = insMonthly.rows[0];
    currentMonthlyRow = {
      used: Number(r?.used ?? 0),
      daily_limit: r ? r.daily_limit : inheritedDailyLimit,
      monthly_limit: r ? r.monthly_limit : inheritedMonthlyLimit,
    };
  }

  return {
    daily: {
      used: currentDailyRow.used,
      limit: currentDailyRow.daily_limit,
    },
    monthly: {
      used: currentMonthlyRow.used,
      limit: currentMonthlyRow.monthly_limit,
    },
  };
}

export async function getQuota(
  userId: number,
  type: PeriodType,
  dailyLimit: number | null,
  monthlyLimit: number | null,
  db: QuotaQueryable = pool,
  now: Date = new Date()
): Promise<Quota> {
  const start = periodStart(type, now);
  const existing = await db.query(
    "SELECT * FROM quotas WHERE user_id = $1 AND period_type = $2 AND period_start = $3",
    [userId, type, start]
  );

  if (existing.rows.length > 0) {
    return existing.rows[0] as Quota;
  }

  const result = await db.query(
    `INSERT INTO quotas (user_id, period_type, period_start, daily_limit, monthly_limit, used)
     VALUES ($1, $2, $3, $4, $5, 0)
     RETURNING *`,
    [userId, type, start, dailyLimit, monthlyLimit]
  );

  return result.rows[0] as Quota;
}

/**
 * Atomically checks and reserves 1 unit for a single period (`daily` or `monthly`).
 * Does NOT increment `used` if `used >= limit` (including when `limit === 0`).
 */
export async function reserveQuota(
  userId: number,
  type: PeriodType,
  dailyLimit: number | null,
  monthlyLimit: number | null,
  db: QuotaQueryable = pool,
  now: Date = new Date()
): Promise<boolean> {
  return withUserQuotaLock(userId, async () => {
    const start = periodStart(type, now);
    await getQuota(userId, type, dailyLimit, monthlyLimit, db, now);

    const limitColumn = type === "daily" ? "daily_limit" : "monthly_limit";
    const updateRes = await db.query(
      `UPDATE quotas
       SET used = quotas.used + 1
       WHERE user_id = $1
         AND period_type = $2
         AND period_start = $3
         AND (${limitColumn} IS NULL OR quotas.used < ${limitColumn})
       RETURNING used, daily_limit, monthly_limit`,
      [userId, type, start]
    );

    return updateRes.rows.length > 0;
  });
}

export async function releaseQuota(
  userId: number,
  type: PeriodType,
  db: QuotaQueryable = pool,
  now: Date = new Date()
): Promise<void> {
  await withUserQuotaLock(userId, async () => {
    const start = periodStart(type, now);
    await db.query(
      `UPDATE quotas
       SET used = CASE WHEN quotas.used > 0 THEN quotas.used - 1 ELSE 0 END
       WHERE user_id = $1 AND period_type = $2 AND period_start = $3`,
      [userId, type, start]
    );
  });
}

export async function checkQuota(
  userId: number,
  type: PeriodType,
  dailyLimit: number | null,
  monthlyLimit: number | null,
  db: QuotaQueryable = pool,
  now: Date = new Date()
): Promise<{ allowed: boolean; used: number; limit: number | null }> {
  const start = periodStart(type, now);
  const result = await db.query(
    `SELECT used, daily_limit, monthly_limit
     FROM quotas
     WHERE user_id = $1 AND period_type = $2 AND period_start = $3`,
    [userId, type, start]
  );

  if (result.rows.length === 0) {
    const effectiveDefault = type === "daily" ? dailyLimit : monthlyLimit;
    return {
      allowed: effectiveDefault === null || effectiveDefault > 0,
      used: 0,
      limit: effectiveDefault,
    };
  }

  const row = result.rows[0] as {
    used: number;
    daily_limit: number | null;
    monthly_limit: number | null;
  };

  const effectiveLimit = type === "daily" ? row.daily_limit : row.monthly_limit;
  if (effectiveLimit === null) {
    return { allowed: true, used: Number(row.used), limit: null };
  }
  return {
    allowed: Number(row.used) < effectiveLimit,
    used: Number(row.used),
    limit: effectiveLimit,
  };
}

export async function recordUsage(
  userId: number,
  eventType: string,
  metadata: Record<string, unknown> = {},
  db: QuotaQueryable = pool
): Promise<void> {
  const serialized = JSON.stringify(metadata);
  await db.query(
    `INSERT INTO usage_events (user_id, event_type, event_data, metadata)
     VALUES ($1, $2, $3, $4)`,
    [userId, eventType, serialized, serialized]
  );
}

/**
 * Atomically checks and reserves 1 request across BOTH `daily` and `monthly` quotas
 * before calling the LLM provider.
 *
 * - If either `daily` or `monthly` quota is exhausted (`used >= limit`, including `limit === 0`),
 *   NEITHER period is incremented, a `quota_exceeded` event is recorded, and `allowed: false`
 *   with a structured `QuotaExceededErrorPayload` is returned.
 * - If allowed, both periods are atomically incremented by 1 and an idempotent reservation
 *   handle (`commit` / `release`) is returned so provider errors, timeouts, or client
 *   cancellations safely release the reserved unit without double-charging or leaking.
 */
export async function acquireQuotaReservation(
  userId: number,
  db: QuotaQueryable = pool,
  now: Date = new Date()
): Promise<QuotaReservationResult> {
  return withUserQuotaLock(userId, async () => {
    const dailyStart = periodStart("daily", now);
    const monthlyStart = periodStart("monthly", now);

    const current = await ensurePeriodRowsUnlocked(
      userId,
      dailyStart,
      monthlyStart,
      db
    );

    if (
      current.daily.limit !== null &&
      current.daily.used >= current.daily.limit
    ) {
      const errorPayload = buildQuotaExceededError("daily", current);
      await recordUsage(
        userId,
        "quota_exceeded",
        {
          reason: errorPayload.reason,
          period: "daily",
          daily_used: current.daily.used,
          daily_limit: current.daily.limit,
          monthly_used: current.monthly.used,
          monthly_limit: current.monthly.limit,
        },
        db
      );
      return {
        allowed: false,
        error: errorPayload,
        quotas: current,
      };
    }

    if (
      current.monthly.limit !== null &&
      current.monthly.used >= current.monthly.limit
    ) {
      const errorPayload = buildQuotaExceededError("monthly", current);
      await recordUsage(
        userId,
        "quota_exceeded",
        {
          reason: errorPayload.reason,
          period: "monthly",
          daily_used: current.daily.used,
          daily_limit: current.daily.limit,
          monthly_used: current.monthly.used,
          monthly_limit: current.monthly.limit,
        },
        db
      );
      return {
        allowed: false,
        error: errorPayload,
        quotas: current,
      };
    }

    // Conditional atomic increment on daily row
    const dailyUpdate = await db.query(
      `UPDATE quotas
       SET used = quotas.used + 1
       WHERE user_id = $1
         AND period_type = 'daily'
         AND period_start = $2
         AND (daily_limit IS NULL OR quotas.used < daily_limit)
       RETURNING used, daily_limit`,
      [userId, dailyStart]
    );

    if (dailyUpdate.rows.length === 0) {
      const refreshed = await ensurePeriodRowsUnlocked(
        userId,
        dailyStart,
        monthlyStart,
        db
      );
      const errorPayload = buildQuotaExceededError("daily", refreshed);
      await recordUsage(
        userId,
        "quota_exceeded",
        { reason: errorPayload.reason, period: "daily" },
        db
      );
      return {
        allowed: false,
        error: errorPayload,
        quotas: refreshed,
      };
    }

    // Conditional atomic increment on monthly row
    const monthlyUpdate = await db.query(
      `UPDATE quotas
       SET used = quotas.used + 1
       WHERE user_id = $1
         AND period_type = 'monthly'
         AND period_start = $2
         AND (monthly_limit IS NULL OR quotas.used < monthly_limit)
       RETURNING used, monthly_limit`,
      [userId, monthlyStart]
    );

    if (monthlyUpdate.rows.length === 0) {
      // Roll back the daily increment so daily reservation never leaks when monthly fails
      await db.query(
        `UPDATE quotas
         SET used = CASE WHEN quotas.used > 0 THEN quotas.used - 1 ELSE 0 END
         WHERE user_id = $1 AND period_type = 'daily' AND period_start = $2`,
        [userId, dailyStart]
      );
      const refreshed = await ensurePeriodRowsUnlocked(
        userId,
        dailyStart,
        monthlyStart,
        db
      );
      const errorPayload = buildQuotaExceededError("monthly", refreshed);
      await recordUsage(
        userId,
        "quota_exceeded",
        { reason: errorPayload.reason, period: "monthly" },
        db
      );
      return {
        allowed: false,
        error: errorPayload,
        quotas: refreshed,
      };
    }

    const reservedQuotas: QuotaStatusSnapshot = {
      daily: {
        used: Number(dailyUpdate.rows[0].used),
        limit: dailyUpdate.rows[0].daily_limit,
      },
      monthly: {
        used: Number(monthlyUpdate.rows[0].used),
        limit: monthlyUpdate.rows[0].monthly_limit,
      },
    };

    const reservationId = randomUUID();
    let settlementState: "pending" | "committed" | "released" = "pending";

    return {
      allowed: true,
      reservationId,
      userId,
      dailyStart,
      monthlyStart,
      quotas: reservedQuotas,
      isSettled: () => settlementState !== "pending",
      getSettlementState: () => settlementState,
      commit: async (metadata: Record<string, unknown> = {}) => {
        if (settlementState !== "pending") {
          return false;
        }
        settlementState = "committed";
        await recordUsage(
          userId,
          "model_call",
          {
            reservation_id: reservationId,
            ...metadata,
          },
          db
        );
        return true;
      },
      release: async (
        reason: string,
        metadata: Record<string, unknown> = {}
      ) => {
        if (settlementState !== "pending") {
          return false;
        }
        settlementState = "released";
        await withUserQuotaLock(userId, async () => {
          await db.query(
            `UPDATE quotas
             SET used = CASE WHEN quotas.used > 0 THEN quotas.used - 1 ELSE 0 END
             WHERE user_id = $1
               AND (
                 (period_type = 'daily' AND period_start = $2)
                 OR (period_type = 'monthly' AND period_start = $3)
               )`,
            [userId, dailyStart, monthlyStart]
          );
          await recordUsage(
            userId,
            "quota_released",
            {
              reservation_id: reservationId,
              reason,
              ...metadata,
            },
            db
          );
        });
        return true;
      },
    };
  });
}

export async function getUserQuotaStatus(
  userId: number,
  db: QuotaQueryable = pool,
  now: Date = new Date()
): Promise<QuotaStatusSnapshot> {
  return withUserQuotaLock(userId, async () => {
    const dailyStart = periodStart("daily", now);
    const monthlyStart = periodStart("monthly", now);
    return ensurePeriodRowsUnlocked(userId, dailyStart, monthlyStart, db);
  });
}

export async function getUserQuotaLimits(
  userId: number,
  db: QuotaQueryable = pool,
  now: Date = new Date()
): Promise<QuotaStatusSnapshot> {
  const status = await getUserQuotaStatus(userId, db, now);
  return {
    daily: { used: status.daily.used, limit: status.daily.limit },
    monthly: { used: status.monthly.used, limit: status.monthly.limit },
  };
}

export async function setUserQuotaLimits(
  userId: number,
  dailyLimit: number | null,
  monthlyLimit: number | null,
  db: QuotaQueryable = pool,
  now: Date = new Date()
): Promise<void> {
  await withUserQuotaLock(userId, async () => {
    const dailyStart = periodStart("daily", now);
    const monthlyStart = periodStart("monthly", now);

    await db.query(
      `INSERT INTO quotas (user_id, period_type, period_start, daily_limit, monthly_limit, used)
       VALUES ($1, 'daily', $2, $3, $4, 0)
       ON CONFLICT (user_id, period_type, period_start)
       DO UPDATE SET daily_limit = $3, monthly_limit = $4`,
      [userId, dailyStart, dailyLimit, monthlyLimit]
    );

    await db.query(
      `INSERT INTO quotas (user_id, period_type, period_start, daily_limit, monthly_limit, used)
       VALUES ($1, 'monthly', $2, $3, $4, 0)
       ON CONFLICT (user_id, period_type, period_start)
       DO UPDATE SET daily_limit = $3, monthly_limit = $4`,
      [userId, monthlyStart, dailyLimit, monthlyLimit]
    );
  });
}

export type QuotaAdminUpdateResult =
  | {
      ok: true;
      userId: number;
      quotas: QuotaStatusSnapshot;
    }
  | {
      ok: false;
      status: 400 | 401 | 403;
      error: {
        code: "UNAUTHORIZED" | "FORBIDDEN" | "VALIDATION_ERROR";
        message: string;
      };
    };

/**
 * Server-side role-enforced quota limit update.
 * Only an authenticated administrator (`actor.role === 'admin'`) may modify user limits;
 * employees/users attempting to change their own or another user's limits receive 403 FORBIDDEN.
 */
export async function setUserQuotaLimitsForActor(
  actor: { id: number; role: string } | null | undefined,
  targetUserId: number,
  dailyLimit: unknown,
  monthlyLimit: unknown,
  db: QuotaQueryable = pool,
  now: Date = new Date()
): Promise<QuotaAdminUpdateResult> {
  if (!actor) {
    return {
      ok: false,
      status: 401,
      error: {
        code: "UNAUTHORIZED",
        message: "Требуется вход в систему.",
      },
    };
  }

  if (actor.role !== "admin") {
    return {
      ok: false,
      status: 403,
      error: {
        code: "FORBIDDEN",
        message:
          "Недостаточно прав. Сотрудник не может изменять квоты запросов — обратитесь к администратору.",
      },
    };
  }

  if (!Number.isInteger(targetUserId) || targetUserId <= 0) {
    return {
      ok: false,
      status: 400,
      error: {
        code: "VALIDATION_ERROR",
        message: "Некорректный идентификатор пользователя.",
      },
    };
  }

  if (
    dailyLimit !== null &&
    (typeof dailyLimit !== "number" ||
      !Number.isInteger(dailyLimit) ||
      dailyLimit < 0 ||
      dailyLimit > 1_000_000)
  ) {
    return {
      ok: false,
      status: 400,
      error: {
        code: "VALIDATION_ERROR",
        message: "Дневной лимит должен быть целым неотрицательным числом или null.",
      },
    };
  }

  if (
    monthlyLimit !== null &&
    (typeof monthlyLimit !== "number" ||
      !Number.isInteger(monthlyLimit) ||
      monthlyLimit < 0 ||
      monthlyLimit > 1_000_000)
  ) {
    return {
      ok: false,
      status: 400,
      error: {
        code: "VALIDATION_ERROR",
        message: "Месячный лимит должен быть целым неотрицательным числом или null.",
      },
    };
  }

  if (
    typeof dailyLimit === "number" &&
    typeof monthlyLimit === "number" &&
    monthlyLimit < dailyLimit
  ) {
    return {
      ok: false,
      status: 400,
      error: {
        code: "VALIDATION_ERROR",
        message: "Месячный лимит не может быть меньше дневного лимита.",
      },
    };
  }

  await setUserQuotaLimits(targetUserId, dailyLimit, monthlyLimit, db, now);
  await recordUsage(
    actor.id,
    "quota_limits_updated",
    {
      target_user_id: targetUserId,
      daily_limit: dailyLimit,
      monthly_limit: monthlyLimit,
    },
    db
  );
  const quotas = await getUserQuotaStatus(targetUserId, db, now);

  return {
    ok: true,
    userId: targetUserId,
    quotas,
  };
}

export interface ExecuteQuotaProtectedCompletionOptions {
  userId: number;
  messages: ChatMessage[];
  instruction: string;
  stream?: boolean;
  signal?: AbortSignal;
  db?: QuotaQueryable;
  now?: Date;
  unaryCall: (
    trustedMessages: ChatMessage[],
    signal?: AbortSignal
  ) => Promise<string>;
  streamCall?: (
    trustedMessages: ChatMessage[],
    signal?: AbortSignal
  ) => AsyncIterable<string>;
  onStreamToken?: (token: string) => void;
}

export type ExecuteQuotaProtectedCompletionResult =
  | {
      ok: true;
      status: 200;
      content: string;
      quotas: QuotaStatusSnapshot;
      guardrailRefusal: boolean;
    }
  | {
      ok: false;
      status: 429 | 499 | 502 | 504;
      error:
        | QuotaExceededErrorPayload
        | {
            code: "CLIENT_CANCELLED" | "PROVIDER_TIMEOUT" | "PROVIDER_ERROR";
            message: string;
          };
      quotas: QuotaStatusSnapshot;
    };

function isAbortError(err: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return (
    err.name === "AbortError" ||
    msg.includes("request aborted") ||
    msg.includes("client_cancelled") ||
    msg.includes("aborted by user")
  );
}

function isTimeoutError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return (
    err.name === "TimeoutError" ||
    msg.includes("timed out") ||
    msg.includes("timeout")
  );
}

/**
 * Executes a model completion with atomic pre-call quota reservation and
 * guaranteed release on provider error, timeout, or cancellation.
 * When quota is exhausted, `unaryCall` / `streamCall` is NEVER invoked.
 */
export async function executeQuotaProtectedCompletion(
  options: ExecuteQuotaProtectedCompletionOptions
): Promise<ExecuteQuotaProtectedCompletionResult> {
  const {
    userId,
    messages,
    instruction,
    stream = false,
    signal,
    db = pool,
    now = new Date(),
    unaryCall,
    streamCall,
    onStreamToken,
  } = options;

  // 1. Atomically check and reserve quota BEFORE calling the LLM provider
  const reservation = await acquireQuotaReservation(userId, db, now);
  if (!reservation.allowed) {
    return {
      ok: false,
      status: 429,
      error: reservation.error,
      quotas: reservation.quotas,
    };
  }

  try {
    // 2. If already cancelled before calling the provider, release immediately
    if (signal?.aborted) {
      await reservation.release("client_cancelled");
      const currentQuotas = await getUserQuotaStatus(userId, db, now);
      return {
        ok: false,
        status: 499,
        error: {
          code: "CLIENT_CANCELLED",
          message: "Генерация ответа была отменена пользователем.",
        },
        quotas: currentQuotas,
      };
    }

    // 3. Security guardrail check on prompt
    const guardrail = evaluateMessagesSecurityGuardrail(messages);
    if (guardrail.blocked) {
      await reservation.commit({
        mode: stream ? "stream" : "unary",
        guardrail_blocked: true,
        message_count: messages.length,
      });
      if (stream && onStreamToken) {
        onStreamToken(guardrail.refusalMessage);
      }
      return {
        ok: true,
        status: 200,
        content: guardrail.refusalMessage,
        quotas: reservation.quotas,
        guardrailRefusal: true,
      };
    }

    const trustedMessages = buildTrustedMessages(instruction, messages);

    // 4. Execute streaming or unary provider call
    if (stream && streamCall) {
      let accumulated = "";
      let inspectionBuffer = "";
      let bufferFlushed = false;

      for await (const token of streamCall(trustedMessages, signal)) {
        if (signal?.aborted) {
          throw new Error("Request aborted");
        }
        accumulated += token;

        if (!bufferFlushed) {
          inspectionBuffer += token;
          if (isSecurityRestrictedOutput(inspectionBuffer)) {
            accumulated = SECURITY_REFUSAL_MESSAGE;
            bufferFlushed = true;
            inspectionBuffer = "";
            onStreamToken?.(SECURITY_REFUSAL_MESSAGE);
            break;
          }
          if (inspectionBuffer.length >= 260) {
            bufferFlushed = true;
            onStreamToken?.(inspectionBuffer);
            inspectionBuffer = "";
          }
          continue;
        }

        onStreamToken?.(token);
      }

      if (signal?.aborted) {
        throw new Error("Request aborted");
      }

      if (!bufferFlushed && inspectionBuffer.length > 0) {
        const safeOut = isSecurityRestrictedOutput(inspectionBuffer)
          ? SECURITY_REFUSAL_MESSAGE
          : inspectionBuffer;
        accumulated = safeOut;
        onStreamToken?.(safeOut);
      }

      if (!accumulated.trim()) {
        throw new Error("FreeLLMAPI returned an empty stream response");
      }

      await reservation.commit({
        mode: "stream",
        message_count: messages.length,
        reply_length: accumulated.length,
      });

      const finalQuotas = await getUserQuotaStatus(userId, db, now);
      return {
        ok: true,
        status: 200,
        content: accumulated,
        quotas: finalQuotas,
        guardrailRefusal: false,
      };
    }

    const rawReply = await unaryCall(trustedMessages, signal);
    if (signal?.aborted) {
      throw new Error("Request aborted");
    }

    if (!rawReply || !rawReply.trim()) {
      throw new Error("FreeLLMAPI returned an empty response");
    }

    const safeReply = isSecurityRestrictedOutput(rawReply)
      ? SECURITY_REFUSAL_MESSAGE
      : rawReply;

    await reservation.commit({
      mode: "unary",
      message_count: messages.length,
      reply_length: safeReply.length,
    });

    const finalQuotas = await getUserQuotaStatus(userId, db, now);
    return {
      ok: true,
      status: 200,
      content: safeReply,
      quotas: finalQuotas,
      guardrailRefusal: false,
    };
  } catch (err) {
    const cancelled = isAbortError(err, signal);
    const timedOut = !cancelled && isTimeoutError(err);
    const releaseReason = cancelled
      ? "client_cancelled"
      : timedOut
        ? "provider_timeout"
        : "provider_error";

    await reservation.release(releaseReason, {
      error: err instanceof Error ? err.message : String(err),
    });

    const currentQuotas = await getUserQuotaStatus(userId, db, now);

    if (cancelled) {
      return {
        ok: false,
        status: 499,
        error: {
          code: "CLIENT_CANCELLED",
          message: "Генерация ответа была отменена пользователем.",
        },
        quotas: currentQuotas,
      };
    }

    if (timedOut) {
      return {
        ok: false,
        status: 504,
        error: {
          code: "PROVIDER_TIMEOUT",
          message: "Превышено время ожидания ответа от ИИ-провайдера.",
        },
        quotas: currentQuotas,
      };
    }

    return {
      ok: false,
      status: 502,
      error: {
        code: "PROVIDER_ERROR",
        message:
          err instanceof Error && err.message
            ? err.message
            : "Ошибка генерации ответа от ИИ-провайдера.",
      },
      quotas: currentQuotas,
    };
  } finally {
    if (!reservation.isSettled()) {
      await reservation.release("unexpected_exit");
    }
  }
}