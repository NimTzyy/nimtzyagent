import { createDraft, applyStreamEvent, beginRound, callsOf, isToolRound, mergeCompletion } from '../round';
import { decodeChunk } from '../stream';
import type { RoundDraft } from '../round';
import type { StreamEvent } from '../types';

// `tools.ts` reaches the file-system module for its workspace tools; the fold
// under test never calls one, and the native module is absent under jest.
jest.mock('@/lib/workspace', () => ({
  createWorkspaceFolder: jest.fn(),
  writeWorkspaceFile: jest.fn(),
  WorkspaceError: class WorkspaceError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'WorkspaceError';
    }
  },
}));

/** Feeds wire payloads through the real decoder, in the order the API sends them. */
function feed(draft: RoundDraft, payloads: string[]): void {
  for (const payload of payloads) {
    for (const event of decodeChunk(payload)) applyStreamEvent(draft, event);
  }
}

const ARGUMENT_CHUNKS = [
  '{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"search_web","arguments":""}}]}}]}',
  '{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"quer"}}]}}]}',
  '{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"y\\":\\"deepseek pricing\\"}"}}]}}]}',
];

const FINISHED_WITH_CALLS =
  '{"choices":[{"delta":{},"finish_reason":"tool_calls"}]}';

describe('applyStreamEvent', () => {
  it('accumulates argument fragments into one call, by index', () => {
    const draft = createDraft();
    feed(draft, [...ARGUMENT_CHUNKS, FINISHED_WITH_CALLS]);

    expect(callsOf(draft)).toEqual([
      {
        id: 'call_1',
        name: 'search_web',
        arguments: '{"query":"deepseek pricing"}',
        status: 'pending',
      },
    ]);
  });

  it('keeps calls apart when a round asks for two of them', () => {
    const draft = createDraft();
    feed(draft, [
      '{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"a","function":{"name":"search_web","arguments":"{\\"query\\":\\"one\\"}"}}]}}]}',
      '{"choices":[{"delta":{"tool_calls":[{"index":1,"id":"b","function":{"name":"create_folder","arguments":"{\\"path\\":\\"src\\"}"}}]}}]}',
    ]);

    expect(callsOf(draft).map((call) => call.id)).toEqual(['a', 'b']);
  });

  it('sums usage across rounds', () => {
    const draft = createDraft();
    feed(draft, ['{"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":2,"total_tokens":12}}']);
    beginRound(draft);
    feed(draft, ['{"choices":[],"usage":{"prompt_tokens":30,"completion_tokens":3,"total_tokens":33}}']);

    expect(draft.usage).toEqual({
      promptTokens: 40,
      completionTokens: 5,
      totalTokens: 45,
      cacheHitTokens: 0,
      cacheMissTokens: 40,
    });
  });
});

describe('the end of a stream', () => {
  // The API sends the last chunk and the `[DONE]` sentinel as one write, so
  // they are decoded from the same read. The sentinel names no reason, and
  // letting it overwrite `tool_calls` is silent: the round stops looking like a
  // tool round, the search never runs, and the reply is never asked for.
  it('does not let the [DONE] sentinel erase the finish reason before it', () => {
    const draft = createDraft();
    feed(draft, [...ARGUMENT_CHUNKS, FINISHED_WITH_CALLS, '[DONE]']);

    expect(draft.finishReason).toBe('tool_calls');
    expect(isToolRound(draft)).toBe(true);
  });

  it('leaves the reason unset when only the sentinel arrives', () => {
    const draft = createDraft();
    feed(draft, ['[DONE]']);

    expect(draft.finishReason).toBeUndefined();
    expect(isToolRound(draft)).toBe(false);
  });

  it('reads the reason from a chunk that carries content too', () => {
    const draft = createDraft();
    feed(draft, ['{"choices":[{"delta":{"content":"done"},"finish_reason":"stop"}]}', '[DONE]']);

    expect(draft.content).toBe('done');
    expect(draft.finishReason).toBe('stop');
    expect(isToolRound(draft)).toBe(false);
  });
});

describe('isToolRound', () => {
  it('runs a call whose arguments arrived whole, even without a reason', () => {
    // A stream can stop between the arguments and the reason. The arguments are
    // the part that decides whether the call can be run.
    const draft = createDraft();
    feed(draft, [...ARGUMENT_CHUNKS]);

    expect(draft.finishReason).toBeUndefined();
    expect(isToolRound(draft)).toBe(true);
  });

  it('refuses a call whose arguments were cut off mid-stream', () => {
    const draft = createDraft();
    feed(draft, [ARGUMENT_CHUNKS[0], ARGUMENT_CHUNKS[1]]);

    expect(callsOf(draft)[0].arguments).toBe('{"quer');
    expect(isToolRound(draft)).toBe(false);
  });

  it('is not a tool round when nothing was called', () => {
    const draft = createDraft();
    feed(draft, ['{"choices":[{"delta":{"content":"hello"}}]}', '[DONE]']);

    expect(isToolRound(draft)).toBe(false);
  });

  it('trusts the reason when the API names one', () => {
    const draft = createDraft();
    feed(draft, [ARGUMENT_CHUNKS[0], FINISHED_WITH_CALLS]);

    expect(isToolRound(draft)).toBe(true);
  });
});

describe('beginRound', () => {
  it('clears the round and keeps the turn', () => {
    const draft = createDraft();
    feed(draft, [...ARGUMENT_CHUNKS, FINISHED_WITH_CALLS, '{"choices":[{"delta":{"content":"hi"}}]}']);
    draft.error = 'boom';

    beginRound(draft);

    expect(draft.content).toBe('hi');
    expect(draft.finishReason).toBeUndefined();
    expect(draft.error).toBeNull();
    expect(callsOf(draft)).toEqual([]);
  });
});

describe('mergeCompletion', () => {
  it('folds a whole response into the same draft', () => {
    const draft = createDraft();
    mergeCompletion(draft, {
      content: 'answer',
      reasoning: 'thought',
      usage: { promptTokens: 5, completionTokens: 1, totalTokens: 6, cacheHitTokens: 0, cacheMissTokens: 5 },
      finishReason: 'tool_calls',
      toolCalls: [{ id: 'x', name: 'search_web', arguments: '{"query":"a"}', status: 'pending' }],
    });

    expect(draft.content).toBe('answer');
    expect(draft.reasoning).toBe('thought');
    expect(isToolRound(draft)).toBe(true);
  });

  it('does not erase a finish reason with a missing one', () => {
    const draft = createDraft();
    const events: StreamEvent[] = [{ type: 'done', finishReason: 'tool_calls' }];
    for (const event of events) applyStreamEvent(draft, event);
    mergeCompletion(draft, { content: '' });

    expect(draft.finishReason).toBe('tool_calls');
  });
});
