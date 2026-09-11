import { ChevronDown, ChevronRight } from 'lucide-react-native';
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { strings } from '@/lib/strings';
import { useTheme } from './ThemeProvider';

/**
 * Reasoning renders above the answer and stays collapsed by default: it is
 * useful when the user wants it and noise when they do not.
 */
export function ReasoningBlock({
  reasoning,
  thinkingMs,
  streaming,
}: {
  reasoning: string;
  thinkingMs?: number;
  streaming: boolean;
}): React.ReactElement {
  const theme = useTheme();
  const { palette, radius, spacing, type } = theme;
  const [expanded, setExpanded] = useState(false);

  const label = streaming
    ? strings.chat.thinking
    : thinkingMs
      ? strings.chat.thinkingFor(Math.max(1, Math.round(thinkingMs / 1000)))
      : strings.chat.reasoningHidden;

  return (
    <View
      style={{
        borderColor: palette.hairline,
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: radius.md,
        backgroundColor: palette.surface,
        overflow: 'hidden',
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={label}
        onPress={() => setExpanded((value) => !value)}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.sm,
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.sm,
          opacity: pressed ? 0.7 : 1,
        })}
      >
        {expanded ? (
          <ChevronDown size={16} color={palette.textSecondary} strokeWidth={1.5} />
        ) : (
          <ChevronRight size={16} color={palette.textSecondary} strokeWidth={1.5} />
        )}
        <Text style={[type.meta, { color: palette.textSecondary }]}>{label}</Text>
      </Pressable>

      {expanded ? (
        <View
          style={{
            borderTopColor: palette.hairline,
            borderTopWidth: StyleSheet.hairlineWidth,
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.md,
          }}
        >
          <Text selectable style={[type.mono, { color: palette.textSecondary }]}>
            {reasoning}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
