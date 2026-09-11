import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import React, { useMemo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { estimateCostUsd, formatUsd } from '@/core/pricing';
import type { Attachment, ChatMessage } from '@/core/types';
import { formatTimestamp, formatUsageSummary } from '@/lib/format';
import { extractHtmlBlocks } from '@/lib/html';
import { strings } from '@/lib/strings';
import { useTheme } from './ThemeProvider';
import { Eye } from './icons';
import { Markdown } from './Markdown';
import { ReasoningBlock } from './ReasoningBlock';
import { ToolSteps } from './ToolSteps';

function AttachmentStrip({ attachments }: { attachments: Attachment[] }): React.ReactElement {
  const theme = useTheme();
  const { palette, radius, spacing, type } = theme;
  const images = attachments.filter((attachment) => attachment.kind === 'image');
  const files = attachments.filter((attachment) => attachment.kind === 'text');

  return (
    <View style={{ gap: spacing.sm }}>
      {images.length > 0 ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, justifyContent: 'flex-end' }}>
          {images.map((image) => (
            <Image
              key={image.id}
              source={{ uri: image.uri }}
              style={{
                width: 132,
                height: 132,
                borderRadius: radius.md,
                borderColor: palette.hairline,
                borderWidth: StyleSheet.hairlineWidth,
              }}
              contentFit="cover"
            />
          ))}
        </View>
      ) : null}
      {files.map((file) => (
        <View
          key={file.id}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.sm,
            borderColor: palette.hairline,
            borderWidth: StyleSheet.hairlineWidth,
            borderRadius: radius.sm,
            paddingHorizontal: spacing.sm,
            paddingVertical: spacing.xs,
            alignSelf: 'flex-end',
          }}
        >
          <Text numberOfLines={1} style={[type.meta, { color: palette.textSecondary, maxWidth: 180 }]}>
            {file.name}
          </Text>
        </View>
      ))}
    </View>
  );
}

export const MessageItem = React.memo(function MessageItem({
  message,
  streaming,
  modelLabel,
  onLongPress,
}: {
  message: ChatMessage;
  streaming: boolean;
  modelLabel: string;
  onLongPress: (message: ChatMessage) => void;
}): React.ReactElement {
  const theme = useTheme();
  const { palette, radius, spacing, type } = theme;
  const router = useRouter();

  // Parsing the whole reply on every render would be wasteful for the common
  // case of a message with no html in it at all.
  const htmlBlocks = useMemo(
    () => (message.role === 'assistant' ? extractHtmlBlocks(message.content) : []),
    [message.content, message.role],
  );

  if (message.role === 'user') {
    return (
      <View style={{ alignItems: 'flex-end', gap: spacing.xs }}>
        <Pressable
          onLongPress={() => onLongPress(message)}
          delayLongPress={280}
          accessibilityRole="button"
          accessibilityLabel="Message actions"
          style={{ maxWidth: '86%' }}
        >
          <View
            style={{
              backgroundColor: palette.elevated,
              borderColor: palette.hairline,
              borderWidth: StyleSheet.hairlineWidth,
              borderRadius: radius.lg,
              paddingHorizontal: spacing.lg,
              paddingVertical: spacing.md,
              gap: spacing.md,
            }}
          >
            {message.attachments && message.attachments.length > 0 ? (
              <AttachmentStrip attachments={message.attachments} />
            ) : null}
            {message.content.length > 0 ? (
              <Text selectable style={[type.chat, { color: palette.text }]}>
                {message.content}
              </Text>
            ) : null}
          </View>
        </Pressable>
        <Text style={[type.meta, type.tabular, { color: palette.textTertiary }]}>
          {formatTimestamp(message.createdAt)}
        </Text>
      </View>
    );
  }

  const cost =
    message.usage && message.model
      ? estimateCostUsd(message.usage, message.model, new Date(message.createdAt))
      : null;

  return (
    <View style={{ gap: spacing.md }}>
      {message.reasoning ? (
        <ReasoningBlock
          reasoning={message.reasoning}
          thinkingMs={message.thinkingMs}
          streaming={streaming}
        />
      ) : null}

      {message.toolCalls && message.toolCalls.length > 0 ? (
        <ToolSteps calls={message.toolCalls} streaming={streaming} />
      ) : null}

      <Pressable
        onLongPress={() => onLongPress(message)}
        delayLongPress={280}
        accessibilityRole="button"
        accessibilityLabel="Message actions"
      >
        {message.content.length > 0 ? (
          <Markdown text={message.content} />
        ) : streaming ? (
          <ActivityIndicator size="small" color={palette.textTertiary} style={{ alignSelf: 'flex-start' }} />
        ) : null}
      </Pressable>

      {htmlBlocks.length > 0 ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          {htmlBlocks.map((block) => (
            <Pressable
              key={block.index}
              onPress={() =>
                router.push({
                  pathname: '/preview/[messageId]',
                  params: { messageId: message.id, block: String(block.index) },
                })
              }
              accessibilityRole="button"
              accessibilityLabel={`${strings.preview.open} ${block.title ?? strings.preview.block(block.index)}`}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: spacing.xs,
                borderColor: palette.hairline,
                borderWidth: StyleSheet.hairlineWidth,
                borderRadius: radius.full,
                paddingHorizontal: spacing.md,
                paddingVertical: spacing.xs,
                opacity: pressed ? 0.65 : 1,
              })}
            >
              <Eye size={13} color={palette.textSecondary} strokeWidth={1.5} />
              <Text style={[type.meta, { color: palette.textSecondary }]}>
                {block.title ?? `${strings.preview.open} ${block.index + 1}`}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {message.status === 'stopped' ? (
        <Text style={[type.meta, { color: palette.textTertiary }]}>{strings.chat.stopped}</Text>
      ) : null}

      {message.status === 'error' ? (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.sm,
            borderColor: palette.hairline,
            borderWidth: StyleSheet.hairlineWidth,
            borderRadius: radius.md,
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.sm,
          }}
        >
          <Text style={[type.meta, { color: palette.textSecondary, flexShrink: 1 }]}>
            {strings.chat.failed}
          </Text>
        </View>
      ) : null}

      {message.usage ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          <Text style={[type.meta, type.tabular, { color: palette.textTertiary }]}>
            {modelLabel}
          </Text>
          <Text style={[type.meta, type.tabular, { color: palette.textTertiary }]}>
            {formatUsageSummary(message.usage)}
          </Text>
          {cost ? (
            <Text style={[type.meta, type.tabular, { color: palette.textTertiary }]}>
              {formatUsd(cost.usd)}
              {cost.peak ? ' peak' : ''}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
});
