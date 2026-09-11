import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView, type WebViewNavigation } from 'react-native-webview';

import { extractHtmlBlocks, frameForPreview } from '@/lib/html';
import { strings } from '@/lib/strings';
import { useChat } from '@/state/chat';
import { EmptyState, Segmented } from '@/ui/components/Basic';
import { ScreenHeader } from '@/ui/components/ScreenHeader';
import { useTheme } from '@/ui/components/ThemeProvider';

/**
 * A sandbox for HTML the model produced.
 *
 * The chat renders model output as text on purpose, so this is the one place it
 * is executed — and it is walled off accordingly: no file access, no DOM
 * storage, no second windows, and navigation away is refused so the document
 * cannot turn into a browser for whatever it links to. Nothing here can reach
 * the conversation, the API key, or the workspace folder.
 */
export default function PreviewScreen(): React.ReactElement {
  const theme = useTheme();
  const { palette, radius, spacing, type } = theme;
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { messageId, block } = useLocalSearchParams<{ messageId: string; block?: string }>();

  const message = useChat((state) => state.messages.find((entry) => entry.id === messageId));
  const blocks = useMemo(() => extractHtmlBlocks(message?.content ?? ''), [message?.content]);

  const parsed = block === undefined ? 0 : Number.parseInt(block, 10);
  const initial = Number.isFinite(parsed) && parsed >= 0 && parsed < blocks.length ? parsed : 0;
  const [index, setIndex] = useState(initial);

  const current = blocks[index];

  /**
   * Only the document itself may load; anything it links to is ignored.
   *
   * The whitelist is deliberately wider than what is allowed through, because
   * a URL that fails it is handed to the system browser instead. Matching there
   * and refusing here keeps every link inside the preview — nothing leaves the
   * app. `about:` is the document's own local URL.
   */
  const onShouldStartLoadWithRequest = useCallback(
    (request: WebViewNavigation) => request.url.startsWith('about:'),
    [],
  );

  if (!current) {
    return (
      <View style={{ flex: 1, backgroundColor: palette.background }}>
        <ScreenHeader title={strings.preview.title} showBack />
        <EmptyState title={strings.preview.empty} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: palette.background }}>
      <ScreenHeader
        title={current.title ?? strings.preview.title}
        subtitle={strings.preview.block(index)}
        showBack
        right={
          <Pressable
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel={strings.common.close}
            hitSlop={8}
            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
          >
            <Text style={[type.meta, { color: palette.textSecondary }]}>{strings.common.close}</Text>
          </Pressable>
        }
      />

      {blocks.length > 1 ? (
        <View style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.sm }}>
          <Segmented<string>
            value={String(index)}
            onChange={(next) => setIndex(Number.parseInt(next, 10))}
            options={blocks.map((entry) => ({
              value: String(entry.index),
              label: entry.title ?? strings.preview.block(entry.index),
            }))}
          />
        </View>
      ) : null}

      <WebView
        originWhitelist={['about:*', 'http://*', 'https://*']}
        source={{ html: frameForPreview(current.content) }}
        onShouldStartLoadWithRequest={onShouldStartLoadWithRequest}
        javaScriptEnabled
        domStorageEnabled={false}
        allowFileAccess={false}
        allowFileAccessFromFileURLs={false}
        allowUniversalAccessFromFileURLs={false}
        javaScriptCanOpenWindowsAutomatically={false}
        setSupportMultipleWindows={false}
        dataDetectorTypes={[]}
        style={{ flex: 1, backgroundColor: '#FFFFFF', borderTopColor: palette.hairline, borderTopWidth: 1 }}
        containerStyle={{ flex: 1 }}
      />

      <View
        style={{
          paddingHorizontal: spacing.lg,
          paddingTop: spacing.md,
          paddingBottom: insets.bottom + spacing.md,
          backgroundColor: palette.background,
          borderTopColor: palette.hairline,
          borderTopWidth: 1,
        }}
      >
        <Text style={[type.meta, { color: palette.textTertiary, borderRadius: radius.sm }]}>
          {strings.preview.scriptedNote}
        </Text>
      </View>
    </View>
  );
}
