import { estimateCostUsd, formatUsd, isPeak, PRICES } from '../pricing';
import type { Usage } from '../types';

function usage(partial: Partial<Usage>): Usage {
  return {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    cacheHitTokens: 0,
    cacheMissTokens: 0,
    ...partial,
  };
}

/** 2026-09-07 is a Monday. */
const MONDAY_OFFPEAK = new Date('2026-09-07T00:30:00Z');
const MONDAY_PEAK = new Date('2026-09-07T02:00:00Z');
const MONDAY_BETWEEN = new Date('2026-09-07T05:00:00Z');
const SATURDAY_PEAK_HOURS = new Date('2026-09-05T02:00:00Z');

describe('isPeak', () => {
  it('is off-peak before 01:00 UTC', () => {
    expect(isPeak(MONDAY_OFFPEAK)).toBe(false);
  });

  it('is peak from 01:00 to 04:00 UTC on a weekday', () => {
    expect(isPeak(MONDAY_PEAK)).toBe(true);
  });

  it('is off-peak between the two peak windows', () => {
    expect(isPeak(MONDAY_BETWEEN)).toBe(false);
  });

  it('is peak again from 06:00 to 10:00 UTC', () => {
    expect(isPeak(new Date('2026-09-07T06:00:00Z'))).toBe(true);
    expect(isPeak(new Date('2026-09-07T09:59:00Z'))).toBe(true);
    expect(isPeak(new Date('2026-09-07T10:00:00Z'))).toBe(false);
  });

  it('is off-peak all weekend', () => {
    expect(isPeak(SATURDAY_PEAK_HOURS)).toBe(false);
  });
});

describe('estimateCostUsd', () => {
  it('prices a cached prompt at the cache-hit rate', () => {
    const estimate = estimateCostUsd(
      usage({ cacheHitTokens: 1_000_000 }),
      'deepseek-flash',
      MONDAY_OFFPEAK,
    );
    expect(estimate?.usd).toBeCloseTo(PRICES['deepseek-flash'].cacheHit, 10);
    expect(estimate?.peak).toBe(false);
  });

  it('prices a cache miss at the input rate', () => {
    const estimate = estimateCostUsd(
      usage({ cacheMissTokens: 1_000_000 }),
      'deepseek-flash',
      MONDAY_OFFPEAK,
    );
    expect(estimate?.usd).toBeCloseTo(PRICES['deepseek-flash'].cacheMiss, 10);
  });

  it('prices output at the output rate', () => {
    const estimate = estimateCostUsd(
      usage({ completionTokens: 1_000_000 }),
      'deepseek-flash',
      MONDAY_OFFPEAK,
    );
    expect(estimate?.usd).toBeCloseTo(PRICES['deepseek-flash'].output, 10);
  });

  it('doubles the price during peak hours', () => {
    const token = usage({ completionTokens: 1_000_000 });
    const offpeak = estimateCostUsd(token, 'deepseek-flash', MONDAY_OFFPEAK);
    const peak = estimateCostUsd(token, 'deepseek-flash', MONDAY_PEAK);
    expect(peak?.usd).toBeCloseTo((offpeak?.usd ?? 0) * 2, 10);
    expect(peak?.peak).toBe(true);
  });

  it('adds the three rates together', () => {
    const prices = PRICES['deepseek-flash'];
    const estimate = estimateCostUsd(
      usage({ cacheHitTokens: 1_000_000, cacheMissTokens: 1_000_000, completionTokens: 1_000_000 }),
      'deepseek-flash',
      MONDAY_OFFPEAK,
    );
    expect(estimate?.usd).toBeCloseTo(prices.cacheHit + prices.cacheMiss + prices.output, 10);
  });

  it('returns null for a model with no published prices', () => {
    expect(estimateCostUsd(usage({ completionTokens: 10 }), 'unknown-model', MONDAY_OFFPEAK)).toBeNull();
  });
});

describe('formatUsd', () => {
  it('uses four decimals below a dollar', () => {
    expect(formatUsd(0.0123)).toBe('$0.0123');
  });

  it('uses two decimals at a dollar and above', () => {
    expect(formatUsd(12.3456)).toBe('$12.35');
  });

  it('calls out amounts below the smallest printed unit', () => {
    expect(formatUsd(0.00001)).toBe('<$0.0001');
  });

  it('prints zero plainly', () => {
    expect(formatUsd(0)).toBe('$0.0000');
  });
});
