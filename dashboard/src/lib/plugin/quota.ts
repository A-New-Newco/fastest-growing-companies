export type QuotaPolicy = "conservative" | "balanced" | "aggressive";

export const QUOTA_SETTINGS = {
  conservative: {
    dailyWarmup7: 15,
    dailyWarmup21: 25,
    dailySteady: 35,
    dailyHardCap: 40,
    hourlyCap: 6,
    cooldownSec: 90,
  },
  balanced: {
    dailyWarmup7: 25,
    dailyWarmup21: 35,
    dailySteady: 45,
    dailyHardCap: 55,
    hourlyCap: 10,
    cooldownSec: 60,
  },
  aggressive: {
    dailyWarmup7: 35,
    dailyWarmup21: 50,
    dailySteady: 65,
    dailyHardCap: 80,
    hourlyCap: 14,
    cooldownSec: 45,
  },
} as const;

export const FAILURE_CODES_THAT_PAUSE = new Set([
  "captcha",
  "checkpoint",
  "rate_warning",
  "ui_unknown",
  "account_restricted",
]);

export interface QuotaSnapshot {
  policy: QuotaPolicy;
  dailyLimit: number;
  hourlyLimit: number;
  cooldownSec: number;
  usedDaily: number;
  usedHourly: number;
  secondsSinceLastContact: number | null;
  remainingDaily: number;
  remainingHourly: number;
  cooldownRemainingSec: number;
}

export function toQuotaPolicy(value: string | null | undefined): QuotaPolicy {
  if (value === "balanced" || value === "aggressive") return value;
  return "conservative";
}

export function daysSince(dateIso: string | null | undefined): number {
  if (!dateIso) return 0;
  const ts = new Date(dateIso).getTime();
  if (Number.isNaN(ts)) return 0;
  const diffMs = Date.now() - ts;
  return Math.max(0, Math.floor(diffMs / (24 * 60 * 60 * 1000)));
}

export function resolveDailyLimit(policy: QuotaPolicy, ageDays: number): number {
  const cfg = QUOTA_SETTINGS[policy];
  let limit: number = cfg.dailySteady;
  if (ageDays <= 7) limit = cfg.dailyWarmup7;
  else if (ageDays <= 21) limit = cfg.dailyWarmup21;
  return Math.min(limit, cfg.dailyHardCap);
}

export function startOfDayIso(now = new Date()): string {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export function startOfHourIso(now = new Date()): string {
  const d = new Date(now);
  d.setMinutes(0, 0, 0);
  return d.toISOString();
}
