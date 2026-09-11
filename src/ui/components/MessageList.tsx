import React, { useCallback, useRef, useState } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';

import type { ChatMessage } from '@/core/types';
import { ChevronDown } from './icons';
import { strings } from '@/lib/strings';
import { useTheme } from './ThemeProvider';
import { MessageItem } from './MessageItem';

const PIN_THRESHOLD = 72;

/**
 * A non-inverted list with an explicit pin-to-bottom rule. While a response is
 * streaming the list follows the tail only if the user has not scrolled away;
 * scrolling up pauses the follow and reveals a control to return.
 */
export function MessageList({
  messages,
  streaming,
  modelLabel,
  onLongPressMessage,
  ListHeaderComponent,
  ListEmptyComponent,
}: {
  messages: ChatMessage[];
  streaming: boolean;
  modelLabel: (message: ChatMessage) => string;
  onLongPressMessage: (message: ChatMessage) => void;
  ListHeaderComponent?: React.ReactElement | null;
  ListEmptyComponent?: React.ReactElement | null;
}): React.ReactElement {
  const theme = useTheme();
  const { palette, radius, spacing } = theme;

  const listRef = useRef<FlatList<ChatMessage>>(null);
  const pinnedRef = useRef(true);
  const [showJump, setShowJump] = useState(false);

  const scrollToEnd = useCallback((animated: boolean) => {
    listRef.current?.scrollToEnd({ animated });
    pinnedRef.current = true;
    setShowJump(false);
  }, []);

  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const distanceFromEnd = contentSize.height - (contentOffset.y + layoutMeasurement.height);
    const pinned = distanceFromEnd < PIN_THRESHOLD;
    if (pinned !== pinnedRef.current) {
      pinnedRef.current = pinned;
      setShowJump(!pinned);
    }
  }, []);

  const renderItem = useCallback(
    ({ item }: { item: ChatMessage }) => (
      <MessageItem
        message={item}
        streaming={streaming && item.status !== 'complete'}
        modelLabel={modelLabel(item)}
        onLongPress={onLongPressMessage}
      />
    ),
    [modelLabel, onLongPressMessage, streaming],
  );

  return (
    <View style={{ flex: 1 }}>
      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        onScroll={onScroll}
        scrollEventThrottle={64}
        onContentSizeChange={() => {
          if (pinnedRef.current) listRef.current?.scrollToEnd({ animated: false });
        }}
        onLayout={() => {
          if (pinnedRef.current) listRef.current?.scrollToEnd({ animated: false });
        }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        contentContainerStyle={{
          paddingHorizontal: spacing.lg,
          paddingTop: spacing.lg,
          paddingBottom: spacing.xl,
          gap: spacing.xl,
          flexGrow: 1,
        }}
        ListHeaderComponent={ListHeaderComponent}
        ListEmptyComponent={ListEmptyComponent}
        initialNumToRender={12}
        maxToRenderPerBatch={8}
        windowSize={11}
        removeClippedSubviews={false}
      />

      {showJump ? (
        <Pressable
          onPress={() => scrollToEnd(true)}
          accessibilityRole="button"
          accessibilityLabel={strings.chat.scrollToBottom}
          style={({ pressed }) => ({
            position: 'absolute',
            alignSelf: 'center',
            bottom: spacing.lg,
            width: 36,
            height: 36,
            borderRadius: radius.full,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: palette.elevated,
            borderColor: palette.hairline,
            borderWidth: StyleSheet.hairlineWidth,
            opacity: pressed ? 0.7 : 0.96,
          })}
        >
          <ChevronDown size={18} color={palette.text} strokeWidth={1.5} />
        </Pressable>
      ) : null}
    </View>
  );
}
