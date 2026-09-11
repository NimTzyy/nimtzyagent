/**
 * Incremental parser for text/event-stream payloads.
 *
 * DeepSeek emits one JSON object per event as `data: {...}` followed by a blank
 * line, terminated by `data: [DONE]`. Chunks arriving from the network split at
 * arbitrary byte offsets, so the parser buffers until it sees an event boundary.
 */

export interface SseParser {
  /** Feed a chunk; returns any complete event payloads it unlocked. */
  push(chunk: string): string[];
  /** Drain the buffer at end of stream. */
  flush(): string[];
}

const BOUNDARY = /\r?\n\r?\n/;

function payloadOf(block: string): string | null {
  const dataLines: string[] = [];
  for (const rawLine of block.split(/\r?\n/)) {
    // Comment lines start with ':' and carry no data.
    if (rawLine.startsWith(':')) continue;
    if (!rawLine.startsWith('data:')) continue;
    let value = rawLine.slice(5);
    // A single leading space after the colon is part of the framing, not the data.
    if (value.startsWith(' ')) value = value.slice(1);
    dataLines.push(value);
  }
  if (dataLines.length === 0) return null;
  return dataLines.join('\n');
}

export function createSseParser(): SseParser {
  let buffer = '';

  const drain = (): string[] => {
    const events: string[] = [];
    for (;;) {
      const match = BOUNDARY.exec(buffer);
      if (!match || match.index === undefined) break;
      const block = buffer.slice(0, match.index);
      buffer = buffer.slice(match.index + match[0].length);
      const payload = payloadOf(block);
      if (payload !== null) events.push(payload);
    }
    return events;
  };

  return {
    push(chunk: string): string[] {
      buffer += chunk;
      return drain();
    },
    flush(): string[] {
      const events = drain();
      const rest = buffer.trim();
      buffer = '';
      if (rest.length > 0) {
        const payload = payloadOf(rest);
        if (payload !== null) events.push(payload);
      }
      return events;
    },
  };
}

export const DONE_SENTINEL = '[DONE]';
