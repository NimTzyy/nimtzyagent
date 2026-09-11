import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DEFAULT_BASE_URL, DEFAULT_MODEL_ID } from '@/core/models';
import { testConnection } from '@/core/api';
import { strings } from '@/lib/strings';
import { useSettings } from '@/state/settings';
import { Button, KeyboardScroll, TextField } from '@/ui/components/Basic';
import { useTheme } from '@/ui/components/ThemeProvider';

/**
 * First run. The key is validated against the API before it is written to the
 * keychain, and it is never shown back to the user in full.
 */
export default function OnboardingScreen(): React.ReactElement {
  const theme = useTheme();
  const { palette, spacing, type } = theme;
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const setApiKey = useSettings((state) => state.setApiKey);
  const updatePreferences = useSettings((state) => state.updatePreferences);

  const [key, setKey] = useState('');
  const [baseUrl, setBaseUrl] = useState(DEFAULT_BASE_URL);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runTest = async (): Promise<boolean> => {
    if (key.trim().length === 0) {
      setError(strings.settings.keyRequired);
      setStatus(null);
      return false;
    }
    setTesting(true);
    setError(null);
    const result = await testConnection(key.trim(), baseUrl, DEFAULT_MODEL_ID);
    setTesting(false);
    setStatus({ ok: result.ok, message: result.message });
    return result.ok;
  };

  const finish = async (): Promise<void> => {
    if (key.trim().length === 0) {
      setError(strings.onboarding.missingKey);
      return;
    }
    setSaving(true);
    setError(null);
    await setApiKey(key);
    await updatePreferences({ baseUrl: baseUrl.trim() || DEFAULT_BASE_URL });
    setSaving(false);
    router.replace('/');
  };

  return (
    <KeyboardScroll
      contentContainerStyle={{
        paddingTop: insets.top + spacing.xxxl,
        paddingBottom: insets.bottom + spacing.xxl,
        paddingHorizontal: spacing.xl,
        gap: spacing.xl,
        flexGrow: 1,
      }}
    >
        <View style={{ gap: spacing.sm }}>
          <Text style={[type.display, { color: palette.text }]}>{strings.appName}</Text>
          <Text style={[type.body, { color: palette.textSecondary }]}>{strings.onboarding.tagline}</Text>
        </View>

        <View style={{ gap: spacing.lg }}>
          <TextField
            label={strings.onboarding.apiKeyLabel}
            value={key}
            onChangeText={(value) => {
              setKey(value);
              setStatus(null);
              setError(null);
            }}
            placeholder={strings.onboarding.apiKeyPlaceholder}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
          />
          <TextField
            label={strings.onboarding.baseUrlLabel}
            value={baseUrl}
            onChangeText={setBaseUrl}
            placeholder={DEFAULT_BASE_URL}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
        </View>

        {error ? (
          <Text style={[type.meta, { color: palette.text }]}>{error}</Text>
        ) : null}

        {status ? (
          <View
            style={{
              borderColor: palette.hairline,
              borderWidth: 1,
              borderRadius: theme.radius.md,
              paddingHorizontal: spacing.lg,
              paddingVertical: spacing.md,
            }}
          >
            <Text style={[type.meta, { color: status.ok ? palette.accent : palette.textSecondary }]}>
              {status.message}
            </Text>
          </View>
        ) : null}

        <Text style={[type.meta, { color: palette.textTertiary }]}>{strings.onboarding.help}</Text>

        <View style={{ gap: spacing.sm, marginTop: 'auto' }}>
          <Button
            label={testing ? strings.onboarding.testing : strings.onboarding.testConnection}
            onPress={() => void runTest()}
            loading={testing}
          />
          <Button
            label={strings.onboarding.continueLabel}
            variant="primary"
            onPress={() => void finish()}
            loading={saving}
            disabled={key.trim().length === 0}
          />
        </View>
    </KeyboardScroll>
  );
}
