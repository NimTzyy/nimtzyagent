import { fetch } from 'expo/fetch';

import { strings } from '@/lib/strings';

/**
 * Web search, run on the device.
 *
 * DeepSeek ships no search endpoint and no built-in research tool, so research
 * is a tool this app defines and executes itself: the model asks for a query,
 * this fetches it, and the results go back as the tool's answer. The two
 * default providers are keyless; Serper is offered for anyone who wants real
 * web results rather than an encyclopaedia summary.
 */

export type SearchProvider = 'duckduckgo' | 'wikipedia' | 'serper';

export const SEARCH_PROVIDER_IDS: SearchProvider[] = ['duckduckgo', 'wikipedia', 'serper'];

/** Which providers need a key, so Settings knows whether to ask for one. */
export function providerNeedsKey(provider: SearchProvider): boolean {
  return provider === 'serper';
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface SearchOutcome {
  provider: SearchProvider;
  query: string;
  results: SearchResult[];
}

export class SearchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SearchError';
  }
}

const TIMEOUT_MS = 15_000;
const MAX_RESULTS = 5;
const MAX_SNIPPET_CHARS = 320;
const MAX_QUERY_CHARS = 400;

/** A query is the model's text; it goes in a URL, so it is bounded here. */
export function normalizeQuery(query: string): string {
  const collapsed = query.replace(/\s+/g, ' ').trim();
  return collapsed.length > MAX_QUERY_CHARS ? collapsed.slice(0, MAX_QUERY_CHARS) : collapsed;
}

function snippetOf(text: string | undefined | null): string {
  if (!text) return '';
  const plain = text
    .replace(/<[^>]*>/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.length > MAX_SNIPPET_CHARS ? `${plain.slice(0, MAX_SNIPPET_CHARS - 1)}…` : plain;
}

async function getJson(url: string, signal?: AbortSignal, init?: RequestInit): Promise<unknown> {
  let response;
  try {
    // The timeout is the provider's budget; the caller's signal is the user
    // pressing stop, and it has to win immediately either way.
    response = await fetch(url, {
      ...init,
      signal: signal ? AbortSignal.any([AbortSignal.timeout(TIMEOUT_MS), signal]) : AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    if (signal?.aborted) throw new SearchError(strings.agent.stopped);
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new SearchError(strings.research.timedOut);
    }
    throw new SearchError(strings.research.unreachable);
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new SearchError(strings.research.keyRejected);
    }
    if (response.status === 429) throw new SearchError(strings.research.rateLimited);
    throw new SearchError(`${strings.research.failed} (${response.status})`);
  }

  try {
    return (await response.json()) as unknown;
  } catch {
    throw new SearchError(strings.research.unreadable);
  }
}

interface DdgTopic {
  Text?: string;
  FirstURL?: string;
  Topics?: DdgTopic[];
}

interface DdgResponse {
  Heading?: string;
  AbstractText?: string;
  AbstractURL?: string;
  Answer?: string;
  RelatedTopics?: DdgTopic[];
}

/** Related topics nest one level deep when a subject has sub-topics. */
function flattenTopics(topics: DdgTopic[] | undefined, out: DdgTopic[]): void {
  for (const topic of topics ?? []) {
    if (topic.Topics && topic.Topics.length > 0) {
      flattenTopics(topic.Topics, out);
    } else if (topic.Text) {
      out.push(topic);
    }
  }
}

/** DDG writes related topics as "Title - the description that follows". */
function splitTopic(text: string): { title: string; snippet: string } {
  const separator = text.indexOf(' - ');
  if (separator > 0 && separator < 80) {
    return { title: text.slice(0, separator).trim(), snippet: text.slice(separator + 3).trim() };
  }
  return { title: text.slice(0, 60).trim(), snippet: text };
}

async function searchDuckDuckGo(query: string, signal?: AbortSignal): Promise<SearchResult[]> {
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
  const parsed = (await getJson(url, signal)) as DdgResponse;
  const results: SearchResult[] = [];

  const abstract = snippetOf(parsed.AbstractText ?? parsed.Answer);
  if (abstract) {
    results.push({
      title: parsed.Heading?.trim() || query,
      url: parsed.AbstractURL ?? '',
      snippet: abstract,
    });
  }

  const topics: DdgTopic[] = [];
  flattenTopics(parsed.RelatedTopics, topics);
  for (const topic of topics) {
    if (!topic.Text) continue;
    const { title, snippet } = splitTopic(topic.Text);
    results.push({ title, url: topic.FirstURL ?? '', snippet: snippetOf(snippet) });
    if (results.length >= MAX_RESULTS) break;
  }

  return results;
}

interface WikipediaResponse {
  pages?: {
    key?: string;
    title?: string;
    description?: string;
    excerpt?: string;
  }[];
}

async function searchWikipedia(query: string, signal?: AbortSignal): Promise<SearchResult[]> {
  const url = `https://en.wikipedia.org/w/rest.php/v1/search/page?q=${encodeURIComponent(query)}&limit=${MAX_RESULTS}`;
  const parsed = (await getJson(url, signal)) as WikipediaResponse;
  return (parsed.pages ?? []).slice(0, MAX_RESULTS).map((page) => ({
    title: page.title?.trim() || page.key || query,
    url: page.key ? `https://en.wikipedia.org/wiki/${encodeURIComponent(page.key)}` : '',
    snippet: snippetOf(page.excerpt || page.description),
  }));
}

interface SerperResponse {
  organic?: { title?: string; link?: string; snippet?: string }[];
}

async function searchSerper(
  query: string,
  apiKey: string,
  signal?: AbortSignal,
): Promise<SearchResult[]> {
  if (!apiKey.trim()) throw new SearchError(strings.research.keyRequired);
  const parsed = (await getJson(
    'https://google.serper.dev/search',
    signal,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-KEY': apiKey.trim() },
      body: JSON.stringify({ q: query, num: MAX_RESULTS }),
    },
  )) as SerperResponse;
  return (parsed.organic ?? []).slice(0, MAX_RESULTS).map((entry) => ({
    title: entry.title?.trim() ?? '',
    url: entry.link ?? '',
    snippet: snippetOf(entry.snippet),
  }));
}

export async function searchWeb(
  query: string,
  provider: SearchProvider,
  apiKey = '',
  /** Aborted when the user stops the turn, so a slow provider does not hold it open. */
  signal?: AbortSignal,
): Promise<SearchOutcome> {
  const normalized = normalizeQuery(query);
  if (!normalized) throw new SearchError(strings.research.emptyQuery);

  const results =
    provider === 'wikipedia'
      ? await searchWikipedia(normalized, signal)
      : provider === 'serper'
        ? await searchSerper(normalized, apiKey, signal)
        : await searchDuckDuckGo(normalized, signal);

  const usable = results.filter((result) => result.snippet || result.title);
  if (usable.length === 0) throw new SearchError(strings.research.noResults(normalized));
  return { provider, query: normalized, results: usable };
}

/**
 * The tool result the model reads. Sources are numbered so the answer can cite
 * them, and the whole thing is capped: a tool result is paid for on every
 * following request in the conversation.
 */
export function formatSearchOutcome(outcome: SearchOutcome): string {
  const label = strings.research.providerLabel[outcome.provider];
  const lines = outcome.results.map((result, index) => {
    const source = result.url ? `\n   ${result.url}` : '';
    return `[${index + 1}] ${result.title}${source}\n   ${result.snippet}`;
  });
  return `${label} results for "${outcome.query}":\n\n${lines.join('\n\n')}`;
}
