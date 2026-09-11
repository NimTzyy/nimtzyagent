import Constants from 'expo-constants';
import * as WebBrowser from 'expo-web-browser';
import React, { useCallback, useState } from 'react';
import { Linking, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BUILTIN_MODELS, DEFAULT_BASE_URL } from '@/core/models';
import { isPeak, PRICES } from '@/core/pricing';
import { strings } from '@/lib/strings';
import { Divider, Row } from '@/ui/components/Basic';
import { ScreenHeader } from '@/ui/components/ScreenHeader';
import { useTheme } from '@/ui/components/ThemeProvider';

const DOCS_URL = 'https://api-docs.deepseek.com';

const TELEGRAM_URL = 'https://t.me/devfyntrix';
const EMAIL = 'nimtzy.klachana@hi2.in';
/**
 * Facebook is the one contact with no address to link to, so this opens a
 * search for the name rather than guessing at a profile that may not be theirs.
 */
const FACEBOOK_URL = 'https://www.facebook.com/search/top?q=Uon%20Nim';

function Lines({ lines }: { lines: string[] }): React.ReactElement {
  const theme = useTheme();
  const { palette, spacing, type } = theme;
  return (
    <View style={{ gap: spacing.sm }}>
      {lines.map((line) => (
        <Text key={line} style={[type.meta, { color: palette.textSecondary }]}>
          {line}
        </Text>
      ))}
    </View>
  );
}

export default function AboutScreen(): React.ReactElement {
  const theme = useTheme();
  const { palette, spacing, type } = theme;
  const insets = useSafeAreaInsets();

  const version = Constants.expoConfig?.version ?? '1.0.0';
  const peak = isPeak(new Date());
  const [notice, setNotice] = useState<string | null>(null);

  /**
   * Two ways out: a http link goes to the browser the app already opens, and
   * `mailto:` goes to the system resolver instead, since a browser cannot serve
   * it. Either can come back with nothing installed to handle it, and that is
   * worth saying rather than swallowing.
   */
  const open = useCallback(async (url: string) => {
    setNotice(null);
    try {
      if (url.startsWith('mailto:')) {
        await Linking.openURL(url);
      } else {
        await WebBrowser.openBrowserAsync(url);
      }
    } catch {
      setNotice(strings.settings.supportFailed);
    }
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: palette.background }}>
      <ScreenHeader title={strings.settings.aboutTitle} showBack />

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: spacing.lg,
          paddingBottom: insets.bottom + spacing.xxxl,
          gap: spacing.xl,
        }}
      >
        <View style={{ gap: spacing.xs }}>
          <Text style={[type.display, { color: palette.text }]}>{strings.appName}</Text>
          <Text style={[type.meta, type.tabular, { color: palette.textTertiary }]}>
            {strings.settings.version} {version}
          </Text>
        </View>

        <Lines
          lines={[
            strings.settings.aboutBody,
            'The key is stored in the device keychain and is sent only to the API you configure.',
            'No analytics, no tracking, no third-party services.',
          ]}
        />

        <View style={{ gap: spacing.sm }}>
          <Text style={[type.meta, { color: palette.textTertiary, textTransform: 'uppercase' }]}>
            {strings.models.title}
          </Text>
          <Lines
            lines={BUILTIN_MODELS.map(
              (model) =>
                `${model.label} (${model.id}): ${model.contextWindow / 1000}K context, ${
                  model.thinking ? 'thinking' : 'no thinking'
                }, ${model.vision ? 'vision' : 'no vision'}.`,
            )}
          />
        </View>

        <View style={{ gap: spacing.sm }}>
          <Text style={[type.meta, { color: palette.textTertiary, textTransform: 'uppercase' }]}>
            {strings.chat.estimatedCost}
          </Text>
          <Lines
            lines={[
              ...Object.entries(PRICES).map(
                ([id, price]) =>
                  `${id}: $${price.cacheHit} cached input, $${price.cacheMiss} input, $${price.output} output per million tokens.`,
              ),
              'Prices are off-peak. Peak hours are 01:00 to 04:00 and 06:00 to 10:00 UTC on weekdays and cost twice as much.',
              peak
                ? 'Peak pricing is in effect now.'
                : 'Off-peak pricing is in effect now.',
            ]}
          />
        </View>

        <View style={{ gap: spacing.sm }}>
          <Text style={[type.meta, { color: palette.textTertiary, textTransform: 'uppercase' }]}>
            {strings.settings.support}
          </Text>
          <Row
            onPress={() => void open(TELEGRAM_URL)}
            accessibilityLabel={`${strings.settings.supportTelegram} @devfyntrix`}
          >
            <Text style={[type.body, { color: palette.text }]}>
              {strings.settings.supportTelegram}
            </Text>
            <Text style={[type.meta, { color: palette.textTertiary, flexShrink: 1 }]}>
              @devfyntrix
            </Text>
          </Row>
          <Divider />
          <Row
            onPress={() => void open(FACEBOOK_URL)}
            accessibilityLabel={`${strings.settings.supportFacebook} Uon Nim`}
          >
            <Text style={[type.body, { color: palette.text }]}>
              {strings.settings.supportFacebook}
            </Text>
            <Text style={[type.meta, { color: palette.textTertiary, flexShrink: 1 }]}>
              Uon Nim
            </Text>
          </Row>
          <Divider />
          <Row
            onPress={() => void open(`mailto:${EMAIL}`)}
            accessibilityLabel={`${strings.settings.supportEmail} ${EMAIL}`}
          >
            <Text style={[type.body, { color: palette.text }]}>
              {strings.settings.supportEmail}
            </Text>
            <Text style={[type.meta, { color: palette.textTertiary, flexShrink: 1 }]}>{EMAIL}</Text>
          </Row>
          <Lines lines={[strings.settings.supportHint]} />
          {notice ? (
            <Text style={[type.meta, { color: palette.textSecondary }]}>{notice}</Text>
          ) : null}
        </View>

        <Divider />

        <Row onPress={() => void open(DOCS_URL)} accessibilityLabel={strings.settings.apiDocs}>
          <Text style={[type.body, { color: palette.text }]}>{strings.settings.apiDocs}</Text>
        </Row>
        <Divider />

        <Lines
          lines={[
            `Base URL: ${DEFAULT_BASE_URL}`,
            strings.settings.aboutLegal,
          ]}
        />
      </ScrollView>
    </View>
  );
}
