import React, { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { describeToolCall, TOOL_NAMES } from '@/core/tools';
import type { ToolCall } from '@/core/types';
import { strings } from '@/lib/strings';
import { useTheme } from './ThemeProvider';
import { ChevronDown, ChevronRight, Folder, Globe, Pencil, TriangleAlert } from './icons';

/**
 * The steps an agent turn took, as one line per call.
 *
 * They are kept apart from the answer on purpose: the prose is what the user
 * asked for, and the calls are a record of how it was produced. Each line opens
 * to show exactly what was asked and what came back, which is the only way to
 * tell a wrong answer from a wrong search.
 */
export function ToolSteps({
  calls,
  streaming,
}: {
  calls: ToolCall[];
  streaming: boolean;
}): React.ReactElement {
  const theme = useTheme();
  const { palette, radius, spacing, type } = theme;
  const [open, setOpen] = useState<number | null>(null);

  return (
    <View
      style={{
        borderColor: palette.hairline,
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: radius.md,
        overflow: 'hidden',
      }}
    >
      {calls.map((call, index) => {
        const expanded = open === index;
        const running = call.status === 'pending' && streaming;
        const failed = call.status === 'error';
        return (
          <View
            key={`${call.id}-${index}`}
            style={{
              borderTopColor: palette.hairline,
              borderTopWidth: index === 0 ? 0 : StyleSheet.hairlineWidth,
            }}
          >
            <Pressable
              onPress={() => setOpen(expanded ? null : index)}
              accessibilityRole="button"
              accessibilityLabel={describeToolCall(call.name, call.arguments)}
              accessibilityState={{ expanded }}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: spacing.sm,
                paddingHorizontal: spacing.md,
                paddingVertical: spacing.sm,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              {running ? (
                <ActivityIndicator size="small" color={palette.textTertiary} />
              ) : failed ? (
                <TriangleAlert size={14} color={palette.textTertiary} strokeWidth={1.5} />
              ) : (
                <StepIcon name={call.name} color={palette.textTertiary} />
              )}
              <Text numberOfLines={1} style={[type.meta, { color: palette.textSecondary, flex: 1 }]}>
                {describeToolCall(call.name, call.arguments)}
              </Text>
              {running ? (
                <Text style={[type.meta, { color: palette.textTertiary }]}>
                  {strings.agent.stepRunning}
                </Text>
              ) : null}
              {expanded ? (
                <ChevronDown size={14} color={palette.textTertiary} strokeWidth={1.5} />
              ) : (
                <ChevronRight size={14} color={palette.textTertiary} strokeWidth={1.5} />
              )}
            </Pressable>

            {expanded ? (
              <View style={{ paddingHorizontal: spacing.md, paddingBottom: spacing.md, gap: spacing.sm }}>
                <Detail label={strings.agent.arguments} value={call.arguments} />
                {call.result ? <Detail label={strings.agent.result} value={call.result} /> : null}
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

/** Raw text, monospaced: these values are machine output, not prose. */
function Detail({ label, value }: { label: string; value: string }): React.ReactElement {
  const theme = useTheme();
  const { palette, radius, spacing, type } = theme;
  return (
    <View style={{ gap: spacing.xs }}>
      <Text style={[type.meta, { color: palette.textTertiary }]}>{label}</Text>
      <Text
        selectable
        style={[
          type.monoSmall,
          {
            color: palette.textSecondary,
            backgroundColor: palette.surface,
            padding: spacing.sm,
            borderRadius: radius.sm,
          },
        ]}
      >
        {value.length > 0 ? value : '{}'}
      </Text>
    </View>
  );
}

function StepIcon({ name, color }: { name: string; color: string }): React.ReactElement {
  if (name === TOOL_NAMES.search) return <Globe size={14} color={color} strokeWidth={1.5} />;
  if (name === TOOL_NAMES.folder) return <Folder size={14} color={color} strokeWidth={1.5} />;
  return <Pencil size={14} color={color} strokeWidth={1.5} />;
}
