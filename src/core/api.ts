import { fetch } from 'expo/fetch';

import { createSseParser } from './sse';
import { decodeChunk, decodeUsage } from './stream';
import type { RequestMessage, StreamEvent, ToolCall, ToolDef, Usage } from './types';

export type ReasoningEffort = 'low' | 'high' | 'max';

export interface StreamChatOptions {
  apiKey: string;
  baseUrl: string;
  model: string;
  messages: RequestMessage[];
  thinking: boolean;
  reasoningEffort: ReasoningEffort;
  maxTokens?: number;
  /**
   * Functions the model may call. The choice is left to the API's default
   * (`auto`): asking for a call outright is rejected in thinking mode.
   */
  tools?: ToolDef[];
  signal?: AbortSignal;
  onEvent: (event: StreamEvent) => void;
}

export class ApiError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export function isAbortError(error: unknown): boolean {
  if (error instanceof Error) {
    return error.name === 'AbortError' || error.message.includes('Aborted');
  }
  return false;
}

/** Accepts a bare host, a trailing slash, or a pasted full chat endpoint. */
export function normalizeBaseUrl(input: string): string {
  let url = input.trim();
  if (!url) return '';
  url = url.replace(/\/+$/, '');
  url = url.replace(/\/chat\/completions$/, '');
  return url;
}

function endpointFor(baseUrl: string): string {
  const base = normalizeBaseUrl(baseUrl);
  return `${base}/chat/completions`;
}

export function describeHttpError(status: number, rawBody: string): string {
  const detail = rawBody.trim().slice(0, 300);
  const parity = detail.length > 0 ? ` ${detail}` : '';
  switch (status) {
    case 400:
      return `The request was rejected (400).${parity}`;
    case 401:
      return 'The API key was rejected. Check it in Settings.';
    case 402:
      return 'This DeepSeek account has insufficient balance.';
    case 404:
      return 'The endpoint was not found. Check the base URL in Settings.';
    case 429:
      return 'Rate limited by DeepSeek. Wait a moment and retry.';
    case 500:
    case 502:
    case 503:
    case 504:
      return `DeepSeek reported a server error (${status}). Retry shortly.`;
    default:
      return `Request failed with status ${status}.${parity}`;
  }
}

interface ErrorEnvelope {
  error?: { message?: string };
  message?: string;
}

function errorMessageFromBody(rawBody: string, status: number): string {
  try {
    const parsed = JSON.parse(rawBody) as ErrorEnvelope;
    const message = parsed.error?.message ?? parsed.message;
    if (message && message.trim().length > 0) {
      if (status === 401) return 'The API key was rejected. Check it in Settings.';
      if (status === 402) return 'This DeepSeek account has insufficient balance.';
      if (status === 429) return 'Rate limited by DeepSeek. Wait a moment and retry.';
      return message.trim().slice(0, 300);
    }
  } catch {
    // Fall through to the status-based description.
  }
  return describeHttpError(status, rawBody);
}

/**
 * Streams a completion. Resolves when the stream ends; throws ApiError on a
 * transport or HTTP failure, and rethrows the abort error untouched so callers
 * can tell a cancel apart from a fault.
 */
export async function streamChat(options: StreamChatOptions): Promise<void> {
  const { apiKey, baseUrl, model, messages, thinking, reasoningEffort, maxTokens, tools, signal } =
    options;

  const body: Record<string, unknown> = {
    model,
    messages,
    stream: true,
    thinking: { type: thinking ? 'enabled' : 'disabled' },
  };
  if (thinking) body.reasoning_effort = reasoningEffort;
  if (typeof maxTokens === 'number' && maxTokens > 0) body.max_tokens = maxTokens;
  if (tools && tools.length > 0) body.tools = tools;

  let response;
  try {
    response = await fetch(endpointFor(baseUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: signal ?? null,
    });
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new ApiError(
      'Could not reach the API. Check the connection and the base URL in Settings.',
    );
  }

  if (!response.ok) {
    let rawBody = '';
    try {
      rawBody = await response.text();
    } catch {
      rawBody = '';
    }
    throw new ApiError(errorMessageFromBody(rawBody, response.status), response.status);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new ApiError('The API returned a response with no body.');

  const decoder = new TextDecoder();
  const parser = createSseParser();
  let sawTerminalEvent = false;

  const dispatch = (payloads: string[]): void => {
    for (const payload of payloads) {
      for (const event of decodeChunk(payload)) {
        options.onEvent(event);
        if (event.type === 'done') sawTerminalEvent = true;
      }
    }
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) dispatch(parser.push(decoder.decode(value, { stream: true })));
      if (sawTerminalEvent) {
        await reader.cancel().catch(() => undefined);
        return;
      }
    }
    const tail = decoder.decode();
    dispatch(tail ? parser.push(tail) : []);
    dispatch(parser.flush());
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new ApiError(
      error instanceof Error && error.message
        ? `The stream stopped unexpectedly. ${error.message}`
        : 'The stream stopped unexpectedly.',
    );
  }
}

