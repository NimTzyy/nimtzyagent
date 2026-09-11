import type { ModelInfo } from './types';

/**
 * Model IDs verified against https://api-docs.deepseek.com on 2026-09-10.
 * DeepSeek retires aliases without a grace period: `deepseek-chat` and
 * `deepseek-reasoner` have returned errors since 2026-07-24. Keep every ID in
 * this registry and never inline one elsewhere.
 */
export const BUILTIN_MODELS: ModelInfo[] = [
  {
    id: 'deepseek-flash',
    label: 'DeepSeek Flash',
    description: 'V4.1 Flash. Thinking and vision. Lowest cost per token.',
    thinking: true,
    vision: true,
    contextWindow: 1_000_000,
    maxOutput: 384_000,
  },
  {
    id: 'deepseek-v4-pro',
    label: 'DeepSeek V4 Pro',
    description: 'Higher capability, no vision. Requests route to V4.1 Flash from 2026-09-14.',
    thinking: true,
    vision: false,
    contextWindow: 1_000_000,
    maxOutput: 384_000,
    legacy: true,
  },
  {
    id: 'deepseek-v4-flash',
    label: 'DeepSeek V4 Flash',
    description: 'Retired ID, served by the current Flash model.',
    thinking: true,
    vision: true,
    contextWindow: 1_000_000,
    maxOutput: 384_000,
    legacy: true,
  },
  {
    id: 'deepseek-v4-flash-vision-exp',
    label: 'DeepSeek V4 Flash Vision',
    description: 'Retired experimental ID, served by the current Flash model.',
    thinking: true,
    vision: true,
    contextWindow: 1_000_000,
    maxOutput: 384_000,
    legacy: true,
  },
];

export const DEFAULT_MODEL_ID = 'deepseek-flash';
export const DEFAULT_BASE_URL = 'https://api.deepseek.com';

function customToModelInfo(id: string): ModelInfo {
  return {
    id,
    label: id,
    description: 'Custom model.',
    thinking: true,
    vision: true,
    contextWindow: 1_000_000,
    maxOutput: 384_000,
    custom: true,
  };
}

/** Custom entries win over built-ins so a user can override capabilities. */
export function resolveModel(id: string, custom: ModelInfo[] = []): ModelInfo {
  return (
    custom.find((m) => m.id === id) ??
    BUILTIN_MODELS.find((m) => m.id === id) ??
    customToModelInfo(id)
  );
}

export function allModels(custom: ModelInfo[] = []): ModelInfo[] {
  const overridden = new Set(custom.map((m) => m.id));
  return [...custom, ...BUILTIN_MODELS.filter((m) => !overridden.has(m.id))];
}
