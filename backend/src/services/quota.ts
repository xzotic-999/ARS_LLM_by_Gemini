import { pool } from "../db/index.js";
import env from "../config/index.js";
import type { Quota } from "../types.js";

type PeriodType = "daily" | "monthly";

export function periodStart(type: PeriodType, now: Date = new Date()): Date {
  if (type === "daily") {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  }
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export async function getQuota(
  userId: number,
  type: PeriodType,
  dailyLimit: number | null,
  monthlyLimit: number | null
): Promise<Quota> {
  const start = periodStart(type);
  const existing = await pool.query(
    "SELECT * FROM quotas WHERE user_id = $1 AND period_type = $2 AND period_start = $3",
    [userId, type, start]
  );

  if (existing.rows.length > 0) {
    return existing.rows[0] as Quota;
  }

  const result = await pool.query(
    `INSERT INTO quotas (user_id, period_type, period_start, daily_limit, monthly_limit)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [userId, type, start, dailyLimit, monthlyLimit]
  );

  return result.rows[0] as Quota;
}

// Atomically reserve one request for the given period. Returns true if allowed.
export async function reserveQuota(
  userId: number,
  type: PeriodType,
  dailyLimit: number | null,
  monthlyLimit: number | null
): Promise<boolean> {
  const start = periodStart(type);

  const result = await pool.query(
    `INSERT INTO quotas (user_id, period_type, period_start, daily_limit, monthly_limit, used)
     VALUES ($1, $2, $3, $4, $5, 1)
     ON CONFLICT (user_id, period_type, period_start)
     DO UPDATE SET used = quotas.used + 1
     RETURNING used, daily_limit, monthly_limit`,
    [userId, type, start, dailyLimit, monthlyLimit]
  );

  const row = result.rows[0] as {
    used: number;
    daily_limit: number | null;
    monthly_limit: number | null;
  };

  const effectiveLimit = type === "daily" ? row.daily_limit : row.monthly_limit;
  if (effectiveLimit === null || effectiveLimit <= 0) {
    return true;
  }
  return row.used <= effectiveLimit;
}

export async function checkQuota(
  userId: number,
  type: PeriodType,
  dailyLimit: number | null,
  monthlyLimit: number | null
): Promise<{ allowed: boolean; used: number; limit: number | null }> {
  const start = periodStart(type);
  const result = await pool.query(
    `SELECT used, daily_limit, monthly_limit
     FROM quotas
     WHERE user_id = $1 AND period_type = $2 AND period_start = $3`,
    [userId, type, start]
  );

  if (result.rows.length === 0) {
    return {
      allowed: true,
      used: 0,
      limit: type === "daily" ? dailyLimit : monthlyLimit,
    };
  }

  const row = result.rows[0] as {
    used: number;
    daily_limit: number | null;
    monthly_limit: number | null;
  };

  const effectiveLimit = type === "daily" ? row.daily_limit : row.monthly_limit;
  if (effectiveLimit === null || effectiveLimit <= 0) {
    return { allowed: true, used: row.used, limit: effectiveLimit };
  }
  return {
    allowed: row.used < effectiveLimit,
    used: row.used,
    limit: effectiveLimit,
  };
}

export async function recordUsage(
  userId: number,
  eventType: string,
  metadata: Record<string, unknown> = {}
): Promise<void> {
  await pool.query(
    `INSERT INTO usage_events (user_id, event_type, event_data, metadata)
     VALUES ($1, $2, $3, $4)`,
    [userId, eventType, JSON.stringify(metadata), JSON.stringify(metadata)]
  );
}

export async function getUserQuotaStatus(userId: number): Promise<{
  daily: { used: number; limit: number | null };
  monthly: { used: number; limit: number | null };
}> {
  const now = new Date();
  const dailyStart = periodStart("daily", now);
  const monthlyStart = periodStart("monthly", now);

  const result = await pool.query(
    `SELECT period_type, used, daily_limit, monthly_limit
     FROM quotas
     WHERE user_id = $1 AND period_type IN ('daily', 'monthly')
       AND period_start IN ($2, $3)`,
    [userId, dailyStart, monthlyStart]
  );

  const daily: { used: number; limit: number | null } = {
    used: 0,
    limit: env.DAILY_QUOTA_DEFAULT ?? null,
  };
  const monthly: { used: number; limit: number | null } = {
    used: 0,
    limit: env.MONTHLY_QUOTA_DEFAULT ?? null,
  };

  for (const row of result.rows) {
    if (row.period_type === "daily") {
      daily.used = row.used;
      daily.limit = row.daily_limit !== null ? row.daily_limit : daily.limit;
    } else {
      monthly.used = row.used;
      monthly.limit = row.monthly_limit !== null ? row.monthly_limit : monthly.limit;
    }
  }

  return { daily, monthly };
}

export async function getUserQuotaLimits(
  userId: number
): Promise<{
  daily: { used: number; limit: number | null };
  monthly: { used: number; limit: number | null };
}> {
  const status = await getUserQuotaStatus(userId);
  return {
    daily: { used: status.daily.used, limit: status.daily.limit },
    monthly: { used: status.monthly.used, limit: status.monthly.limit },
  };
}

export async function setUserQuotaLimits(
  userId: number,
  dailyLimit: number | null,
  monthlyLimit: number | null
): Promise<void> {
  const now = new Date();
  const dailyStart = periodStart("daily", now);
  const monthlyStart = periodStart("monthly", now);

  await pool.query(
    `INSERT INTO quotas (user_id, period_type, period_start, daily_limit, monthly_limit)
     VALUES ($1, 'daily', $2, $3, $4)
     ON CONFLICT (user_id, period_type, period_start)
     DO UPDATE SET daily_limit = $3`,
    [userId, dailyStart, dailyLimit, monthlyLimit]
  );

  await pool.query(
    `INSERT INTO quotas (user_id, period_type, period_start, daily_limit, monthly_limit)
     VALUES ($1, 'monthly', $2, $3, $4)
     ON CONFLICT (user_id, period_type, period_start)
     DO UPDATE SET monthly_limit = $4`,
    [userId, monthlyStart, dailyLimit, monthlyLimit]
  );
}