export interface CompletionResult {
  content: string;
  reasoning?: string;
  usage?: Usage;
  finishReason?: string;
  toolCalls?: ToolCall[];
}

interface CompletionResponse {
  choices?: {
    message?: {
      content?: string | null;
      reasoning_content?: string | null;
      tool_calls?: { id?: string; function?: { name?: string; arguments?: string } }[] | null;
    };
    finish_reason?: string | null;
  }[];
  usage?: Parameters<typeof decodeUsage>[0];
}

/** Whole tool calls arrive at once when the response is not streamed. */
function decodeCompleteToolCalls(raw: CompletionResponse['choices']): ToolCall[] | undefined {
  const calls = raw?.[0]?.message?.tool_calls;
  if (!calls || calls.length === 0) return undefined;
  return calls.map((call, index) => ({
    id: call.id ?? `call_${index}`,
    name: call.function?.name ?? '',
    arguments: call.function?.arguments ?? '',
    status: 'pending',
  }));
}

/**
 * Non-streaming completion, used when streaming is switched off in Settings
 * or when a proxy in front of the API does not forward SSE.
 */
export async function completeChat(
  options: Omit<StreamChatOptions, 'onEvent' | 'signal'> & { signal?: AbortSignal },
): Promise<CompletionResult> {
  const { apiKey, baseUrl, model, messages, thinking, reasoningEffort, maxTokens, tools, signal } =
    options;
  const body: Record<string, unknown> = {
    model,
    messages,
    stream: false,
    thinking: { type: thinking ? 'enabled' : 'disabled' },
  };
  if (thinking) body.reasoning_effort = reasoningEffort;
  if (typeof maxTokens === 'number' && maxTokens > 0) body.max_tokens = maxTokens;
  if (tools && tools.length > 0) body.tools = tools;

  let response;
  try {
    response = await fetch(endpointFor(baseUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: signal ?? null,
    });
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new ApiError('Could not reach the API. Check the connection and the base URL in Settings.');
  }

  if (!response.ok) {
    const raw = await response.text().catch(() => '');
    throw new ApiError(errorMessageFromBody(raw, response.status), response.status);
  }

  let parsed: CompletionResponse;
  try {
    parsed = (await response.json()) as CompletionResponse;
  } catch {
    throw new ApiError('The API returned a response that could not be read.');
  }

  const choice = parsed.choices?.[0];
  return {
    content: choice?.message?.content ?? '',
    reasoning: choice?.message?.reasoning_content ?? undefined,
    usage: parsed.usage ? decodeUsage(parsed.usage) : undefined,
    finishReason: choice?.finish_reason ?? undefined,
    toolCalls: decodeCompleteToolCalls(parsed.choices),
  };
}

export interface ConnectionResult {
  ok: boolean;
  status: number;
  message: string;
}

/**
 * Checks a key and base URL. Prefers GET /models; when that is unavailable it
 * falls back to a one-token chat request, which costs a negligible amount.
 */
export async function testConnection(
  apiKey: string,
  baseUrl: string,
  model: string,
): Promise<ConnectionResult> {
  const base = normalizeBaseUrl(baseUrl);
  if (!base) return { ok: false, status: 0, message: 'Enter a base URL first.' };
  if (!apiKey.trim()) return { ok: false, status: 0, message: 'Enter an API key first.' };

  try {
    const response = await fetch(`${base}/models`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (response.ok) {
      return { ok: true, status: response.status, message: 'Connected.' };
    }
    if (response.status !== 404 && response.status !== 405) {
      const raw = await response.text().catch(() => '');
      return {
        ok: false,
        status: response.status,
        message: errorMessageFromBody(raw, response.status),
      };
    }
  } catch {
    return {
      ok: false,
      status: 0,
      message: 'Could not reach the API. Check the connection and the base URL.',
    };
  }

  try {
    const response = await fetch(endpointFor(base), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1,
        stream: false,
        thinking: { type: 'disabled' },
      }),
    });
    if (response.ok) return { ok: true, status: response.status, message: 'Connected.' };
    const raw = await response.text().catch(() => '');
    return { ok: false, status: response.status, message: errorMessageFromBody(raw, response.status) };
  } catch {
    return {
      ok: false,
      status: 0,
      message: 'Could not reach the API. Check the connection and the base URL.',
    };
  }
}
