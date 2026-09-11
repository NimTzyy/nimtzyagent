import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChevronRight } from './icons';
import { useTheme } from './ThemeProvider';

/**
 * Every screen draws its own header so the title, actions, and search field
 * share one rhythm. The stack header stays hidden.
 */
export function ScreenHeader({
  title,
  subtitle,
  onTitlePress,
  left,
  right,
  bottom,
  showBack,
  backLabel,
}: {
  title: string;
  subtitle?: string;
  onTitlePress?: () => void;
  left?: React.ReactNode;
  right?: React.ReactNode;
  bottom?: React.ReactNode;
  showBack?: boolean;
  backLabel?: string;
}): React.ReactElement {
  const theme = useTheme();
  const { palette, spacing, type } = theme;
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const heading = (
    <View style={{ flex: 1, gap: 1 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <Text numberOfLines={1} style={[type.title, { color: palette.text, flexShrink: 1 }]}>
          {title}
        </Text>
        {onTitlePress ? (
          <ChevronRight size={15} color={palette.textTertiary} strokeWidth={1.5} />
        ) : null}
      </View>
      {subtitle ? (
        <Text numberOfLines={1} style={[type.meta, { color: palette.textTertiary }]}>
          {subtitle}
        </Text>
      ) : null}
    </View>
  );

  return (
    <View
      style={{
        paddingTop: insets.top + spacing.sm,
        paddingBottom: spacing.md,
        paddingHorizontal: spacing.lg,
        backgroundColor: palette.background,
        borderBottomColor: palette.hairline,
        borderBottomWidth: bottom ? 0 : StyleSheet.hairlineWidth,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        {showBack ? (
          <Pressable
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
            accessibilityRole="button"
            accessibilityLabel={backLabel ?? 'Back'}
            hitSlop={10}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: 4,
              paddingVertical: 4,
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <ChevronRight
              size={16}
              color={palette.textSecondary}
              strokeWidth={1.5}
              style={{ transform: [{ rotate: '180deg' }] }}
            />
          </Pressable>
        ) : null}
        {left}
        {onTitlePress ? (
          <Pressable
            onPress={onTitlePress}
            accessibilityRole="button"
            accessibilityLabel={title}
            style={({ pressed }) => ({ flex: 1, opacity: pressed ? 0.65 : 1 })}
          >
            {heading}
          </Pressable>
        ) : (
          heading
        )}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>{right}</View>
      </View>
      {bottom ? <View style={{ marginTop: spacing.md }}>{bottom}</View> : null}
    </View>
  );
}
