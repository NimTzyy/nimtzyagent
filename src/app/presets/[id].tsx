import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import * as presetRepo from '@/db/presets';
import { strings } from '@/lib/strings';
import { useSettings } from '@/state/settings';
import { Button, KeyboardScroll, TextField } from '@/ui/components/Basic';
import { ConfirmSheet } from '@/ui/components/Dialogs';
import { ScreenHeader } from '@/ui/components/ScreenHeader';
import { useTheme } from '@/ui/components/ThemeProvider';

export default function PresetEditorScreen(): React.ReactElement {
  const theme = useTheme();
  const { palette, spacing, type } = theme;
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const preferences = useSettings((state) => state.preferences);
  const updatePreferences = useSettings((state) => state.updatePreferences);

  const isNew = id === 'new';
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [body, setBody] = useState('');
  const [isDefault, setIsDefault] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [ready, setReady] = useState(isNew);

  useEffect(() => {
    if (isNew || !id) return;
    let cancelled = false;
    void (async () => {
      const preset = await presetRepo.getPreset(id);
      if (cancelled || !preset) {
        setReady(true);
        return;
      }
      setName(preset.name);
      setDescription(preset.description ?? '');
      setBody(preset.body);
      setIsDefault(preferences.defaultPresetId === preset.id);
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [id, isNew, preferences.defaultPresetId]);

  const save = useCallback(async () => {
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      setError(strings.presets.nameRequired);
      return;
    }
    setSaving(true);
    const saved = await presetRepo.savePreset({
      id: isNew ? undefined : id,
      name: trimmed,
      description: description.trim() || undefined,
      body,
    });
    await updatePreferences({ defaultPresetId: isDefault ? saved.id : null });
    setSaving(false);
    router.back();
  }, [body, description, id, isDefault, isNew, name, router, updatePreferences]);

  const remove = useCallback(async () => {
    if (isNew || !id) return;
    await presetRepo.deletePreset(id);
    if (preferences.defaultPresetId === id) {
      await updatePreferences({ defaultPresetId: null });
    }
    setDeleting(false);
    router.back();
  }, [id, isNew, preferences.defaultPresetId, router, updatePreferences]);

  if (!ready) return <View style={{ flex: 1, backgroundColor: palette.background }} />;

  return (
    <View style={{ flex: 1, backgroundColor: palette.background }}>
      <ScreenHeader
        title={isNew ? strings.presets.newPreset : strings.presets.editTitle}
        showBack
        right={
          <Button
            label={strings.common.save}
            variant="quiet"
            onPress={() => void save()}
            loading={saving}
          />
        }
      />

      <EditorScroll>
        <TextField
          label={strings.presets.nameLabel}
          value={name}
          onChangeText={(value) => {
            setName(value);
            setError(null);
          }}
          placeholder={strings.presets.nameLabel}
          hint={error ?? undefined}
        />
        <TextField
          label={strings.presets.descriptionLabel}
          value={description}
          onChangeText={setDescription}
          placeholder={strings.presets.descriptionLabel}
        />
        <TextField
          label={strings.presets.bodyLabel}
          value={body}
          onChangeText={setBody}
          placeholder={strings.presets.bodyPlaceholder}
          multiline
          style={{ minHeight: 180, textAlignVertical: 'top' }}
        />

        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: spacing.md,
          }}
        >
          <Text style={[type.body, { color: palette.text, flexShrink: 1 }]}>
            {strings.presets.defaultLabel}
          </Text>
          <Switch
            value={isDefault}
            onValueChange={setIsDefault}
            trackColor={{ false: palette.hairline, true: palette.accent }}
            thumbColor={palette.background}
            ios_backgroundColor={palette.hairline}
          />
        </View>

        {!isNew ? (
          <Button label={strings.common.delete} onPress={() => setDeleting(true)} />
        ) : null}
      </EditorScroll>

      <ConfirmSheet
        visible={deleting}
        title={strings.presets.deleteTitle}
        body={strings.presets.deleteBody}
        onConfirm={() => void remove()}
        onClose={() => setDeleting(false)}
      />
    </View>
  );
}

/**
 * The editor's scroll region, which is where a long system prompt gets typed.
 */
function EditorScroll({ children }: { children: React.ReactNode }): React.ReactElement {
  const theme = useTheme();
  const { spacing } = theme;
  const insets = useSafeAreaInsets();
  return (
    <KeyboardScroll
      contentContainerStyle={{
        padding: spacing.lg,
        paddingBottom: insets.bottom + spacing.xxxl,
        gap: spacing.lg,
      }}
    >
      {children}
    </KeyboardScroll>
  );
}
