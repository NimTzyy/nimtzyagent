import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { Preset } from '@/core/types';
import * as presetRepo from '@/db/presets';
import { strings } from '@/lib/strings';
import { useSettings } from '@/state/settings';
import { Badge, Button, Divider, EmptyState } from '@/ui/components/Basic';
import { ConfirmSheet } from '@/ui/components/Dialogs';
import { Trash } from '@/ui/components/icons';
import { ScreenHeader } from '@/ui/components/ScreenHeader';
import { useTheme } from '@/ui/components/ThemeProvider';

export default function PresetsScreen(): React.ReactElement {
  const theme = useTheme();
  const { palette, spacing, type } = theme;
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const preferences = useSettings((state) => state.preferences);
  const updatePreferences = useSettings((state) => state.updatePreferences);

  const [presets, setPresets] = useState<Preset[]>([]);
  const [removing, setRemoving] = useState<Preset | null>(null);

  const reload = useCallback(async () => {
    setPresets(await presetRepo.listPresets());
  }, []);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  const remove = useCallback(async () => {
    if (!removing) return;
    await presetRepo.deletePreset(removing.id);
    if (preferences.defaultPresetId === removing.id) {
      await updatePreferences({ defaultPresetId: null });
    }
    setRemoving(null);
    await reload();
  }, [preferences.defaultPresetId, reload, removing, updatePreferences]);

  return (
    <View style={{ flex: 1, backgroundColor: palette.background }}>
      <ScreenHeader
        title={strings.presets.title}
        showBack
        right={
          <Button
            label={strings.presets.newPreset}
            variant="quiet"
            onPress={() => router.push('/presets/new')}
          />
        }
      />

      {presets.length === 0 ? (
        <EmptyState
          title={strings.presets.emptyTitle}
          body={strings.presets.emptyBody}
          action={
            <Button
              label={strings.presets.newPreset}
              variant="primary"
              onPress={() => router.push('/presets/new')}
            />
          }
        />
      ) : (
        <ScrollView
          contentContainerStyle={{
            paddingHorizontal: spacing.lg,
            paddingBottom: insets.bottom + spacing.xxxl,
          }}
        >
          {presets.map((preset) => {
            const isDefault = preferences.defaultPresetId === preset.id;
            return (
              <Pressable
                key={preset.id}
                onPress={() => router.push(`/presets/${preset.id}`)}
                onLongPress={() => setRemoving(preset)}
                accessibilityRole="button"
                accessibilityLabel={preset.name}
                style={({ pressed }) => ({ opacity: pressed ? 0.65 : 1 })}
              >
                <View style={{ paddingVertical: spacing.lg, gap: spacing.sm }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                    <Text style={[type.bodyStrong, { color: palette.text, flexShrink: 1 }]}>
                      {preset.name}
                    </Text>
                    {isDefault ? <Badge label={strings.presets.defaultLabel} tone="accent" /> : null}
                    <Pressable
                      onPress={() => setRemoving(preset)}
                      accessibilityRole="button"
                      accessibilityLabel={strings.common.delete}
                      hitSlop={10}
                      style={{ marginLeft: 'auto' }}
                    >
                      <Trash size={16} color={palette.textTertiary} strokeWidth={1.5} />
                    </Pressable>
                  </View>
                  {preset.description ? (
                    <Text style={[type.meta, { color: palette.textSecondary }]}>
                      {preset.description}
                    </Text>
                  ) : null}
                  <Text numberOfLines={2} style={[type.mono, { color: palette.textTertiary }]}>
                    {preset.body}
                  </Text>
                </View>
                <Divider />
              </Pressable>
            );
          })}
        </ScrollView>
      )}

      <ConfirmSheet
        visible={removing !== null}
        title={strings.presets.deleteTitle}
        body={strings.presets.deleteBody}
        onConfirm={() => void remove()}
        onClose={() => setRemoving(null)}
      />
    </View>
  );
}
