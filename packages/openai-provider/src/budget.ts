/** Seção 5 da missão: orçamento fixo desta liberação. Valores em USD. */
export const BUDGET_CONFIG = {
  monthlyTotalUsd: Number(process.env.MONTHLY_TOTAL_BUDGET_USD ?? 14.05),
  monthlyOperationalCapUsd: Number(process.env.MONTHLY_OPERATIONAL_CAP_USD ?? 12.0),
  emergencyReserveUsd: Number(process.env.EMERGENCY_RESERVE_USD ?? 2.05),
  dailyTargetUsd: Number(process.env.DAILY_TARGET_USD ?? 0.4),
} as const;
