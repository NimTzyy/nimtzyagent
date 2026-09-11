import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

import { ApiError, completeChat, isAbortError, streamChat } from '@/core/api';
import { buildRequestMessages, titleFromFirstMessage } from '@/core/messages';
import { resolveModel } from '@/core/models';
import {
  applyStreamEvent,
  beginRound,
  callsOf,
  createDraft,
  isToolRound,
  mergeCompletion,
} from '@/core/round';
import { buildTools, executeTool, toolPreamble, type ToolContext } from '@/core/tools';
import type {
  Attachment,
  ChatMessage,
  Conversation,
  MessageStatus,
  StreamEvent,
  ToolCall,
} from '@/core/types';
import * as conversationRepo from '@/db/conversations';
import * as messageRepo from '@/db/messages';
import { createId } from '@/lib/id';
import { hydrateAttachments } from '@/lib/images';
import { strings } from '@/lib/strings';

import { useSettings } from './settings';

/**
 * Streaming text is buffered and flushed on a timer rather than on every
 * delta: a fast model can emit hundreds of tokens per second, and re-rendering
 * the list that often is what makes chat clients stutter.
 */
const FLUSH_INTERVAL_MS = 40;
const DRAFT_PREFIX = 'nimtzyagent.draft.';

/**
 * How many times the model may ask for tool results in one turn. Without a
 * ceiling a model that keeps calling tools would bill the user for a loop it
 * cannot see the end of.
 */
const MAX_TOOL_ROUNDS = 4;

let controller: AbortController | null = null;
let draftTimer: ReturnType<typeof setTimeout> | null = null;

interface ChatState {
  conversationId: string | null;
  conversation: Conversation | null;
  messages: ChatMessage[];
  loading: boolean;
  streaming: boolean;
  error: string | null;
  draft: string;
  attachments: Attachment[];

  open: (conversationId: string) => Promise<void>;
  close: () => void;
  setDraft: (text: string) => void;
  addAttachments: (attachments: Attachment[]) => void;
  removeAttachment: (attachmentId: string) => void;
  setMessages: (messages: ChatMessage[]) => void;
  send: () => Promise<void>;
  stop: () => void;
  regenerate: () => Promise<void>;
  retry: (messageId: string) => Promise<void>;
  editAndResend: (messageId: string, text: string) => Promise<void>;
  removeMessage: (messageId: string) => Promise<void>;
  setError: (message: string | null) => void;
}

function persistDraft(conversationId: string, draft: string): void {
  if (draftTimer) clearTimeout(draftTimer);
  draftTimer = setTimeout(() => {
    AsyncStorage.setItem(`${DRAFT_PREFIX}${conversationId}`, draft).catch(() => undefined);
  }, 400);
}

async function readDraft(conversationId: string): Promise<string> {
  try {
    return (await AsyncStorage.getItem(`${DRAFT_PREFIX}${conversationId}`)) ?? '';
  } catch {
    return '';
  }
}

async function hydrateMessages(messages: ChatMessage[]): Promise<ChatMessage[]> {
  const hydrated: ChatMessage[] = [];
  for (const message of messages) {
    if (message.attachments && message.attachments.length > 0) {
      hydrated.push({ ...message, attachments: await hydrateAttachments(message.attachments) });
    } else {
      hydrated.push(message);
    }
  }
  return hydrated;
}

