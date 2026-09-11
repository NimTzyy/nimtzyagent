import { parseToolArguments } from './tools';
import type { StreamEvent, ToolCall, Usage } from './types';

/**
 * What one streamed turn builds up, and the rules for reading it.
 *
 * This lives apart from the store because two of those rules are quiet ones
 * that a reader of the streaming code cannot check by eye, and both decide
 * whether a tool call ever runs:
 *
 * - A `[DONE]` sentinel ends the stream without naming a finish reason. It
 *   arrives in the same read as the last real chunk often enough that treating
 *   it as authoritative erases the reason the API just gave. An erased
 *   `tool_calls` is not cosmetic: the round then looks like an ordinary answer,
 *   its calls are never run, and the user is left with a step that says it
 *   searched and no reply after it.
 * - A round is a tool round when the API said so, or when every call carries
 *   arguments that parse. The second half matters because a stream can stop
 *   between the arguments and the reason, and a call whose arguments are
 *   complete is safe to run — while a half-delivered one is refused by the same
 *   test rather than executed with missing fields.
 */

export interface RoundDraft {
  /** The turn's text so far, across every round of it. */
  content: string;
  reasoning: string;
  usage?: Usage;
  /**
   * Arguments that arrived as fragments, keyed by the index the API sent. The
   * first fragment for an index carries the id and name; the rest only append
   * argument text, so they cannot be read as whole calls.
   */
  fragments: Map<number, ToolCall>;
  /** How the last round ended, when the API said. */
  finishReason?: string;
  /** The last transport error of the round in progress. */
  error: string | null;
}

export function createDraft(): RoundDraft {
  return { content: '', reasoning: '', fragments: new Map(), error: null };
}

/** Clears what belongs to one round, keeping what the turn has accumulated. */
export function beginRound(draft: RoundDraft): void {
  draft.fragments = new Map();
  draft.finishReason = undefined;
  draft.error = null;
}

/** Each round is billed separately, so a turn's cost is their sum. */
function addUsage(current: Usage | undefined, next: Usage | undefined): Usage | undefined {
  if (!next) return current;
  if (!current) return next;
  return {
    promptTokens: current.promptTokens + next.promptTokens,
    completionTokens: current.completionTokens + next.completionTokens,
    totalTokens: current.totalTokens + next.totalTokens,
    cacheHitTokens: current.cacheHitTokens + next.cacheHitTokens,
    cacheMissTokens: current.cacheMissTokens + next.cacheMissTokens,
  };
}

export function applyStreamEvent(draft: RoundDraft, event: StreamEvent): void {
  switch (event.type) {
    case 'reasoning':
      draft.reasoning += event.text;
      return;
    case 'content':
      draft.content += event.text;
      return;
    case 'tool_call': {
      const existing = draft.fragments.get(event.index);
      draft.fragments.set(event.index, {
        id: event.id ?? existing?.id ?? `call_${event.index}`,
        name: event.name ?? existing?.name ?? '',
        arguments: (existing?.arguments ?? '') + (event.arguments ?? ''),
        status: 'pending',
      });
      return;
    }
    case 'usage':
      draft.usage = addUsage(draft.usage, event.usage);
      return;
    case 'error':
      draft.error = event.message;
      return;
    case 'done':
      // Not `draft.finishReason = event.finishReason`: the sentinel would erase
      // a reason that arrived in the same read. See the note at the top.
      if (event.finishReason) draft.finishReason = event.finishReason;
      return;
  }
}

/** A whole (unstreamed) completion folded into the same draft. */
export function mergeCompletion(
  draft: RoundDraft,
  completion: {
    content: string;
    reasoning?: string;
    usage?: Usage;
    finishReason?: string;
    toolCalls?: ToolCall[];
  },
): void {
  draft.content += completion.content;
  draft.reasoning += completion.reasoning ?? '';
  draft.usage = addUsage(draft.usage, completion.usage);
  if (completion.finishReason) draft.finishReason = completion.finishReason;
  for (const [index, call] of (completion.toolCalls ?? []).entries()) {
    draft.fragments.set(index, call);
  }
}

/** The round's calls, in the order the API sent them. */
export function callsOf(draft: RoundDraft): ToolCall[] {
  return [...draft.fragments.entries()].sort(([a], [b]) => a - b).map(([, call]) => call);
}

/**
 * Whether the round asked for tools that are ready to run. See the note at the
 * top of the file for why the finish reason alone is not enough.
 */
export function isToolRound(draft: RoundDraft): boolean {
  const calls = callsOf(draft);
  if (calls.length === 0) return false;
  if (draft.finishReason === 'tool_calls') return true;
  return calls.every((call) => parseToolArguments(call.arguments) !== null);
}
