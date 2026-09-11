import { useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { allModels } from '@/core/models';
import type { ModelInfo } from '@/core/types';
import * as conversationRepo from '@/db/conversations';
import { strings } from '@/lib/strings';
import { useChat } from '@/state/chat';
import { useSettings } from '@/state/settings';
import { Badge, Button, Divider, Sheet, TextField } from '@/ui/components/Basic';
import { Check, Trash } from '@/ui/components/icons';
import { ScreenHeader } from '@/ui/components/ScreenHeader';
import { useTheme } from '@/ui/components/ThemeProvider';

function CapabilityRow({ model }: { model: ModelInfo }): React.ReactElement {
  const theme = useTheme();
  const { palette, spacing, type } = theme;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, alignItems: 'center' }}>
      <Text style={[type.meta, type.tabular, { color: palette.textTertiary }]}>
        {model.contextWindow / 1000}K context
      </Text>
      {model.thinking ? <Badge label={strings.models.thinking} tone="accent" /> : null}
      {model.vision ? <Badge label={strings.models.vision} /> : null}
      {model.tools === false ? <Badge label={strings.models.noTools} /> : null}
      {model.legacy ? <Badge label={strings.models.legacy} /> : null}
      {model.custom ? <Badge label={strings.models.custom} /> : null}
    </View>
  );
}

export default function ModelsScreen(): React.ReactElement {
  const theme = useTheme();
  const { palette, spacing, type } = theme;
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const customModels = useSettings((state) => state.preferences.customModels);
  const defaultModel = useSettings((state) => state.preferences.defaultModel);
  const updatePreferences = useSettings((state) => state.updatePreferences);
  const conversation = useChat((state) => state.conversation);
  const streaming = useChat((state) => state.streaming);

  const [adding, setAdding] = useState(false);
  const [customId, setCustomId] = useState('');
  const [customThinking, setCustomThinking] = useState(true);
  const [customVision, setCustomVision] = useState(true);
  const [customTools, setCustomTools] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<ModelInfo | null>(null);

  const selectedId = conversation?.model ?? defaultModel;
  const models = allModels(customModels);

  const choose = useCallback(
    async (model: ModelInfo) => {
      if (streaming) return;
      const active = useChat.getState().conversation;
      if (active) {
        await conversationRepo.updateConversation(active.id, { model: model.id });
        useChat.setState({ conversation: { ...active, model: model.id } });
      } else {
        await updatePreferences({ defaultModel: model.id });
      }
      router.back();
    },
    [router, streaming, updatePreferences],
  );

  const addCustom = useCallback(async () => {
    const id = customId.trim();
    if (id.length === 0) {
      setFormError(strings.models.customIdLabel);
      return;
    }
    await updatePreferences({
      customModels: [
        ...customModels.filter((model) => model.id !== id),
        {
          id,
          label: id,
          description: strings.models.custom,
          thinking: customThinking,
          vision: customVision,
          tools: customTools,
          contextWindow: 1_000_000,
          maxOutput: 384_000,
          custom: true,
        },
      ],
    });
    setAdding(false);
    setCustomId('');
    setFormError(null);
  }, [customId, customModels, customThinking, customTools, customVision, updatePreferences]);

  const removeCustom = useCallback(
    async (model: ModelInfo) => {
      await updatePreferences({
        customModels: customModels.filter((candidate) => candidate.id !== model.id),
      });
      setRemoving(null);
    },
    [customModels, updatePreferences],
  );

  return (
    <View style={{ flex: 1, backgroundColor: palette.background }}>
      <ScreenHeader
        title={strings.models.title}
        showBack
        right={
          <Button label={strings.common.add} variant="quiet" onPress={() => setAdding(true)} />
        }
      />

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: spacing.lg,
          paddingBottom: insets.bottom + spacing.xxxl,
        }}
      >
        {conversation ? (
          <Text style={[type.meta, { color: palette.textTertiary, paddingVertical: spacing.md }]}>
            {strings.models.switchedMidChat}
          </Text>
        ) : null}

        {models.map((model) => {
          const current = model.id === selectedId;
          return (
            <Pressable
              key={model.id}
              onPress={() => void choose(model)}
              onLongPress={model.custom ? () => setRemoving(model) : undefined}
              accessibilityRole="button"
              accessibilityLabel={model.label}
              style={({ pressed }) => ({ opacity: pressed ? 0.65 : 1 })}
            >
              <View style={{ paddingVertical: spacing.lg, gap: spacing.sm }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                  <Text style={[type.bodyStrong, { color: palette.text, flexShrink: 1 }]}>
                    {model.label}
                  </Text>
                  {current ? (
                    <Check size={16} color={palette.accent} strokeWidth={1.5} />
                  ) : null}
                  {model.custom ? (
                    <Pressable
                      onPress={() => setRemoving(model)}
                      accessibilityRole="button"
                      accessibilityLabel={strings.models.removeCustom}
                      hitSlop={10}
                      style={{ marginLeft: 'auto' }}
                    >
                      <Trash size={16} color={palette.textTertiary} strokeWidth={1.5} />
                    </Pressable>
                  ) : null}
                </View>
                <Text style={[type.meta, { color: palette.textSecondary }]}>{model.description}</Text>
                <CapabilityRow model={model} />
              </View>
              <Divider />
            </Pressable>
          );
        })}
      </ScrollView>

      <Sheet visible={adding} onClose={() => setAdding(false)} title={strings.models.addCustom}>
        <TextField
          label={strings.models.customIdLabel}
          value={customId}
          onChangeText={setCustomId}
          placeholder={strings.models.customIdPlaceholder}
          autoCapitalize="none"
          autoCorrect={false}
          hint={formError ?? undefined}
        />
        <ToggleRow
          label={strings.models.customThinking}
          value={customThinking}
          onChange={setCustomThinking}
        />
        <ToggleRow label={strings.models.customVision} value={customVision} onChange={setCustomVision} />
        <ToggleRow label={strings.models.customTools} value={customTools} onChange={setCustomTools} />
        <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
          <View style={{ flex: 1 }}>
            <Button label={strings.common.cancel} onPress={() => setAdding(false)} />
          </View>
          <View style={{ flex: 1 }}>
            <Button label={strings.common.add} variant="primary" onPress={() => void addCustom()} />
          </View>
        </View>
      </Sheet>

      <Sheet
        visible={removing !== null}
        onClose={() => setRemoving(null)}
        title={strings.models.removeCustom}
      >
        <Text style={[type.body, { color: palette.textSecondary }]}>{removing?.id}</Text>
        <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
          <View style={{ flex: 1 }}>
            <Button label={strings.common.cancel} onPress={() => setRemoving(null)} />
          </View>
          <View style={{ flex: 1 }}>
            <Button
              label={strings.common.delete}
              variant="primary"
              onPress={() => removing && void removeCustom(removing)}
            />
          </View>
        </View>
      </Sheet>
    </View>
  );
}

function ToggleRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (next: boolean) => void;
}): React.ReactElement {
  const theme = useTheme();
  const { palette, spacing, type } = theme;
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: spacing.md,
        paddingVertical: spacing.sm,
      }}
    >
      <Text style={[type.body, { color: palette.text }]}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: palette.hairline, true: palette.accent }}
        thumbColor={palette.background}
        ios_backgroundColor={palette.hairline}
      />
    </View>
  );
}
