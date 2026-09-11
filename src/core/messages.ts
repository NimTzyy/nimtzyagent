import { languageFromFilename } from './language';
import type { Attachment, ChatMessage, ModelInfo, RequestContentBlock, RequestMessage } from './types';

/** Guards an inlined text file from blowing past sane request sizes. */
export const MAX_INLINE_ATTACHMENT_CHARS = 200_000;

/** A fence at least one backtick longer than the longest run inside the body. */
export function fenceFor(content: string): string {
  const runs = content.match(/`+/g) ?? [];
  const longest = runs.reduce((max, run) => Math.max(max, run.length), 0);
  return '`'.repeat(Math.max(3, longest + 1));
}

export function attachmentToTextBlock(attachment: Attachment): string | null {
  if (attachment.kind !== 'text' || typeof attachment.text !== 'string') return null;
  const body =
    attachment.text.length > MAX_INLINE_ATTACHMENT_CHARS
      ? `${attachment.text.slice(0, MAX_INLINE_ATTACHMENT_CHARS)}\n[truncated]`
      : attachment.text;
  const fence = fenceFor(body);
  const language = languageFromFilename(attachment.name) ?? '';
  return `${attachment.name}\n${fence}${language}\n${body}\n${fence}`;
}

export interface BuildRequestInput {
  systemPrompt?: string;
  /**
   * What the app has switched on for this turn, appended to the system prompt
   * rather than replacing it: the user's own instructions come first and this
   * only says which tools exist to carry them out.
   */
  toolPreamble?: string | null;
  messages: ChatMessage[];
  model: ModelInfo;
}

/**
 * Turn stored conversation state into the wire format.
 *
 * Tool results are stored on the assistant message that asked for them, but
 * the wire wants each one as its own `role: "tool"` message in call order, so
 * they are unpacked here. Failed and empty assistant turns are dropped, except
 * tool turns, whose content is legitimately empty.
 */
export function buildRequestMessages({
  systemPrompt,
  toolPreamble,
  messages,
  model,
}: BuildRequestInput): RequestMessage[] {
  const out: RequestMessage[] = [];
  const system = [systemPrompt?.trim(), toolPreamble?.trim()].filter(Boolean).join('\n\n');
  if (system) out.push({ role: 'system', content: system });

  for (const message of messages) {
    if (message.role === 'system') continue;

    if (message.role === 'assistant') {
      if (message.status === 'error') continue;
      // A call that never ran carries no result to report, and leaving it out
      // would put a tool_calls id in the request with no reply to it.
      const calls = (message.toolCalls ?? []).filter((call) => call.status !== 'pending');
      if (!message.content.trim() && calls.length === 0) continue;

      out.push({
        role: 'assistant',
        content: message.content,
        // A turn that asked for tools must replay its reasoning: thinking mode
        // rejects a follow-up that dropped it with a 400. Ordinary turns are
        // not required to carry it, and not sending it saves tokens.
        ...(message.reasoning && calls.length > 0
          ? { reasoning_content: message.reasoning }
          : {}),
        ...(calls.length > 0
          ? {
              tool_calls: calls.map((call) => ({
                id: call.id,
                type: 'function' as const,
                function: { name: call.name, arguments: call.arguments },
              })),
            }
          : {}),
      });

      for (const call of calls) {
        out.push({ role: 'tool', tool_call_id: call.id, content: call.result ?? '' });
      }
      continue;
    }

    const textParts: string[] = [];
    if (message.content.trim()) textParts.push(message.content);
    for (const attachment of message.attachments ?? []) {
      const block = attachmentToTextBlock(attachment);
      if (block) textParts.push(block);
    }

    const images = (message.attachments ?? []).filter(
      (attachment) => attachment.kind === 'image' && !!attachment.dataUrl,
    );

    if (model.vision && images.length > 0) {
      const blocks: RequestContentBlock[] = [];
      if (textParts.length > 0) blocks.push({ type: 'text', text: textParts.join('\n\n') });
      for (const image of images) {
        blocks.push({ type: 'image_url', image_url: { url: image.dataUrl!, detail: 'auto' } });
      }
      out.push({ role: 'user', content: blocks });
      continue;
    }

    // Without vision support the images are intentionally omitted; the composer
    // warns before a turn is sent in that state.
    const text = textParts.join('\n\n');
    if (text.length > 0) out.push({ role: 'user', content: text });
  }

  return out;
}

export function titleFromFirstMessage(content: string): string {
  const line = content
    .split('\n')
    .map((part) => part.trim())
    .find((part) => part.length > 0);
  if (!line) return 'New chat';
  const cleaned = line
    .replace(/^#{1,6}\s+/, '')
    .replace(/[*_`>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned.length <= 60) return cleaned;
  return `${cleaned.slice(0, 57).trimEnd()}...`;
}
