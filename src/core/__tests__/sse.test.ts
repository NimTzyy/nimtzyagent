import { createSseParser, DONE_SENTINEL } from '../sse';

describe('createSseParser', () => {
  it('emits an event once its blank-line boundary arrives', () => {
    const parser = createSseParser();
    expect(parser.push('data: {"a":1}\n\n')).toEqual(['{"a":1}']);
  });

  it('holds a partial event until the rest of it arrives', () => {
    const parser = createSseParser();
    expect(parser.push('data: {"cho')).toEqual([]);
    expect(parser.push('ices":[]}\n\n')).toEqual(['{"choices":[]}']);
  });

  it('splits a chunk containing several events', () => {
    const parser = createSseParser();
    expect(parser.push('data: one\n\ndata: two\n\ndata: three\n\n')).toEqual([
      'one',
      'two',
      'three',
    ]);
  });

  it('handles boundaries split across chunks', () => {
    const parser = createSseParser();
    expect(parser.push('data: one\n')).toEqual([]);
    expect(parser.push('\ndata: two\n\n')).toEqual(['one', 'two']);
  });

  it('accepts CRLF line endings', () => {
    const parser = createSseParser();
    expect(parser.push('data: one\r\n\r\ndata: two\r\n\r\n')).toEqual(['one', 'two']);
  });

  it('ignores comment lines', () => {
    const parser = createSseParser();
    expect(parser.push(': keep-alive\ndata: real\n\n')).toEqual(['real']);
  });

  it('joins multi-line data fields with a newline', () => {
    const parser = createSseParser();
    expect(parser.push('data: first\ndata: second\n\n')).toEqual(['first\nsecond']);
  });

  it('passes the done sentinel through as an event', () => {
    const parser = createSseParser();
    expect(parser.push(`data: ${DONE_SENTINEL}\n\n`)).toEqual([DONE_SENTINEL]);
  });

  it('flushes a trailing event that never got its blank line', () => {
    const parser = createSseParser();
    parser.push('data: last');
    expect(parser.flush()).toEqual(['last']);
  });

  it('returns nothing from flush when the buffer holds no data', () => {
    const parser = createSseParser();
    parser.push(': comment only\n\n');
    expect(parser.flush()).toEqual([]);
  });
});
