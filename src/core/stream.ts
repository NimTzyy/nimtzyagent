import { DONE_SENTINEL } from './sse';
import type { StreamEvent, Usage } from './types';

/**
 * Mapping between the wire format and the app's stream events lives here and
 * nowhere else. If DeepSeek renames a field, this is the only file to touch.
 */

interface RawUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  prompt_cache_hit_tokens?: number;
  prompt_cache_miss_tokens?: number;
}

interface RawToolCallDelta {
  index?: number;
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string };
}

interface RawDelta {
  content?: string | null;
  reasoning_content?: string | null;
  tool_calls?: RawToolCallDelta[] | null;
}

interface RawChoice {
  delta?: RawDelta;
  message?: RawDelta;
  finish_reason?: string | null;
}

interface RawChunk {
  choices?: RawChoice[];
  usage?: RawUsage | null;
  error?: { message?: string; type?: string } | null;
}

export function decodeUsage(raw: RawUsage): Usage {
  const promptTokens = raw.prompt_tokens ?? 0;
  const completionTokens = raw.completion_tokens ?? 0;
  const cacheHitTokens = raw.prompt_cache_hit_tokens ?? 0;
  const cacheMissTokens = raw.prompt_cache_miss_tokens ?? Math.max(promptTokens - cacheHitTokens, 0);
  return {
    promptTokens,
    completionTokens,
    totalTokens: raw.total_tokens ?? promptTokens + completionTokens,
    cacheHitTokens,
    cacheMissTokens,
  };
}

/**
 * Decode one SSE payload into zero or more stream events.
 * The sentinel `[DONE]` closes the stream; malformed payloads surface as
 * an error event rather than throwing, so a bad frame cannot kill a live turn.
 */
export function decodeChunk(payload: string): StreamEvent[] {
  const trimmed = payload.trim();
  if (trimmed.length === 0) return [];
  if (trimmed === DONE_SENTINEL) return [{ type: 'done' }];

  let parsed: RawChunk;
  try {
    parsed = JSON.parse(trimmed) as RawChunk;
  } catch {
    return [{ type: 'error', message: 'Received an unreadable chunk from the API.' }];
  }

  if (parsed.error) {
    return [{ type: 'error', message: parsed.error.message ?? 'The API returned an error.' }];
  }

  const events: StreamEvent[] = [];
  const choice = parsed.choices?.[0];
  const delta = choice?.delta ?? choice?.message;

  if (delta?.reasoning_content) {
    events.push({ type: 'reasoning', text: delta.reasoning_content });
  }
  if (delta?.content) {
    events.push({ type: 'content', text: delta.content });
  }
  for (const call of delta?.tool_calls ?? []) {
    events.push({
      type: 'tool_call',
      index: call.index ?? 0,
      id: call.id,
      name: call.function?.name,
      arguments: call.function?.arguments,
    });
  }
  if (parsed.usage) {
    events.push({ type: 'usage', usage: decodeUsage(parsed.usage) });
  }
  if (choice?.finish_reason) {
    events.push({ type: 'done', finishReason: choice.finish_reason });
  }
  return events;
}
