import type { Usage } from './types';

/**
 * USD per 1M tokens at off-peak rates, from
 * https://api-docs.deepseek.com/quick_start/pricing (2026-09-10).
 * Peak hours bill at double these rates. Prices change; treat every figure the
 * app shows as an estimate.
 */
export interface ModelPrices {
  cacheHit: number;
  cacheMiss: number;
  output: number;
}

export const PRICES: Record<string, ModelPrices> = {
  'deepseek-flash': { cacheHit: 0.003, cacheMiss: 0.15, output: 0.6 },
  'deepseek-v4-pro': { cacheHit: 0.022, cacheMiss: 0.66, output: 1.98 },
};

/** Peak is 01:00-04:00 and 06:00-10:00 UTC, Monday through Friday. */
export function isPeak(at: Date): boolean {
  const day = at.getUTCDay();
  if (day === 0 || day === 6) return false;
  const hour = at.getUTCHours();
  return (hour >= 1 && hour < 4) || (hour >= 6 && hour < 10);
}

export interface CostEstimate {
  usd: number;
  peak: boolean;
}

/**
 * `at` is when the request completed. Unknown models return null so the UI can
 * show a dash instead of a wrong number.
 */
export function estimateCostUsd(
  usage: Usage,
  modelId: string,
  at: Date = new Date(),
): CostEstimate | null {
  const prices = PRICES[modelId];
  if (!prices) return null;
  const peak = isPeak(at);
  const multiplier = peak ? 2 : 1;
  const usd =
    ((usage.cacheHitTokens * prices.cacheHit +
      usage.cacheMissTokens * prices.cacheMiss +
      usage.completionTokens * prices.output) /
      1_000_000) *
    multiplier;
  return { usd, peak };
}

export function formatUsd(usd: number): string {
  if (usd <= 0) return '$0.0000';
  if (usd < 0.0001) return '<$0.0001';
  if (usd < 1) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}
