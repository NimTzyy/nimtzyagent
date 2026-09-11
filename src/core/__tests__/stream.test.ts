import { decodeChunk, decodeUsage } from '../stream';

describe('decodeUsage', () => {
  it('maps the wire fields', () => {
    expect(
      decodeUsage({
        prompt_tokens: 100,
        completion_tokens: 20,
        total_tokens: 120,
        prompt_cache_hit_tokens: 80,
        prompt_cache_miss_tokens: 20,
      }),
    ).toEqual({
      promptTokens: 100,
      completionTokens: 20,
      totalTokens: 120,
      cacheHitTokens: 80,
      cacheMissTokens: 20,
    });
  });

  it('derives the cache miss count when the API omits it', () => {
    expect(decodeUsage({ prompt_tokens: 100, prompt_cache_hit_tokens: 80 }).cacheMissTokens).toBe(20);
  });

  it('never reports a negative cache miss count', () => {
    expect(decodeUsage({ prompt_tokens: 10, prompt_cache_hit_tokens: 40 }).cacheMissTokens).toBe(0);
  });

  it('sums the total when it is absent', () => {
    expect(decodeUsage({ prompt_tokens: 10, completion_tokens: 5 }).totalTokens).toBe(15);
  });
});

describe('decodeChunk', () => {
  it('reads a content delta', () => {
    expect(decodeChunk('{"choices":[{"delta":{"content":"hello"}}]}')).toEqual([
      { type: 'content', text: 'hello' },
    ]);
  });

  it('reads a reasoning delta separately from the answer', () => {
    expect(decodeChunk('{"choices":[{"delta":{"reasoning_content":"thinking"}}]}')).toEqual([
      { type: 'reasoning', text: 'thinking' },
    ]);
  });

  it('returns both events when a chunk carries reasoning and content', () => {
    expect(
      decodeChunk('{"choices":[{"delta":{"reasoning_content":"why","content":"therefore"}}]}'),
    ).toEqual([
      { type: 'reasoning', text: 'why' },
      { type: 'content', text: 'therefore' },
    ]);
  });

  it('ignores empty string deltas', () => {
    expect(decodeChunk('{"choices":[{"delta":{"content":"","reasoning_content":null}}]}')).toEqual([]);
  });

  it('reports usage when present', () => {
    expect(decodeChunk('{"choices":[],"usage":{"prompt_tokens":7,"completion_tokens":2}}')).toEqual([
      {
        type: 'usage',
        usage: {
          promptTokens: 7,
          completionTokens: 2,
          totalTokens: 9,
          cacheHitTokens: 0,
          cacheMissTokens: 7,
        },
      },
    ]);
  });

  it('reports the finish reason as done', () => {
    expect(decodeChunk('{"choices":[{"delta":{},"finish_reason":"stop"}]}')).toEqual([
      { type: 'done', finishReason: 'stop' },
    ]);
  });

  it('treats the sentinel as done', () => {
    expect(decodeChunk('[DONE]')).toEqual([{ type: 'done' }]);
  });

  it('returns nothing for a blank payload', () => {
    expect(decodeChunk('   ')).toEqual([]);
  });

  it('surfaces malformed JSON as an error event rather than throwing', () => {
    expect(decodeChunk('{not json')).toEqual([
      { type: 'error', message: 'Received an unreadable chunk from the API.' },
    ]);
  });

  it('surfaces an error object from the API', () => {
    expect(decodeChunk('{"error":{"message":"Insufficient balance"}}')).toEqual([
      { type: 'error', message: 'Insufficient balance' },
    ]);
  });

  it('falls back to a generic message for an error without one', () => {
    expect(decodeChunk('{"error":{"type":"server_error"}}')).toEqual([
      { type: 'error', message: 'The API returned an error.' },
    ]);
  });

  it('reads a non-streaming message payload as a delta', () => {
    expect(decodeChunk('{"choices":[{"message":{"content":"full answer"}}]}')).toEqual([
      { type: 'content', text: 'full answer' },
    ]);
  });

  it('reads the opening fragment of a tool call', () => {
    expect(
      decodeChunk(
        '{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"search_web","arguments":""}}]}}]}',
      ),
    ).toEqual([{ type: 'tool_call', index: 0, id: 'call_1', name: 'search_web', arguments: '' }]);
  });

  it('reads a later argument fragment, which carries no id or name', () => {
    expect(
      decodeChunk(
        '{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"query\\":"}}]}}]}',
      ),
    ).toEqual([{ type: 'tool_call', index: 0, id: undefined, name: undefined, arguments: '{"query":' }]);
  });

  it('reports the tool_calls finish reason', () => {
    expect(decodeChunk('{"choices":[{"delta":{},"finish_reason":"tool_calls"}]}')).toEqual([
      { type: 'done', finishReason: 'tool_calls' },
    ]);
  });

  it('ignores a null tool_calls field', () => {
    expect(decodeChunk('{"choices":[{"delta":{"content":"hi","tool_calls":null}}]}')).toEqual([
      { type: 'content', text: 'hi' },
    ]);
  });
});
