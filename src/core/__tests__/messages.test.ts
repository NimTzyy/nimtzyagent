import {
  attachmentToTextBlock,
  buildRequestMessages,
  fenceFor,
  titleFromFirstMessage,
} from '../messages';
import { resolveModel } from '../models';
import type { Attachment, ChatMessage } from '../types';

const visionModel = resolveModel('deepseek-flash');
const textOnlyModel = resolveModel('deepseek-v4-pro');

function message(partial: Partial<ChatMessage> & Pick<ChatMessage, 'role' | 'content'>): ChatMessage {
  return {
    id: partial.id ?? `id-${Math.random().toString(36).slice(2)}`,
    conversationId: 'c1',
    status: partial.status ?? 'complete',
    createdAt: partial.createdAt ?? 1,
    ...partial,
  };
}

const image: Attachment = {
  id: 'img1',
  kind: 'image',
  name: 'photo.jpg',
  mime: 'image/jpeg',
  size: 1024,
  uri: 'file:///photo.jpg',
  dataUrl: 'data:image/jpeg;base64,AAAA',
};

describe('fenceFor', () => {
  it('uses three backticks for plain content', () => {
    expect(fenceFor('plain text')).toBe('```');
  });

  it('outgrows a fence already inside the content', () => {
    expect(fenceFor('```\ninner\n```')).toBe('````');
  });
});

describe('attachmentToTextBlock', () => {
  it('labels the block and tags the fence with the file language', () => {
    const block = attachmentToTextBlock({
      id: 'f1',
      kind: 'text',
      name: 'notes.md',
      mime: 'text/markdown',
      size: 10,
      uri: 'file:///notes.md',
      text: '# Heading',
    });
    expect(block).toBe('notes.md\n```markdown\n# Heading\n```');
  });

  it('ignores an image attachment', () => {
    expect(attachmentToTextBlock(image)).toBeNull();
  });
});

describe('buildRequestMessages', () => {
  it('puts the system prompt first', () => {
    const request = buildRequestMessages({
      systemPrompt: 'Be brief.',
      messages: [message({ role: 'user', content: 'Hi' })],
      model: visionModel,
    });
    expect(request[0]).toEqual({ role: 'system', content: 'Be brief.' });
  });

  it('omits a blank system prompt', () => {
    const request = buildRequestMessages({
      systemPrompt: '   ',
      messages: [message({ role: 'user', content: 'Hi' })],
      model: visionModel,
    });
    expect(request).toHaveLength(1);
  });

  it('keeps user and assistant turns in order', () => {
    const request = buildRequestMessages({
      messages: [
        message({ role: 'user', content: 'One' }),
        message({ role: 'assistant', content: 'Two' }),
        message({ role: 'user', content: 'Three' }),
      ],
      model: visionModel,
    });
    expect(request.map((entry) => entry.role)).toEqual(['user', 'assistant', 'user']);
  });

  it('never sends reasoning back', () => {
    const request = buildRequestMessages({
      messages: [message({ role: 'assistant', content: 'Answer', reasoning: 'Long internal trace' })],
      model: visionModel,
    });
    expect(JSON.stringify(request)).not.toContain('Long internal trace');
  });

  it('drops a failed assistant turn', () => {
    const request = buildRequestMessages({
      messages: [
        message({ role: 'user', content: 'One' }),
        message({ role: 'assistant', content: 'partial', status: 'error' }),
      ],
      model: visionModel,
    });
    expect(request).toHaveLength(1);
  });

  it('keeps a stopped assistant turn that has content', () => {
    const request = buildRequestMessages({
      messages: [message({ role: 'assistant', content: 'partial', status: 'stopped' })],
      model: visionModel,
    });
    expect(request).toHaveLength(1);
  });

  it('drops an empty assistant turn', () => {
    const request = buildRequestMessages({
      messages: [message({ role: 'assistant', content: '   ' })],
      model: visionModel,
    });
    expect(request).toHaveLength(0);
  });

  it('skips any stored system turn', () => {
    const request = buildRequestMessages({
      messages: [message({ role: 'system', content: 'ignored' })],
      model: visionModel,
    });
    expect(request).toHaveLength(0);
  });

  it('sends images as content blocks for a vision model', () => {
    const request = buildRequestMessages({
      messages: [message({ role: 'user', content: 'What is this?', attachments: [image] })],
      model: visionModel,
    });
    expect(request[0].content).toEqual([
      { type: 'text', text: 'What is this?' },
      { type: 'image_url', image_url: { url: image.dataUrl, detail: 'auto' } },
    ]);
  });

  it('omits the text block when the turn is only an image', () => {
    const request = buildRequestMessages({
      messages: [message({ role: 'user', content: '', attachments: [image] })],
      model: visionModel,
    });
    expect(request[0].content).toEqual([
      { type: 'image_url', image_url: { url: image.dataUrl, detail: 'auto' } },
    ]);
  });

  it('drops images for a model without vision support', () => {
    const request = buildRequestMessages({
      messages: [message({ role: 'user', content: 'What is this?', attachments: [image] })],
      model: textOnlyModel,
    });
    expect(request[0].content).toBe('What is this?');
  });

  it('drops an image whose data URL was never built', () => {
    const request = buildRequestMessages({
      messages: [
        message({ role: 'user', content: 'Look', attachments: [{ ...image, dataUrl: undefined }] }),
      ],
      model: visionModel,
    });
    expect(request[0].content).toBe('Look');
  });

  it('inlines a text attachment into the prompt', () => {
    const request = buildRequestMessages({
      messages: [
        message({
          role: 'user',
          content: 'Review this',
          attachments: [
            {
              id: 'f1',
              kind: 'text',
              name: 'a.ts',
              mime: 'text/typescript',
              size: 5,
              uri: 'file:///a.ts',
              text: 'const a = 1;',
            },
          ],
        }),
      ],
      model: visionModel,
    });
    expect(request[0].content).toBe('Review this\n\na.ts\n```typescript\nconst a = 1;\n```');
  });

  it('drops a user turn that carries nothing sendable', () => {
    const request = buildRequestMessages({
      messages: [message({ role: 'user', content: '' })],
      model: visionModel,
    });
    expect(request).toHaveLength(0);
  });
});

