import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { resolveModel } from '@/core/models';
import type { ChatMessage, Conversation, ModelInfo } from '@/core/types';
import * as messageRepo from '@/db/messages';
import { strings } from './strings';

export type ExportFormat = 'markdown' | 'json';

function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug.length > 0 ? slug : 'conversation';
}

function speakerFor(message: ChatMessage): string {
  return message.role === 'user' ? 'You' : 'Assistant';
}

function attachmentNote(message: ChatMessage): string[] {
  return (message.attachments ?? []).map((attachment) =>
    attachment.kind === 'image' ? `[image: ${attachment.name}]` : `[file: ${attachment.name}]`,
  );
}

export function conversationToMarkdown(
  conversation: Conversation,
  messages: ChatMessage[],
  customModels: ModelInfo[] = [],
): string {
  const model = resolveModel(conversation.model, customModels);
  const lines: string[] = [
    `# ${conversation.title}`,
    '',
    `Model: ${model.label}. Exported ${new Date().toISOString()}.`,
    '',
  ];

  for (const message of messages) {
    lines.push(`## ${speakerFor(message)}`, '');
    for (const note of attachmentNote(message)) lines.push(note);
    if (message.content.length > 0) lines.push(message.content);
    if (message.reasoning) {
      lines.push('', '<details><summary>Reasoning</summary>', '', message.reasoning, '', '</details>');
    }
    lines.push('');
  }

  return lines.join('\n');
}

export function conversationToJson(conversation: Conversation, messages: ChatMessage[]): string {
  return JSON.stringify(
    {
      conversation: {
        id: conversation.id,
        title: conversation.title,
        model: conversation.model,
        systemPrompt: conversation.systemPrompt ?? null,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
      },
      messages: messages.map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content,
        reasoning: message.reasoning ?? null,
        model: message.model ?? null,
        status: message.status,
        usage: message.usage ?? null,
        thinkingMs: message.thinkingMs ?? null,
        createdAt: message.createdAt,
        attachments: (message.attachments ?? []).map((attachment) => ({
          name: attachment.name,
          kind: attachment.kind,
          mime: attachment.mime,
          size: attachment.size,
        })),
      })),
    },
    null,
    2,
  );
}

/** Writes the conversation to the cache directory and opens the share sheet. */
export async function shareConversation(
  conversation: Conversation,
  format: ExportFormat,
  customModels: ModelInfo[] = [],
): Promise<{ shared: boolean; error?: string }> {
  const messages = await messageRepo.listMessages(conversation.id);
  if (messages.length === 0) return { shared: false, error: strings.conversations.exportEmpty };

  const extension = format === 'markdown' ? 'md' : 'json';
  const body =
    format === 'markdown'
      ? conversationToMarkdown(conversation, messages, customModels)
      : conversationToJson(conversation, messages);

  const file = new File(Paths.cache, `${slugify(conversation.title)}.${extension}`);
  if (file.exists) file.delete();
  file.create({ intermediates: true });
  file.write(body);

  if (!(await Sharing.isAvailableAsync())) {
    return { shared: false, error: strings.settings.shareUnavailable };
  }

  await Sharing.shareAsync(file.uri, {
    mimeType: format === 'markdown' ? 'text/markdown' : 'application/json',
    UTI: format === 'markdown' ? 'net.daringfireball.markdown' : 'public.json',
    dialogTitle: conversation.title,
  });
  return { shared: true };
}

/** Exports every conversation into a single JSON document. */
export async function exportAllConversations(
  conversations: Conversation[],
): Promise<{ shared: boolean; error?: string }> {
  const payload = [];
  for (const conversation of conversations) {
    const messages = await messageRepo.listMessages(conversation.id);
    payload.push(JSON.parse(conversationToJson(conversation, messages)) as unknown);
  }

  const file = new File(Paths.cache, `nimtzyagent-export-${Date.now()}.json`);
  if (file.exists) file.delete();
  file.create({ intermediates: true });
  file.write(JSON.stringify({ exportedAt: new Date().toISOString(), conversations: payload }, null, 2));

  if (!(await Sharing.isAvailableAsync())) {
    return { shared: false, error: strings.settings.shareUnavailable };
  }
  await Sharing.shareAsync(file.uri, {
    mimeType: 'application/json',
    UTI: 'public.json',
    dialogTitle: strings.settings.exportAll,
  });
  return { shared: true };
}
