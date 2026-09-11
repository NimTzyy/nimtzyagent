import { createId } from '@/lib/id';
import { strings } from '@/lib/strings';
import type { Conversation } from '@/core/types';

import { getDatabase } from './index';

interface ConversationRow {
  id: string;
  title: string;
  system_prompt: string | null;
  preset_id: string | null;
  model: string;
  pinned: number;
  created_at: number;
  updated_at: number;
}

interface SummaryRow extends ConversationRow {
  message_count: number;
  last_message: string | null;
}

export interface ConversationSummary extends Conversation {
  messageCount: number;
  lastMessage: string | null;
}

function toConversation(row: ConversationRow): Conversation {
  return {
    id: row.id,
    title: row.title,
    systemPrompt: row.system_prompt ?? undefined,
    presetId: row.preset_id ?? undefined,
    model: row.model,
    pinned: row.pinned === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listConversations(): Promise<ConversationSummary[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<SummaryRow>(`
    SELECT c.*,
      (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS message_count,
      (SELECT m.content FROM messages m WHERE m.conversation_id = c.id
        ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS last_message
    FROM conversations c
    ORDER BY c.pinned DESC, c.updated_at DESC
  `);
  return rows.map((row) => ({
    ...toConversation(row),
    messageCount: row.message_count,
    lastMessage: row.last_message,
  }));
}

export async function getConversation(id: string): Promise<Conversation | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<ConversationRow>(
    'SELECT * FROM conversations WHERE id = ?',
    [id],
  );
  return row ? toConversation(row) : null;
}

export async function createConversation(input: {
  model: string;
  systemPrompt?: string;
  presetId?: string;
}): Promise<Conversation> {
  const db = await getDatabase();
  const now = Date.now();
  const conversation: Conversation = {
    id: createId(now),
    title: strings.conversations.newChat,
    systemPrompt: input.systemPrompt,
    presetId: input.presetId,
    model: input.model,
    pinned: false,
    createdAt: now,
    updatedAt: now,
  };
  await db.runAsync(
    `INSERT INTO conversations (id, title, system_prompt, preset_id, model, pinned, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
    [
      conversation.id,
      conversation.title,
      conversation.systemPrompt ?? null,
      conversation.presetId ?? null,
      conversation.model,
      now,
      now,
    ],
  );
  return conversation;
}

export async function updateConversation(
  id: string,
  patch: Partial<Pick<Conversation, 'title' | 'model' | 'pinned' | 'systemPrompt' | 'presetId'>>,
): Promise<void> {
  const db = await getDatabase();
  const assignments: string[] = [];
  const values: (string | number | null)[] = [];

  if (patch.title !== undefined) {
    assignments.push('title = ?');
    values.push(patch.title);
  }
  if (patch.model !== undefined) {
    assignments.push('model = ?');
    values.push(patch.model);
  }
  if (patch.pinned !== undefined) {
    assignments.push('pinned = ?');
    values.push(patch.pinned ? 1 : 0);
  }
  if (patch.systemPrompt !== undefined) {
    assignments.push('system_prompt = ?');
    values.push(patch.systemPrompt ?? null);
  }
  if (patch.presetId !== undefined) {
    assignments.push('preset_id = ?');
    values.push(patch.presetId ?? null);
  }
  if (assignments.length === 0) return;

  assignments.push('updated_at = ?');
  values.push(Date.now(), id);
  await db.runAsync(`UPDATE conversations SET ${assignments.join(', ')} WHERE id = ?`, values);
}

export async function touchConversation(id: string, at: number = Date.now()): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('UPDATE conversations SET updated_at = ? WHERE id = ?', [at, id]);
}

export async function deleteConversation(id: string): Promise<void> {
  const db = await getDatabase();
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM messages WHERE conversation_id = ?', [id]);
    await db.runAsync('DELETE FROM conversations WHERE id = ?', [id]);
  });
}

export async function deleteAllConversations(): Promise<void> {
  const db = await getDatabase();
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM messages');
    await db.runAsync('DELETE FROM conversations');
  });
}
