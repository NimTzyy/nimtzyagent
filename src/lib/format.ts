import type { Usage } from '@/core/types';

export function formatCount(value: number): string {
  return value.toLocaleString('en-US');
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function formatTimestamp(ms: number, now: number = Date.now()): string {
  const date = new Date(ms);
  const time = `${date.getHours().toString().padStart(2, '0')}:${date
    .getMinutes()
    .toString()
    .padStart(2, '0')}`;
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const delta = now - ms;
  if (ms >= startOfToday.getTime()) return time;
  if (delta < 7 * DAY_MS) {
    return date.toLocaleDateString('en-US', { weekday: 'short' }) + ` ${time}`;
  }
  if (date.getFullYear() === new Date(now).getFullYear()) {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatRelative(ms: number, now: number = Date.now()): string {
  const delta = now - ms;
  if (delta < 60_000) return 'now';
  if (delta < 60 * 60_000) return `${Math.floor(delta / 60_000)}m`;
  if (delta < DAY_MS) return `${Math.floor(delta / (60 * 60_000))}h`;
  if (delta < 7 * DAY_MS) return `${Math.floor(delta / DAY_MS)}d`;
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function formatUsageSummary(usage: Usage): string {
  const parts = [`${formatCount(usage.promptTokens)} in`, `${formatCount(usage.completionTokens)} out`];
  if (usage.cacheHitTokens > 0) parts.push(`${formatCount(usage.cacheHitTokens)} cached`);
  return parts.join('  ');
}

export function formatDuration(ms: number): string {
  const seconds = Math.max(1, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}