describe('buildRequestMessages with tool calls', () => {
  const assistantTurn = () =>
    message({
      role: 'assistant',
      content: '',
      toolCalls: [
        {
          id: 'call_1',
          name: 'search_web',
          arguments: '{"query":"deepseek"}',
          result: 'Result: DeepSeek shipped V4.1.',
          status: 'ok',
        },
      ],
    });

  it('keeps a tool turn whose content is empty', () => {
    const request = buildRequestMessages({ messages: [assistantTurn()], model: visionModel });
    expect(request).toHaveLength(2);
    expect(request[0].role).toBe('assistant');
  });

  it('sends the call as tool_calls and the outcome as a tool message', () => {
    const request = buildRequestMessages({ messages: [assistantTurn()], model: visionModel });
    expect(request[0].tool_calls).toEqual([
      {
        id: 'call_1',
        type: 'function',
        function: { name: 'search_web', arguments: '{"query":"deepseek"}' },
      },
    ]);
    expect(request[1]).toEqual({
      role: 'tool',
      tool_call_id: 'call_1',
      content: 'Result: DeepSeek shipped V4.1.',
    });
  });

  it('omits a call that never ran, so no id is left unanswered', () => {
    const pending = message({
      role: 'assistant',
      content: 'thinking about it',
      toolCalls: [{ id: 'call_9', name: 'search_web', arguments: '{}', status: 'pending' }],
    });
    const request = buildRequestMessages({ messages: [pending], model: visionModel });
    expect(request).toHaveLength(1);
    expect(request[0].tool_calls).toBeUndefined();
  });

  it('drops a tool turn whose calls all failed to run', () => {
    const pending = message({
      role: 'assistant',
      content: '',
      toolCalls: [{ id: 'call_9', name: 'search_web', arguments: '{}', status: 'pending' }],
    });
    expect(buildRequestMessages({ messages: [pending], model: visionModel })).toHaveLength(0);
  });

  it('replays reasoning on a tool turn, which thinking mode requires', () => {
    const turn = message({
      role: 'assistant',
      content: '',
      reasoning: 'Weighed the options.',
      toolCalls: [
        { id: 'call_1', name: 'search_web', arguments: '{"query":"x"}', result: 'ok', status: 'ok' },
      ],
    });
    const request = buildRequestMessages({ messages: [turn], model: visionModel });
    expect(request[0].reasoning_content).toBe('Weighed the options.');
  });

  it('leaves reasoning out of an ordinary turn, since sending it only costs', () => {
    const turn = message({
      role: 'assistant',
      content: 'Answer.',
      reasoning: 'Weighed the options.',
    });
    const request = buildRequestMessages({ messages: [turn], model: visionModel });
    expect(request[0].reasoning_content).toBeUndefined();
  });

  it('sends several calls in order, each answered by its own message', () => {
    const turn = message({
      role: 'assistant',
      content: '',
      toolCalls: [
        { id: 'a', name: 'create_folder', arguments: '{"path":"app"}', result: 'Created.', status: 'ok' },
        { id: 'b', name: 'write_file', arguments: '{"path":"app/x.txt"}', result: 'Written.', status: 'ok' },
      ],
    });
    const request = buildRequestMessages({ messages: [turn], model: visionModel });
    expect(request.map((entry) => entry.role)).toEqual(['assistant', 'tool', 'tool']);
    expect(request[1].tool_call_id).toBe('a');
    expect(request[2].tool_call_id).toBe('b');
  });
});

describe('titleFromFirstMessage', () => {
  it('uses the first non-empty line and strips markdown punctuation', () => {
    expect(titleFromFirstMessage('\n## **Trip** to _Kyoto_\nmore')).toBe('Trip to Kyoto');
  });

  it('truncates a long title', () => {
    const title = titleFromFirstMessage('word '.repeat(40));
    expect(title.length).toBeLessThanOrEqual(60);
    expect(title.endsWith('...')).toBe(true);
  });

  it('falls back when there is nothing to use', () => {
    expect(titleFromFirstMessage('   \n  ')).toBe('New chat');
  });
});

describe('the tool preamble', () => {
  it('is appended to the system prompt, not put in place of it', () => {
    const request = buildRequestMessages({
      systemPrompt: 'Answer in short paragraphs.',
      toolPreamble: 'You can write files.',
      messages: [message({ role: 'user', content: 'hi' })],
      model: textOnlyModel,
    });

    expect(request[0].role).toBe('system');
    expect(request[0].content).toBe('Answer in short paragraphs.\n\nYou can write files.');
  });

  it('is sent on its own when the user set no prompt', () => {
    const request = buildRequestMessages({
      toolPreamble: 'You can write files.',
      messages: [message({ role: 'user', content: 'hi' })],
      model: textOnlyModel,
    });

    expect(request[0]).toEqual({ role: 'system', content: 'You can write files.' });
  });

  it('leaves an ordinary chat without a system message', () => {
    const request = buildRequestMessages({
      toolPreamble: null,
      messages: [message({ role: 'user', content: 'hi' })],
      model: textOnlyModel,
    });

    expect(request.map((entry) => entry.role)).toEqual(['user']);
  });
});
