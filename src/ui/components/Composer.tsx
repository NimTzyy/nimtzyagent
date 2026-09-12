import * as Haptics from 'expo-haptics';
import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { resolveModel } from '@/core/models';
import type { Attachment } from '@/core/types';
import { pickTextFile } from '@/lib/files';
import { pasteImageFromClipboard, pickImage } from '@/lib/images';
import { strings } from '@/lib/strings';
import { useChat } from '@/state/chat';
import { useSettings } from '@/state/settings';
import {
  Camera,
  ChevronDown,
  FileText,
  ImageIcon,
  Paperclip,
  Plus,
  ArrowUp,
  CircleStop,
  X,
} from './icons';
import { Sheet } from './Basic';
import { useTheme } from './ThemeProvider';

const MAX_INPUT_HEIGHT = 168;

function AttachmentChips({
  attachments,
  onRemove,
}: {
  attachments: Attachment[];
  onRemove: (id: string) => void;
}): React.ReactElement | null {
  const theme = useTheme();
  const { palette, radius, spacing, type } = theme;
  if (attachments.length === 0) return null;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      bounces={false}
      contentContainerStyle={{ gap: spacing.sm, paddingHorizontal: spacing.md, paddingTop: spacing.md }}
    >
      {attachments.map((attachment) => (
        <View
          key={attachment.id}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.sm,
            backgroundColor: palette.surface,
            borderColor: palette.hairline,
            borderWidth: StyleSheet.hairlineWidth,
            borderRadius: radius.md,
            paddingLeft: spacing.md,
            paddingRight: spacing.sm,
            paddingVertical: spacing.sm,
            maxWidth: 220,
          }}
        >
          {attachment.kind === 'image' ? (
            <ImageIcon size={14} color={palette.textSecondary} strokeWidth={1.5} />
          ) : (
            <FileText size={14} color={palette.textSecondary} strokeWidth={1.5} />
          )}
          <Text numberOfLines={1} style={[type.meta, { color: palette.text, flexShrink: 1 }]}>
            {attachment.name}
          </Text>
          <Pressable
            onPress={() => onRemove(attachment.id)}
            accessibilityRole="button"
            accessibilityLabel={strings.chat.removeAttachment}
            hitSlop={6}
          >
            <X size={14} color={palette.textSecondary} strokeWidth={1.5} />
          </Pressable>
        </View>
      ))}
    </ScrollView>
  );
}

