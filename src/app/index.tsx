import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { resolveModel } from '@/core/models';
import type { Conversation } from '@/core/types';
import * as conversationRepo from '@/db/conversations';
import type { ConversationSummary } from '@/db/conversations';
import * as presetRepo from '@/db/presets';
import { searchMessages, type SearchHit } from '@/db/messages';
import { formatRelative } from '@/lib/format';
import { shareConversation, type ExportFormat } from '@/lib/export';
import { strings } from '@/lib/strings';
import { useSettings } from '@/state/settings';
import { Button, Divider, EmptyState, IconButton, Sheet, TextField } from '@/ui/components/Basic';
import { ConfirmSheet, PromptSheet } from '@/ui/components/Dialogs';
import { MessageSquare, Pin, Plus, Search, Settings, Share2, Trash, X } from '@/ui/components/icons';
import { ScreenHeader } from '@/ui/components/ScreenHeader';
import { useTheme } from '@/ui/components/ThemeProvider';

type SheetTarget = ConversationSummary | null;

export default function ConversationsScreen(): React.ReactElement {
  const theme = useTheme();
  const { palette, radius, spacing, type } = theme;
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const preferences = useSettings((state) => state.preferences);

  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [target, setTarget] = useState<SheetTarget>(null);
  const [renaming, setRenaming] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const rows = await conversationRepo.listConversations();
    setConversations(rows);
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  useEffect(() => {
    let cancelled = false;
    const term = query.trim();
    if (term.length === 0) return;
    const timer = setTimeout(() => {
      void searchMessages(term).then((results) => {
        if (!cancelled) setHits(results);
      });
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  const changeQuery = useCallback((value: string) => {
    setQuery(value);
    // Clearing the results here rather than in the effect keeps the effect
    // free of synchronous state updates.
    if (value.trim().length === 0) setHits([]);
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 2400);
    return () => clearTimeout(timer);
  }, [notice]);

  const startChat = useCallback(async () => {
    const presets = await presetRepo.listPresets();
    const defaultPreset =
      presets.find((preset) => preset.id === preferences.defaultPresetId) ?? null;
    // A preset is a whole prompt the user chose on purpose, so it wins over the
    // loose default text when both are set.
    const systemPrompt =
      defaultPreset?.body ??
      (preferences.defaultSystemPrompt.trim().length > 0
        ? preferences.defaultSystemPrompt.trim()
        : undefined);
    const conversation = await conversationRepo.createConversation({
      model: preferences.defaultModel,
      presetId: defaultPreset?.id,
      systemPrompt,
    });
    router.push(`/chat/${conversation.id}`);
  }, [
    preferences.defaultModel,
    preferences.defaultPresetId,
    preferences.defaultSystemPrompt,
    router,
  ]);

  const openConversation = useCallback(
    (id: string) => {
      setSearchOpen(false);
      setQuery('');
      setHits([]);
      router.push(`/chat/${id}`);
    },
    [router],
  );

  const runExport = useCallback(
    async (conversation: Conversation, format: ExportFormat) => {
      setExporting(false);
      const result = await shareConversation(conversation, format, preferences.customModels);
      if (result.error) setNotice(result.error);
    },
    [preferences.customModels],
  );

  const rename = useCallback(
    async (value: string) => {
      if (!target) return;
      const title = value.trim();
      if (title.length === 0) return;
      await conversationRepo.updateConversation(target.id, { title });
      setRenaming(false);
      setTarget(null);
      await reload();
    },
    [reload, target],
  );

  const remove = useCallback(async () => {
    if (!target) return;
    await conversationRepo.deleteConversation(target.id);
    setDeleting(false);
    setTarget(null);
    setNotice(strings.conversations.deleted);
    await reload();
  }, [reload, target]);

  const togglePin = useCallback(async () => {
    if (!target) return;
    await conversationRepo.updateConversation(target.id, { pinned: !target.pinned });
    setTarget(null);
    await reload();
  }, [reload, target]);

  const renderConversation = useCallback(
    ({ item }: { item: ConversationSummary }) => {
      const model = resolveModel(item.model, preferences.customModels);
      return (
        <Pressable
          onPress={() => openConversation(item.id)}
          onLongPress={() => setTarget(item)}
          delayLongPress={300}
          accessibilityRole="button"
          accessibilityLabel={item.title}
          style={({ pressed }) => ({ opacity: pressed ? 0.65 : 1 })}
        >
          <View style={{ paddingVertical: spacing.md, gap: spacing.xs }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
              {item.pinned ? (
                <Pin size={13} color={palette.textTertiary} strokeWidth={1.5} />
              ) : null}
              <Text
                numberOfLines={1}
                style={[type.bodyStrong, { color: palette.text, flexShrink: 1 }]}
              >
                {item.title}
              </Text>
              <Text
                style={[type.meta, type.tabular, { color: palette.textTertiary, marginLeft: 'auto' }]}
              >
                {formatRelative(item.updatedAt)}
              </Text>
            </View>
            <Text numberOfLines={1} style={[type.meta, { color: palette.textSecondary }]}>
              {item.lastMessage ?? model.label}
            </Text>
          </View>
          <Divider />
        </Pressable>
      );
    },
    [
      openConversation,
      palette.text,
      palette.textSecondary,
      palette.textTertiary,
      preferences.customModels,
      spacing.md,
      spacing.sm,
      spacing.xs,
      type.bodyStrong,
      type.meta,
      type.tabular,
    ],
  );

  const renderHit = useCallback(
    ({ item }: { item: SearchHit }) => (
      <Pressable
        onPress={() => openConversation(item.message.conversationId)}
        accessibilityRole="button"
        accessibilityLabel={item.conversationTitle}
        style={({ pressed }) => ({ opacity: pressed ? 0.65 : 1 })}
      >
        <View style={{ paddingVertical: spacing.md, gap: spacing.xs }}>
          <Text numberOfLines={1} style={[type.meta, { color: palette.textTertiary }]}>
            {item.conversationTitle}
          </Text>
          <Text numberOfLines={2} style={[type.chat, { color: palette.text }]}>
            {item.message.content}
          </Text>
        </View>
        <Divider />
      </Pressable>
    ),
    [
      openConversation,
      palette.text,
      palette.textTertiary,
      spacing.md,
      spacing.xs,
      type.chat,
      type.meta,
    ],
  );

  const searching = query.trim().length > 0;

  return (
    <View style={{ flex: 1, backgroundColor: palette.background }}>
      <ScreenHeader
        title={strings.conversations.title}
        subtitle={`${conversations.length} ${conversations.length === 1 ? 'conversation' : 'conversations'}`}
        right={
          <>
            <IconButton
              accessibilityLabel={strings.common.search}
              onPress={() => {
                setSearchOpen((value) => !value);
                changeQuery('');
              }}
            >
              {searchOpen ? (
                <X size={19} color={palette.textSecondary} strokeWidth={1.5} />
              ) : (
                <Search size={19} color={palette.textSecondary} strokeWidth={1.5} />
              )}
            </IconButton>
            <IconButton
              accessibilityLabel={strings.settings.title}
              onPress={() => router.push('/settings')}
            >
              <Settings size={19} color={palette.textSecondary} strokeWidth={1.5} />
            </IconButton>
          </>
        }
        bottom={
          searchOpen ? (
            <TextField
              value={query}
              onChangeText={changeQuery}
              placeholder={strings.conversations.searchPlaceholder}
              autoFocus
              autoCapitalize="none"
              autoCorrect={false}
            />
          ) : null
        }
      />

      {notice ? (
        <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.md }}>
          <Text style={[type.meta, { color: palette.textSecondary }]}>{notice}</Text>
        </View>
      ) : null}

      {searching ? (
        <FlatList
          data={hits}
          keyExtractor={(item) => item.message.id}
          renderItem={renderHit}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{
            paddingHorizontal: spacing.lg,
            paddingBottom: insets.bottom + spacing.xxxl,
            flexGrow: 1,
          }}
          ListEmptyComponent={
            <EmptyState title={strings.conversations.noResults} body={strings.conversations.searchHint} />
          }
        />
      ) : (
        <FlatList
          data={conversations}
          keyExtractor={(item) => item.id}
          renderItem={renderConversation}
          contentContainerStyle={{
            paddingHorizontal: spacing.lg,
            paddingBottom: insets.bottom + 96,
            flexGrow: 1,
          }}
          ListEmptyComponent={
            loading ? null : (
              <EmptyState
                title={strings.conversations.emptyTitle}
                body={strings.conversations.emptyBody}
                action={
                  <Button
                    label={strings.conversations.newChat}
                    variant="primary"
                    onPress={() => void startChat()}
                  />
                }
              />
            )
          }
        />
      )}

      {!searching ? (
        <Pressable
          onPress={() => void startChat()}
          accessibilityRole="button"
          accessibilityLabel={strings.conversations.newChat}
          style={({ pressed }) => ({
            position: 'absolute',
            right: spacing.lg,
            bottom: insets.bottom + spacing.lg,
            width: 52,
            height: 52,
            borderRadius: radius.full,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: palette.accent,
            opacity: pressed ? 0.8 : 1,
          })}
        >
          <Plus size={22} color={palette.onAccent} strokeWidth={1.5} />
        </Pressable>
      ) : null}

      <Sheet
        visible={target !== null && !renaming && !exporting && !deleting}
        onClose={() => setTarget(null)}
        title={target?.title}
      >
        <SheetRow
          label={target?.pinned ? strings.conversations.unpin : strings.conversations.pin}
          icon={<Pin size={18} color={palette.text} strokeWidth={1.5} />}
          onPress={() => void togglePin()}
        />
        <SheetRow
          label={strings.common.rename}
          icon={<MessageSquare size={18} color={palette.text} strokeWidth={1.5} />}
          onPress={() => setRenaming(true)}
        />
        <SheetRow
          label={strings.conversations.exportMarkdown}
          icon={<Share2 size={18} color={palette.text} strokeWidth={1.5} />}
          onPress={() => setExporting(true)}
        />
        <SheetRow
          label={strings.common.delete}
          icon={<Trash size={18} color={palette.text} strokeWidth={1.5} />}
          onPress={() => setDeleting(true)}
        />
      </Sheet>

      <Sheet
        visible={exporting}
        onClose={() => setExporting(false)}
        title={strings.conversations.exportTitle}
      >
        <SheetRow
          label={strings.conversations.exportMarkdown}
          icon={<Share2 size={18} color={palette.text} strokeWidth={1.5} />}
          onPress={() => target && void runExport(target, 'markdown')}
        />
        <SheetRow
          label={strings.conversations.exportJson}
          icon={<Share2 size={18} color={palette.text} strokeWidth={1.5} />}
          onPress={() => target && void runExport(target, 'json')}
        />
      </Sheet>

      <PromptSheet
        visible={renaming && target !== null}
        title={strings.conversations.renameTitle}
        label={strings.conversations.renameLabel}
        placeholder={strings.conversations.renamePlaceholder}
        initialValue={target?.title}
        onConfirm={(value) => void rename(value)}
        onClose={() => {
          setRenaming(false);
          setTarget(null);
        }}
      />

      <ConfirmSheet
        visible={deleting && target !== null}
        title={strings.conversations.deleteTitle}
        body={strings.conversations.deleteBody}
        onConfirm={() => void remove()}
        onClose={() => setDeleting(false)}
      />
    </View>
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
