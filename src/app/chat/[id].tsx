import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Network from 'expo-network';
import React, { useCallback, useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, Text, View } from 'react-native';
import {
  KeyboardAvoidingView as InsetKeyboardAvoidingView,
  useKeyboardState,
} from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { resolveModel } from '@/core/models';
import type { ChatMessage } from '@/core/types';
import * as conversationRepo from '@/db/conversations';
import { strings } from '@/lib/strings';
import { checkWorkspaceAccess } from '@/lib/workspace';
import { useChat } from '@/state/chat';
import { useSettings } from '@/state/settings';
import { Banner, EmptyState, Sheet } from '@/ui/components/Basic';
import { ConfirmSheet, PromptSheet } from '@/ui/components/Dialogs';
import { Composer } from '@/ui/components/Composer';
import { MessageList } from '@/ui/components/MessageList';
import {
  Globe,
  RefreshCw,
  Settings,
  Share2,
  Trash,
  Pencil,
} from '@/ui/components/icons';
import { ScreenHeader } from '@/ui/components/ScreenHeader';
import { useTheme } from '@/ui/components/ThemeProvider';

export default function ChatScreen(): React.ReactElement {
  const theme = useTheme();
  const { palette, spacing } = theme;
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const conversation = useChat((state) => state.conversation);
  const messages = useChat((state) => state.messages);
  const streaming = useChat((state) => state.streaming);
  const error = useChat((state) => state.error);
  const setError = useChat((state) => state.setError);
  const open = useChat((state) => state.open);
  const close = useChat((state) => state.close);
  const regenerate = useChat((state) => state.regenerate);
  const removeMessage = useChat((state) => state.removeMessage);
  const editAndResend = useChat((state) => state.editAndResend);

  const preferences = useSettings((state) => state.preferences);
  const hasApiKey = useSettings((state) => state.hasApiKey);
  const updatePreferences = useSettings((state) => state.updatePreferences);
  const workspace = useSettings((state) => state.workspace);
  const chooseWorkspace = useSettings((state) => state.chooseWorkspace);
  const network = Network.useNetworkState();

  const [target, setTarget] = useState<ChatMessage | null>(null);
  const [editing, setEditing] = useState<ChatMessage | null>(null);
  const [deleting, setDeleting] = useState<ChatMessage | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [folderError, setFolderError] = useState<string | null>(null);
  /** The uri that last failed to open, so a re-pick clears the warning by itself. */
  const [unreachable, setUnreachable] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    void open(id);
    return () => close();
  }, [close, id, open]);

  // A stored folder can stop answering — it was deleted, or it was on a card
  // that is no longer mounted. Saying so here keeps the file tools from failing
  // one call at a time in the middle of a turn.
  useEffect(() => {
    if (!workspace) return;
    let active = true;
    void checkWorkspaceAccess(workspace).then((ok) => {
      if (active) setUnreachable(ok ? null : workspace.uri);
    });
    return () => {
      active = false;
    };
  }, [workspace]);

  const workspaceLost = workspace !== null && unreachable === workspace.uri;

  const pickFolder = useCallback(async () => {
    setFolderError(null);
    const result = await chooseWorkspace();
    if (result.status === 'error') setFolderError(result.message);
  }, [chooseWorkspace]);

  const commitTitle = useCallback(
    async (value: string) => {
      const next = value.trim();
      setRenaming(false);
      if (!conversation || next.length === 0 || next === conversation.title) return;
      await conversationRepo.updateConversation(conversation.id, { title: next });
      useChat.setState({
        conversation: { ...conversation, title: next },
      });
    },
    [conversation],
  );

  const modelLabel = useCallback(
    (message: ChatMessage) =>
      resolveModel(message.model ?? conversation?.model ?? preferences.defaultModel, preferences.customModels)
        .label,
    [conversation?.model, preferences.customModels, preferences.defaultModel],
  );

  const copy = useCallback(
    async (text: string) => {
      setTarget(null);
      await Clipboard.setStringAsync(text);
    },
    [],
  );

  const offline = network.isConnected === false || network.isInternetReachable === false;

  /**
   * What to say about the agent folder, if anything.
   *
   * On Android there is no file permission to grant: the picker itself hands
   * the app a grant for the folder the user chose, and that grant is what turns
   * the file tools on. So when the tools are enabled and no folder has been
   * chosen, the asking has to happen here — otherwise the switch reads as on
   * while the model silently has no file tools at all.
   */
  const folderNotice =
    !preferences.agentEnabled || !hasApiKey
      ? null
      : (folderError ??
        (!workspace
          ? strings.agent.needsFolder
          : workspaceLost
            ? strings.agent.accessLost
            : null));

  return (
    <View style={{ flex: 1, backgroundColor: palette.background }}>
      <ScreenHeader
        title={conversation?.title ?? strings.appName}
        subtitle={conversation ? resolveModel(conversation.model, preferences.customModels).label : undefined}
        showBack
        onTitlePress={() => setRenaming(true)}
        right={
          <>
            <Pressable
              onPress={() => void updatePreferences({ researchEnabled: !preferences.researchEnabled })}
              accessibilityRole="button"
              accessibilityLabel={strings.research.toggle}
              accessibilityState={{ selected: preferences.researchEnabled }}
              hitSlop={8}
              style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, padding: 6 })}
            >
              <Globe
                size={19}
                color={preferences.researchEnabled ? palette.accent : palette.textSecondary}
                strokeWidth={1.5}
              />
            </Pressable>
            <Pressable
              onPress={() => router.push('/settings')}
              accessibilityRole="button"
              accessibilityLabel={strings.settings.title}
              hitSlop={8}
              style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, padding: 6 })}
            >
              <Settings size={19} color={palette.textSecondary} strokeWidth={1.5} />
            </Pressable>
          </>
        }
      />

      {offline ? (
        <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.md }}>
          <Banner message={strings.errors.offlineBody} />
        </View>
      ) : null}

      {!hasApiKey ? (
        <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.md }}>
          <Banner
            message={strings.chat.noKey}
            actionLabel={strings.chat.openSettings}
            onAction={() => router.push('/settings')}
          />
        </View>
      ) : null}

      {error ? (
        <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.md }}>
          <Banner
            message={error}
            actionLabel={strings.common.retry}
            onAction={() => {
              setError(null);
              void regenerate();
            }}
            onDismiss={() => setError(null)}
          />
        </View>
      ) : null}

      {folderNotice ? (
        <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.md }}>
          <Banner
            message={folderNotice}
            actionLabel={strings.agent.choose}
            onAction={() => void pickFolder()}
          />
        </View>
      ) : null}

      <KeyboardBoundary>
        <MessageList
          messages={messages}
          streaming={streaming}
          modelLabel={modelLabel}
          onLongPressMessage={setTarget}
          ListEmptyComponent={
            <EmptyState title={strings.chat.emptyTitle} body={strings.chat.emptyBody} />
          }
        />
        <ComposerDock>
          <Composer onOpenModel={() => router.push('/models')} />
        </ComposerDock>
      </KeyboardBoundary>

      <Sheet
        visible={target !== null}
        onClose={() => setTarget(null)}
        title={target?.role === 'user' ? strings.chat.yourMessage : strings.chat.messageActions}
      >
        {target?.role === 'user' ? (
          <>
            <SheetRow
              label={strings.chat.editMessage}
              icon={<Pencil size={18} color={palette.text} strokeWidth={1.5} />}
              onPress={() => {
                setEditing(target);
                setTarget(null);
              }}
            />
            <SheetRow
              label={strings.common.copy}
              icon={<Share2 size={18} color={palette.text} strokeWidth={1.5} />}
              onPress={() => void copy(target.content)}
            />
          </>
        ) : (
          <>
            <SheetRow
              label={strings.chat.regenerate}
              icon={<RefreshCw size={18} color={palette.text} strokeWidth={1.5} />}
              onPress={() => {
                setTarget(null);
                void regenerate();
              }}
            />
            <SheetRow
              label={strings.chat.copyText}
              icon={<Share2 size={18} color={palette.text} strokeWidth={1.5} />}
              onPress={() => void copy(target?.content ?? '')}
            />
            {target?.reasoning ? (
              <SheetRow
                label={strings.chat.copyReasoning}
                icon={<Share2 size={18} color={palette.text} strokeWidth={1.5} />}
                onPress={() => void copy(target.reasoning ?? '')}
              />
            ) : null}
          </>
        )}
        <SheetRow
          label={strings.chat.deleteMessage}
          icon={<Trash size={18} color={palette.text} strokeWidth={1.5} />}
          onPress={() => {
            setDeleting(target);
            setTarget(null);
          }}
        />
      </Sheet>

      <PromptSheet
        visible={editing !== null}
        title={strings.chat.editTitle}
        label={strings.chat.editWarning}
        initialValue={editing?.content}
        confirmLabel={strings.chat.resend}
        onConfirm={(value) => {
          const message = editing;
          setEditing(null);
          if (message) void editAndResend(message.id, value);
        }}
        onClose={() => setEditing(null)}
      />

      <PromptSheet
        visible={renaming && conversation !== null}
        title={strings.conversations.renameTitle}
        label={strings.conversations.renameLabel}
        placeholder={strings.conversations.renamePlaceholder}
        initialValue={conversation?.title}
        onConfirm={(value) => void commitTitle(value)}
        onClose={() => setRenaming(false)}
      />

      <ConfirmSheet
        visible={deleting !== null}
        title={strings.chat.deleteMessage}
        body={strings.chat.deleteMessageBody}
        onConfirm={() => {
          const message = deleting;
          setDeleting(null);
          if (message) void removeMessage(message.id);
        }}
        onClose={() => setDeleting(null)}
      />
    </View>
  );
}