export function Composer({
  onOpenModel,
}: {
  onOpenModel: () => void;
}): React.ReactElement {
  const theme = useTheme();
  const { palette, radius, spacing, type } = theme;

  const draft = useChat((state) => state.draft);
  const setDraft = useChat((state) => state.setDraft);
  const send = useChat((state) => state.send);
  const stop = useChat((state) => state.stop);
  const streaming = useChat((state) => state.streaming);
  const attachments = useChat((state) => state.attachments);
  const addAttachments = useChat((state) => state.addAttachments);
  const removeAttachment = useChat((state) => state.removeAttachment);
  const setError = useChat((state) => state.setError);
  const conversation = useChat((state) => state.conversation);

  const preferences = useSettings((state) => state.preferences);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [inputHeight, setInputHeight] = useState(0);

  const model = useMemo(
    () =>
      conversation
        ? resolveModel(conversation.model, preferences.customModels)
        : resolveModel(preferences.defaultModel, preferences.customModels),
    [conversation, preferences.customModels, preferences.defaultModel],
  );

  const hasImages = attachments.some((attachment) => attachment.kind === 'image');
  const visionBlocked = hasImages && !model.vision;
  const canSend = draft.trim().length > 0 || attachments.length > 0;

  const captureFile = useCallback(async () => {
    const outcome = await pickTextFile();
    return {
      attachments: outcome.attachment ? [outcome.attachment] : [],
      error: outcome.error,
    };
  }, []);

  const capture = useCallback(
    async (task: () => Promise<{ attachments: Attachment[]; error?: string }>) => {
      setSheetOpen(false);
      // The pickers are native and their failures arrive as rejections, not as
      // an `error` in the outcome. Letting one through would leave the tap with
      // no visible effect at all, which reads as the button being broken.
      let outcome: { attachments: Attachment[]; error?: string };
      try {
        outcome = await task();
      } catch {
        setError(strings.chat.attachFailed);
        return;
      }
      if (outcome.error) {
        setError(outcome.error);
        if (outcome.attachments.length === 0) return;
      }
      if (outcome.attachments.length > 0) addAttachments(outcome.attachments);
    },
    [addAttachments, setError],
  );

  const submit = useCallback(() => {
    if (streaming || visionBlocked || !canSend) return;
    if (preferences.haptics) {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    }
    void send();
  }, [canSend, preferences.haptics, send, streaming, visionBlocked]);

  return (
    <View style={{ borderTopColor: palette.hairline, borderTopWidth: StyleSheet.hairlineWidth }}>
      <AttachmentChips attachments={attachments} onRemove={removeAttachment} />

      {visionBlocked ? (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: spacing.md,
            paddingHorizontal: spacing.lg,
            paddingTop: spacing.md,
          }}
        >
          <Text style={[type.meta, { color: palette.textSecondary, flexShrink: 1 }]}>
            {strings.chat.visionRequired}
          </Text>
          <Pressable onPress={onOpenModel} accessibilityRole="button" hitSlop={8}>
            <Text style={[type.metaStrong, { color: palette.accent }]}>{strings.chat.switchModel}</Text>
          </Pressable>
        </View>
      ) : null}

      <View
        style={{
          flexDirection: 'row',
          alignItems: 'flex-end',
          gap: spacing.sm,
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.md,
        }}
      >
        <Pressable
          onPress={() => setSheetOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={strings.chat.attachTitle}
          style={({ pressed }) => ({
            width: 40,
            height: 40,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <Plus size={20} color={palette.textSecondary} strokeWidth={1.5} />
        </Pressable>

        <View
          style={{
            flex: 1,
            backgroundColor: palette.surface,
            borderColor: palette.hairline,
            borderWidth: StyleSheet.hairlineWidth,
            borderRadius: radius.lg,
            paddingHorizontal: spacing.md,
            paddingVertical: StyleSheet.hairlineWidth,
          }}
        >
          <Pressable
            onPress={onOpenModel}
            accessibilityRole="button"
            accessibilityLabel={strings.chat.model}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: spacing.xs,
              paddingTop: spacing.sm,
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Text style={[type.meta, { color: palette.textTertiary }]}>{model.label}</Text>
            {model.thinking ? (
              <Text style={[type.meta, { color: palette.textTertiary }]}>· thinking</Text>
            ) : null}
            <ChevronDown size={13} color={palette.textTertiary} strokeWidth={1.5} />
          </Pressable>

          <TextInput
            value={draft}
            onChangeText={setDraft}
            multiline
            onContentSizeChange={(event) =>
              setInputHeight(Math.min(event.nativeEvent.contentSize.height, MAX_INPUT_HEIGHT))
            }
            placeholder={strings.chat.placeholder}
            placeholderTextColor={palette.textTertiary}
            selectionColor={palette.accent}
            style={[
              type.body,
              {
                color: palette.text,
                paddingTop: spacing.xs,
                paddingBottom: spacing.sm,
                minHeight: 34,
                maxHeight: MAX_INPUT_HEIGHT,
                height: Math.max(34, inputHeight),
                textAlignVertical: 'top',
              },
            ]}
          />
        </View>

        <Pressable
          onPress={streaming ? stop : submit}
          accessibilityRole="button"
          accessibilityLabel={streaming ? strings.chat.stop : strings.chat.send}
          accessibilityState={{ disabled: !streaming && (!canSend || visionBlocked) }}
          disabled={!streaming && (!canSend || visionBlocked)}
          style={({ pressed }) => ({
            width: 40,
            height: 40,
            borderRadius: radius.full,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: streaming
              ? palette.elevated
              : canSend && !visionBlocked
                ? palette.accent
                : palette.surface,
            borderColor: palette.hairline,
            borderWidth: streaming || !canSend || visionBlocked ? StyleSheet.hairlineWidth : 0,
            opacity: pressed ? 0.75 : 1,
          })}
        >
          {streaming ? (
            <CircleStop size={19} color={palette.text} strokeWidth={1.5} />
          ) : (
            <ArrowUp
              size={19}
              color={canSend && !visionBlocked ? palette.onAccent : palette.textTertiary}
              strokeWidth={1.5}
            />
          )}
        </Pressable>
      </View>

      <Sheet visible={sheetOpen} onClose={() => setSheetOpen(false)} title={strings.chat.attachTitle}>
        <SheetAction
          label={strings.chat.takePhoto}
          icon={<Camera size={18} color={palette.text} strokeWidth={1.5} />}
          onPress={() => void capture(() => pickImage('camera'))}
        />
        <SheetAction
          label={strings.chat.photoLibrary}
          icon={<ImageIcon size={18} color={palette.text} strokeWidth={1.5} />}
          onPress={() => void capture(() => pickImage('library'))}
        />
        <SheetAction
          label={strings.chat.attachFile}
          icon={<FileText size={18} color={palette.text} strokeWidth={1.5} />}
          onPress={() => void capture(captureFile)}
        />
        <SheetAction
          label="Paste image"
          icon={<Paperclip size={18} color={palette.text} strokeWidth={1.5} />}
          onPress={() => void capture(() => pasteImageFromClipboard())}
        />
      </Sheet>
    </View>
  );
}

function SheetAction({
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