export const useChat = create<ChatState>((set, get) => {
  /**
   * Streams one assistant turn into an already-inserted placeholder row.
   *
   * A turn is not always one request. When tools are offered the model can
   * answer with calls instead of prose, and the turn carries on with their
   * results until it writes an answer. Every round writes into the same
   * bubble, so what the user reads is one answer with the steps it took.
   */
  const streamInto = async (assistantId: string): Promise<void> => {
    const conversation = get().conversation;
    if (!conversation) return;

    const { preferences, apiKey, searchApiKey, workspace } = useSettings.getState();
    const model = resolveModel(conversation.model, preferences.customModels);

    // A tool is only offered when it can actually run: research needs a
    // provider, the file tools need a folder the user has picked, and the model
    // has to accept tool definitions at all.
    const supported = model.tools !== false;
    const availability = {
      research: supported && preferences.researchEnabled,
      files: supported && preferences.agentEnabled && workspace !== null,
    };
    const tools = buildTools(availability);

    // One controller for the whole turn: stopping has to cut the request in
    // flight, the work between requests, and the next round alike.
    controller = new AbortController();
    const signal = controller.signal;
    const toolContext: ToolContext = {
      ...availability,
      searchProvider: preferences.searchProvider,
      searchApiKey,
      workspace,
      signal,
    };

    /** The turn's text, usage and the round in progress; see `core/round.ts`. */
    const draft = createDraft();
    let thinkingMs: number | undefined;
    let reasoningStartedAt: number | null = null;
    /** Calls that have run, with their results. */
    let finished: ToolCall[] = [];
    /** Calls of the round in progress, which have no result yet. */
    let active: ToolCall[] = [];

    let dirty = false;
    let flushTimer: ReturnType<typeof setTimeout> | null = null;

    const applyToState = (status: MessageStatus) => {
      const current = get().messages.find((message) => message.id === assistantId);
      if (!current) return;
      const calls = [...finished, ...active];
      const updated: ChatMessage = {
        ...current,
        content: draft.content,
        reasoning: draft.reasoning.length > 0 ? draft.reasoning : undefined,
        toolCalls: calls.length > 0 ? calls : undefined,
        usage: draft.usage,
        thinkingMs,
        status,
      };
      set((state) => ({
        messages: state.messages.map((message) => (message.id === assistantId ? updated : message)),
      }));
    };

    const flush = () => {
      flushTimer = null;
      if (!dirty) return;
      dirty = false;
      applyToState('complete');
    };

    const schedule = () => {
      dirty = true;
      if (!flushTimer) flushTimer = setTimeout(flush, FLUSH_INTERVAL_MS);
    };

    // Hydrated once: later rounds resend the same conversation, and rebuilding
    // image data URLs for each would be wasted work.
    const baseMessages = await hydrateMessages(get().messages);
    const messagesForRequest = (): ChatMessage[] =>
      baseMessages.map((message) =>
        message.id === assistantId
          ? {
              ...message,
              content: draft.content,
              reasoning: draft.reasoning.length > 0 ? draft.reasoning : undefined,
              toolCalls: [...finished, ...active],
            }
          : message,
      );

    const runRound = async (): Promise<void> => {
      beginRound(draft);

      const applyEvent = (event: StreamEvent) => {
        // How long the model spent thinking before it started answering.
        if (event.type === 'reasoning' && reasoningStartedAt === null) {
          reasoningStartedAt = Date.now();
        } else if (
          event.type === 'content' &&
          reasoningStartedAt !== null &&
          thinkingMs === undefined
        ) {
          thinkingMs = Date.now() - reasoningStartedAt;
        }

        applyStreamEvent(draft, event);

        if (event.type === 'content' || event.type === 'reasoning' || event.type === 'tool_call') {
          schedule();
        }
      };

      const request = buildRequestMessages({
        systemPrompt: conversation.systemPrompt,
        toolPreamble: toolPreamble(availability, workspace),
        messages: messagesForRequest(),
        model,
      });

      const params = {
        apiKey,
        baseUrl: preferences.baseUrl,
        model: model.id,
        messages: request,
        thinking: preferences.thinking,
        reasoningEffort: preferences.reasoningEffort,
        maxTokens: preferences.maxTokens ?? undefined,
        tools: tools.length > 0 ? tools : undefined,
        signal,
      };

      if (preferences.streaming) {
        await streamChat({ ...params, onEvent: applyEvent });
      } else {
        mergeCompletion(draft, await completeChat(params));
        applyToState('complete');
      }
    };

    const executeCalls = async (): Promise<void> => {
      for (let index = 0; index < active.length; index += 1) {
        if (signal.aborted) {
          active = active.map((entry, position) =>
            position >= index
              ? { ...entry, status: 'error', result: strings.agent.stopped }
              : entry,
          );
          break;
        }
        const entry = active[index];
        const outcome = await executeTool(entry.name, entry.arguments, toolContext);
        active = active.map((candidate, position) =>
          position === index
            ? { ...candidate, status: outcome.status, result: outcome.result }
            : candidate,
        );
        applyToState('complete');
      }

      finished = [...finished, ...active];
      active = [];

      // Persist each round, so a turn interrupted later still shows the steps
      // that already ran.
      const message = get().messages.find((candidate) => candidate.id === assistantId);
      if (message) await messageRepo.updateMessage(message).catch(() => undefined);
    };

    let status: MessageStatus = 'complete';
    let failure: string | null = null;
    let rounds = 0;
    let capped = false;

    try {
      for (;;) {
        await runRound();
        active = callsOf(draft);
        if (active.length > 0) applyToState('complete');

        if (
          draft.error &&
          active.length === 0 &&
          draft.content.length === 0 &&
          draft.reasoning.length === 0
        ) {
          status = 'error';
          failure = draft.error;
          break;
        }

        // Whether the round asked for tools, and whether the calls it described
        // arrived whole. See `core/round.ts` for why the finish reason alone is
        // not the answer.
        if (!isToolRound(draft)) break;
        if (rounds >= MAX_TOOL_ROUNDS) {
          capped = true;
          break;
        }
        rounds += 1;

        await executeCalls();
        if (signal.aborted) {
          status = 'stopped';
          break;
        }
      }
    } catch (error) {
      if (isAbortError(error)) {
        status = 'stopped';
      } else {
        status = 'error';
        failure = error instanceof ApiError ? error.message : strings.errors.streamFailed;
      }
    } finally {
      if (flushTimer) clearTimeout(flushTimer);
      flushTimer = null;
      dirty = false;
      controller = null;

      // Calls that never ran are recorded as such rather than left pending,
      // which would hide them from the request and from the user. The reason
      // matters: a stopped turn, a turn that hit the round cap, and a call the
      // API never finished describing are different things to see.
      if (active.length > 0) {
        const reason = signal.aborted
          ? strings.agent.stopped
          : capped
            ? strings.agent.roundLimit
            : strings.agent.incompleteCall;
        active = active.map((entry) =>
          entry.status === 'pending' ? { ...entry, status: 'error', result: reason } : entry,
        );
        finished = [...finished, ...active];
        active = [];
      }

      applyToState(status);

      const finalMessage = get().messages.find((message) => message.id === assistantId);
      if (finalMessage) {
        await messageRepo.updateMessage(finalMessage).catch(() => undefined);
      }
      await conversationRepo.touchConversation(conversation.id).catch(() => undefined);

      set({ streaming: false, error: failure });
    }
  };

  /** Inserts the assistant placeholder, then fills it. */
  const startAssistantTurn = async (): Promise<void> => {
    const conversation = get().conversation;
    if (!conversation) return;
    const { preferences } = useSettings.getState();
    const model = resolveModel(conversation.model, preferences.customModels);

    const last = get().messages[get().messages.length - 1];
    const createdAt = last ? last.createdAt + 1 : Date.now();
    const placeholder: ChatMessage = {
      id: createId(createdAt),
      conversationId: conversation.id,
      role: 'assistant',
      content: '',
      model: model.id,
      status: 'complete',
      createdAt,
    };
    await messageRepo.insertMessage(placeholder);
    set((state) => ({ messages: [...state.messages, placeholder], streaming: true, error: null }));
    await streamInto(placeholder.id);
  };

  const removeAssistant = async (messageId: string): Promise<void> => {
    await messageRepo.deleteMessage(messageId);
    set((state) => ({ messages: state.messages.filter((message) => message.id !== messageId) }));
  };

  return {
    conversationId: null,
    conversation: null,
    messages: [],
    loading: false,
    streaming: false,
    error: null,
    draft: '',
    attachments: [],

    open: async (conversationId) => {
      if (get().conversationId === conversationId) return;
      controller?.abort();
      controller = null;
      set({ loading: true, error: null, attachments: [], draft: '' });
      const conversation = await conversationRepo.getConversation(conversationId);
      if (!conversation) {
        set({ loading: false, conversationId: null, conversation: null, messages: [] });
        return;
      }
      const [messages, draft] = await Promise.all([
        messageRepo.listMessages(conversationId),
        readDraft(conversationId),
      ]);
      set({
        conversationId,
        conversation,
        messages,
        draft,
        loading: false,
        streaming: false,
        error: null,
      });
    },

    close: () => {
      controller?.abort();
      controller = null;
      set({
        conversationId: null,
        conversation: null,
        messages: [],
        loading: false,
        streaming: false,
        error: null,
        draft: '',
        attachments: [],
      });
    },

    setDraft: (text) => {
      set({ draft: text });
      const id = get().conversationId;
      if (id) persistDraft(id, text);
    },

    addAttachments: (attachments) =>
      set((state) => ({ attachments: [...state.attachments, ...attachments] })),

    removeAttachment: (attachmentId) =>
      set((state) => ({
        attachments: state.attachments.filter((attachment) => attachment.id !== attachmentId),
      })),

    setMessages: (messages) => set({ messages }),

    send: async () => {
      const state = get();
      const conversation = state.conversation;
      if (!conversation || state.streaming) return;

      const text = state.draft.trim();
      const attachments = state.attachments;
      if (text.length === 0 && attachments.length === 0) return;

      const { hasApiKey } = useSettings.getState();
      if (!hasApiKey) {
        set({ error: strings.chat.noKey });
        return;
      }

      const wasEmpty = state.messages.length === 0;
      const now = Date.now();
      const userMessage: ChatMessage = {
        id: createId(now),
        conversationId: conversation.id,
        role: 'user',
        content: text,
        status: 'complete',
        attachments: attachments.length > 0 ? attachments : undefined,
        createdAt: now,
      };

      await messageRepo.insertMessage(userMessage);
      set({ messages: [...state.messages, userMessage], draft: '', attachments: [] });
      persistDraft(conversation.id, '');

      if (wasEmpty) {
        const title = titleFromFirstMessage(text || attachments[0]?.name || '');
        await conversationRepo.updateConversation(conversation.id, { title });
        set((current) => ({
          conversation: current.conversation ? { ...current.conversation, title } : null,
        }));
      }

      await startAssistantTurn();
    },

    stop: () => {
      controller?.abort();
    },

    regenerate: async () => {
      const state = get();
      if (state.streaming || !state.conversation) return;
      const lastAssistant = [...state.messages].reverse().find((message) => message.role === 'assistant');
      if (lastAssistant) await removeAssistant(lastAssistant.id);
      await startAssistantTurn();
    },

    retry: async (messageId) => {
      const state = get();
      if (state.streaming || !state.conversation) return;
      const message = state.messages.find((candidate) => candidate.id === messageId);
      if (!message) return;
      if (message.role === 'assistant') {
        await removeAssistant(messageId);
      }
      await startAssistantTurn();
    },

    editAndResend: async (messageId, text) => {
      const state = get();
      const conversation = state.conversation;
      if (!conversation || state.streaming) return;
      const index = state.messages.findIndex((message) => message.id === messageId);
      if (index < 0) return;
      const target = state.messages[index];
      if (target.role !== 'user') return;

      const edited: ChatMessage = { ...target, content: text };
      await messageRepo.deleteMessagesAfter(conversation.id, {
        id: target.id,
        createdAt: target.createdAt,
      });
      await messageRepo.updateMessage(edited);
      set({ messages: [...state.messages.slice(0, index), edited], error: null });
      await startAssistantTurn();
    },

    removeMessage: async (messageId) => {
      const state = get();
      if (state.streaming) return;
      await messageRepo.deleteMessage(messageId);
      set({ messages: state.messages.filter((message) => message.id !== messageId) });
    },

    setError: (message) => set({ error: message }),
  };
});
