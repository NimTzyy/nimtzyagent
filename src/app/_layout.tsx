import { Stack, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { getDatabase } from '@/db';
import { strings } from '@/lib/strings';
import { useSettings } from '@/state/settings';
import { ThemeProvider, useTheme } from '@/ui/components/ThemeProvider';

void SplashScreen.preventAutoHideAsync();

type Bootstrap = 'loading' | 'ready' | 'failed';

function RootNavigator(): React.ReactElement {
  const theme = useTheme();
  const { palette, spacing, type } = theme;
  const [bootstrap, setBootstrap] = useState<Bootstrap>('loading');
  const [failure, setFailure] = useState('');

  const ready = useSettings((state) => state.ready);
  const hasApiKey = useSettings((state) => state.hasApiKey);
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await getDatabase();
        await useSettings.getState().load();
        if (!cancelled) setBootstrap('ready');
      } catch (error) {
        if (!cancelled) {
          setFailure(error instanceof Error ? error.message : strings.errors.title);
          setBootstrap('failed');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const onOnboarding = segments[0] === 'onboarding';

  useEffect(() => {
    if (!ready || bootstrap !== 'ready') return;
    if (!hasApiKey && !onOnboarding) {
      router.replace('/onboarding');
    } else if (hasApiKey && onOnboarding) {
      router.replace('/');
    }
  }, [bootstrap, hasApiKey, onOnboarding, ready, router]);

  useEffect(() => {
    if (bootstrap !== 'loading') void SplashScreen.hideAsync();
  }, [bootstrap]);

  if (bootstrap === 'loading') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.background }}>
        <ActivityIndicator color={palette.textTertiary} />
      </View>
    );
  }

  if (bootstrap === 'failed') {
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          gap: spacing.sm,
          padding: spacing.xxl,
          backgroundColor: palette.background,
        }}
      >
        <Text style={[type.bodyStrong, { color: palette.text }]}>{strings.errors.title}</Text>
        <Text style={[type.meta, { color: palette.textSecondary, textAlign: 'center' }]}>{failure}</Text>
      </View>
    );
  }

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: 'slide_from_right',
        contentStyle: { backgroundColor: palette.background },
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen name="onboarding" options={{ animation: 'fade' }} />
      <Stack.Screen name="chat/[id]" />
      <Stack.Screen name="models" options={{ animation: 'slide_from_bottom' }} />
      <Stack.Screen name="presets/index" />
      <Stack.Screen name="presets/[id]" />
      <Stack.Screen name="preview/[messageId]" />
      <Stack.Screen name="settings/index" />
      <Stack.Screen name="settings/about" />
    </Stack>
  );
}

function ThemedStatusBar(): React.ReactElement {
  const theme = useTheme();
  return <StatusBar style={theme.scheme === 'dark' ? 'light' : 'dark'} />;
}

export default function RootLayout(): React.ReactElement {
  return (
    // Android 15+ enforces edge-to-edge for apps targeting SDK 35 and above,
    // which silently disables the window resize that `adjustResize` used to
    // perform. KeyboardAvoidingView has nothing to react to then, and the
    // keyboard covers the composer. The provider publishes keyboard height
    // from the window insets instead, so the sticky composer can follow it.
    <KeyboardProvider>
      <SafeAreaProvider>
        <ThemeProvider>
          <ThemedStatusBar />
          <RootNavigator />
        </ThemeProvider>
      </SafeAreaProvider>
    </KeyboardProvider>
  );
}
