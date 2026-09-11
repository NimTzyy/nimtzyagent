export type Role = 'system' | 'user' | 'assistant';

export type MessageStatus = 'complete' | 'stopped' | 'error';

export interface Usage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cacheHitTokens: number;
  cacheMissTokens: number;
}

export interface Attachment {
  id: string;
  kind: 'image' | 'text';
  name: string;
  mime: string;
  size: number;
  /** Local file uri on device. Never sent to the API. */
  uri: string;
  /** base64 data URL, images only, built at send time. */
  dataUrl?: string;
  /** Inlined text content, text files only. */
  text?: string;
}

/**
 * One function call the model asked for, kept with its result so the turn can
 * be replayed to the API exactly as it happened. Results live here rather than
 * in their own messages: the API takes them as `role: "tool"` entries, but a
 * stored turn is one assistant message either way, and that keeps delete,
 * regenerate and export working on a single row.
 */
export interface ToolCall {
  id: string;
  name: string;
  /** Arguments exactly as the model emitted them, JSON as a string. */
  arguments: string;
  /** What running it returned, or why it failed. Absent while pending. */
  result?: string;
  status: 'pending' | 'ok' | 'error';
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  role: Role;
  content: string;
  reasoning?: string;
  model?: string;
  status: MessageStatus;
  usage?: Usage;
  attachments?: Attachment[];
  toolCalls?: ToolCall[];
  /** Milliseconds spent in thinking mode, recorded when the stream ends. */
  thinkingMs?: number;
  createdAt: number;
}

export interface Conversation {
  id: string;
  title: string;
  systemPrompt?: string;
  presetId?: string;
  model: string;
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface Preset {
  id: string;
  name: string;
  description?: string;
  body: string;
  updatedAt: number;
}

export interface ModelInfo {
  id: string;
  label: string;
  description: string;
  thinking: boolean;
  vision: boolean;
  /** Whether the model can call the app's tools. */
  tools?: boolean;
  contextWindow: number;
  maxOutput: number;
  legacy?: boolean;
  custom?: boolean;
}

export type StreamEvent =
  | { type: 'reasoning'; text: string }
  | { type: 'content'; text: string }
  /**
   * A fragment of a tool call. The first fragment for an index carries the id
   * and function name; the rest carry only argument text, which is why they
   * have to be accumulated by index rather than read as complete calls.
   */
  | { type: 'tool_call'; index: number; id?: string; name?: string; arguments?: string }
  | { type: 'usage'; usage: Usage }
  | { type: 'done'; finishReason?: string }
  | { type: 'error'; message: string };

/** A function the model may call. The app defines it; the API only relays it. */
export interface ToolDef {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface RequestToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface RequestMessage {
  role: Role | 'tool';
  content: string | RequestContentBlock[];
  /**
   * Thinking-mode turns must be replayed with their reasoning intact or the
   * API rejects the follow-up with a 400. Only sent once a turn can carry
   * tools: without them the API ignores the field, so sending it is pure cost.
   */
  reasoning_content?: string;
  tool_calls?: RequestToolCall[];
  tool_call_id?: string;
}

export type RequestContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: 'low' | 'high' | 'original' | 'auto' } };
