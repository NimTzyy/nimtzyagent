import { getDatabase } from './index';
import type { Attachment, ChatMessage, MessageStatus, Role, ToolCall, Usage } from '@/core/types';

interface MessageRow {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  reasoning: string | null;
  model: string | null;
  status: string;
  usage_json: string | null;
  attachments_json: string | null;
  tool_calls_json: string | null;
  thinking_ms: number | null;
  created_at: number;
}

function parseJson<T>(raw: string | null): T | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

export function toChatMessage(row: MessageRow): ChatMessage {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role as Role,
    content: row.content,
    reasoning: row.reasoning ?? undefined,
    model: row.model ?? undefined,
    status: row.status as MessageStatus,
    usage: parseJson<Usage>(row.usage_json),
    attachments: parseJson<Attachment[]>(row.attachments_json),
    toolCalls: parseJson<ToolCall[]>(row.tool_calls_json),
    thinkingMs: row.thinking_ms ?? undefined,
    createdAt: row.created_at,
  };
}

export async function listMessages(conversationId: string): Promise<ChatMessage[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<MessageRow>(
    'SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC, id ASC',
    [conversationId],
  );
  return rows.map(toChatMessage);
}

export async function insertMessage(message: ChatMessage): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT OR REPLACE INTO messages
      (id, conversation_id, role, content, reasoning, model, status, usage_json, attachments_json, tool_calls_json, thinking_ms, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      message.id,
      message.conversationId,
      message.role,
      message.content,
      message.reasoning ?? null,
      message.model ?? null,
      message.status,
      message.usage ? JSON.stringify(message.usage) : null,
      message.attachments && message.attachments.length > 0
        ? JSON.stringify(message.attachments)
        : null,
      message.toolCalls && message.toolCalls.length > 0
        ? JSON.stringify(message.toolCalls)
        : null,
      message.thinkingMs ?? null,
      message.createdAt,
    ],
  );
}

export async function updateMessage(message: ChatMessage): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `UPDATE messages
       SET content = ?, reasoning = ?, status = ?, usage_json = ?, attachments_json = ?,
           tool_calls_json = ?, thinking_ms = ?
     WHERE id = ?`,
    [
      message.content,
      message.reasoning ?? null,
      message.status,
      message.usage ? JSON.stringify(message.usage) : null,
      message.attachments && message.attachments.length > 0
        ? JSON.stringify(message.attachments)
        : null,
      message.toolCalls && message.toolCalls.length > 0
        ? JSON.stringify(message.toolCalls)
        : null,
      message.thinkingMs ?? null,
      message.id,
    ],
  );
}

export async function deleteMessage(id: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('DELETE FROM messages WHERE id = ?', [id]);
}

/** Used by edit-and-resend: everything created after the edited message goes. */
export async function deleteMessagesAfter(
  conversationId: string,
  after: { id: string; createdAt: number },
): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    'DELETE FROM messages WHERE conversation_id = ? AND (created_at > ? OR (created_at = ? AND id > ?))',
    [conversationId, after.createdAt, after.createdAt, after.id],
  );
}

export interface SearchHit {
  message: ChatMessage;
  conversationTitle: string;
}

export async function searchMessages(query: string, limit = 60): Promise<SearchHit[]> {
  const term = query.trim();
  if (term.length === 0) return [];
  const db = await getDatabase();
  const escaped = term.replace(/[%_\\]/g, (match) => `\\${match}`);
  const rows = await db.getAllAsync<MessageRow & { conversation_title: string }>(
    `SELECT m.*, c.title AS conversation_title
       FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
      WHERE m.content LIKE ? ESCAPE '\\'
      ORDER BY m.created_at DESC
      LIMIT ?`,
    [`%${escaped}%`, limit],
  );
  return rows.map((row) => ({
    message: toChatMessage(row),
    conversationTitle: row.conversation_title,
  }));
}