/**
 * The keyboard boundary for the chat body.
 *
 * Android 15 and up enforce edge-to-edge for apps targeting SDK 35 or later,
 * and that silently disables the window resize `adjustResize` used to perform.
 * The stock KeyboardAvoidingView measures that resize, so on Android it saw
 * nothing change and the keyboard covered the composer. The library version
 * reads the IME inset that edge-to-edge still delivers, and applies it as
 * bottom padding, which shrinks the list as well so the newest message stays
 * above the keyboard. iOS keeps the stock component: there the window is not
 * resized either, `padding` is the documented behaviour, and it works.
 */
function KeyboardBoundary({ children }: { children: React.ReactNode }): React.ReactElement {
  if (Platform.OS === 'android') {
    return (
      <InsetKeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        {children}
      </InsetKeyboardAvoidingView>
    );
  }
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
      {children}
    </KeyboardAvoidingView>
  );
}

/**
 * The composer's bottom inset, dropped while the keyboard is up. The keyboard
 * already separates the composer from the navigation bar then, so keeping the
 * inset would leave a nav-bar-high gap between the input and the keys.
 */
function ComposerDock({ children }: { children: React.ReactNode }): React.ReactElement {
  const insets = useSafeAreaInsets();
  const keyboardVisible = useKeyboardState((state) => state.isVisible);
  return (
    <View style={{ paddingBottom: keyboardVisible ? 0 : insets.bottom }}>{children}</View>
  );
}

function SheetRow({
  label,
  icon,
  onPress,
}: {
  label: string;
  icon: React.ReactNode;
  onPress: () => void;
}): React.ReactElement {
  const theme = useTheme();
  const { palette, radius, spacing, type } = theme;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
        backgroundColor: pressed ? palette.surface : 'transparent',
        borderRadius: radius.md,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.md,
      })}
    >
      {icon}
      <Text style={[type.body, { color: palette.text }]}>{label}</Text>
    </Pressable>
  );
}
