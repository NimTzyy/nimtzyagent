import { formatSearchOutcome, normalizeQuery, searchWeb, SearchError } from '../search';

const mockFetch = jest.fn();
jest.mock('expo/fetch', () => ({ fetch: (...args: unknown[]) => mockFetch(...args) }));

function jsonResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

beforeEach(() => {
  mockFetch.mockReset();
});

describe('normalizeQuery', () => {
  it('collapses whitespace', () => {
    expect(normalizeQuery('  deepseek   v4  ')).toBe('deepseek v4');
  });

  it('caps a very long query', () => {
    expect(normalizeQuery('x'.repeat(500)).length).toBe(400);
  });
});

describe('searchWeb', () => {
  it('reads the DuckDuckGo abstract and its related topics', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        Heading: 'DeepSeek',
        AbstractText: 'DeepSeek is an AI company.',
        AbstractURL: 'https://example.com/deepseek',
        RelatedTopics: [
          { Text: 'DeepSeek-V3 - a language model.', FirstURL: 'https://example.com/v3' },
          { Topics: [{ Text: 'DeepSeek-R1 - a reasoning model.', FirstURL: 'https://example.com/r1' }] },
        ],
      }),
    );

    const outcome = await searchWeb('deepseek', 'duckduckgo');
    expect(outcome.provider).toBe('duckduckgo');
    expect(outcome.results).toHaveLength(3);
    expect(outcome.results[0]).toEqual({
      title: 'DeepSeek',
      url: 'https://example.com/deepseek',
      snippet: 'DeepSeek is an AI company.',
    });
    expect(outcome.results[1]).toEqual({
      title: 'DeepSeek-V3',
      url: 'https://example.com/v3',
      snippet: 'a language model.',
    });
    // The nested sub-topic is flattened to the top level.
    expect(outcome.results[2].title).toBe('DeepSeek-R1');
  });

  it('reads Wikipedia search pages', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        pages: [
          {
            key: 'DeepSeek',
            title: 'DeepSeek',
            excerpt: 'Chinese <span class="searchmatch">artificial intelligence</span> company',
          },
        ],
      }),
    );

    const outcome = await searchWeb('deepseek', 'wikipedia');
    expect(outcome.results[0]).toEqual({
      title: 'DeepSeek',
      url: 'https://en.wikipedia.org/wiki/DeepSeek',
      snippet: 'Chinese artificial intelligence company',
    });
  });

  it('posts a Serper query with its key', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({ organic: [{ title: 'A', link: 'https://a.test', snippet: 'Snippet A' }] }),
    );

    const outcome = await searchWeb('deepseek', 'serper', 'secret-key');
    const [url, init] = mockFetch.mock.calls[0] as [string, { headers: Record<string, string>; body: string }];
    expect(url).toBe('https://google.serper.dev/search');
    expect(init.headers['X-API-KEY']).toBe('secret-key');
    expect(JSON.parse(init.body)).toEqual({ q: 'deepseek', num: 5 });
    expect(outcome.results).toHaveLength(1);
  });

  it('refuses Serper without a key before making a request', async () => {
    await expect(searchWeb('deepseek', 'serper', '')).rejects.toBeInstanceOf(SearchError);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('caps the result count', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        organic: Array.from({ length: 12 }, (_, index) => ({
          title: `T${index}`,
          link: `https://x.test/${index}`,
          snippet: 's',
        })),
      }),
    );
    const outcome = await searchWeb('x', 'serper', 'key');
    expect(outcome.results).toHaveLength(5);
  });

  it('rejects an empty query', async () => {
    await expect(searchWeb('   ', 'duckduckgo')).rejects.toBeInstanceOf(SearchError);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('reports a rejected key distinctly', async () => {
    mockFetch.mockResolvedValue(jsonResponse({}, 403));
    await expect(searchWeb('x', 'serper', 'bad')).rejects.toThrow(/rejected/i);
  });

  it('reports when a provider has nothing', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ RelatedTopics: [] }));
    await expect(searchWeb('obscure', 'duckduckgo')).rejects.toThrow(/No results/i);
  });

  it('reports an unreachable provider rather than leaking the transport error', async () => {
    mockFetch.mockRejectedValue(new TypeError('Network request failed'));
    await expect(searchWeb('x', 'duckduckgo')).rejects.toThrow(/could not be reached/i);
  });

  it('reports a timeout as a timeout', async () => {
    const timeout = new Error('timed out');
    timeout.name = 'TimeoutError';
    mockFetch.mockRejectedValue(timeout);
    await expect(searchWeb('x', 'duckduckgo')).rejects.toThrow(/timed out/i);
  });
});

describe('formatSearchOutcome', () => {
  it('numbers the sources and keeps their urls', () => {
    const text = formatSearchOutcome({
      provider: 'wikipedia',
      query: 'deepseek',
      results: [
        { title: 'DeepSeek', url: 'https://en.wikipedia.org/wiki/DeepSeek', snippet: 'A company.' },
        { title: 'No url entry', url: '', snippet: 'Just a snippet.' },
      ],
    });
    expect(text).toContain('Wikipedia results for "deepseek"');
    expect(text).toContain('[1] DeepSeek\n   https://en.wikipedia.org/wiki/DeepSeek\n   A company.');
    expect(text).toContain('[2] No url entry\n   Just a snippet.');
  });
});
