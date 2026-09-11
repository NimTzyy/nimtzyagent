import { useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { testConnection, type ReasoningEffort } from '@/core/api';
import { resolveModel } from '@/core/models';
import { SEARCH_PROVIDER_IDS, type SearchProvider } from '@/core/search';
import * as conversationRepo from '@/db/conversations';
import { exportAllConversations } from '@/lib/export';
import { strings } from '@/lib/strings';
import { testWorkspace, type WorkspaceCheck } from '@/lib/workspace';
import { useSettings, type ThemePreference } from '@/state/settings';
import { Button, Divider, KeyboardScroll, Row, Segmented, TextField } from '@/ui/components/Basic';
import { ConfirmSheet, PromptSheet } from '@/ui/components/Dialogs';
import { ChevronRight } from '@/ui/components/icons';
import { ScreenHeader } from '@/ui/components/ScreenHeader';
import { useTheme } from '@/ui/components/ThemeProvider';

/** Only the tail of the key is ever shown: enough to identify it, not to use it. */
function maskKey(key: string): string {
  if (key.length === 0) return strings.settings.noKeySet;
  if (key.length <= 4) return '•'.repeat(key.length);
  return `••••••••${key.slice(-4)}`;
}

function Section({ title, children }: { title: string; children: React.ReactNode }): React.ReactElement {
  const theme = useTheme();
  const { palette, spacing, type } = theme;
  return (
    <View style={{ gap: spacing.sm }}>
      <Text style={[type.meta, { color: palette.textTertiary, textTransform: 'uppercase' }]}>
        {title}
      </Text>
      <View>{children}</View>
    </View>
  );
}

function SwitchRow({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (next: boolean) => void;
}): React.ReactElement {
  const theme = useTheme();
  const { palette, type } = theme;
  return (
    <Row>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[type.body, { color: palette.text }]}>{label}</Text>
        {hint ? <Text style={[type.meta, { color: palette.textTertiary }]}>{hint}</Text> : null}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: palette.hairline, true: palette.accent }}
        thumbColor={palette.background}
        ios_backgroundColor={palette.hairline}
      />
    </Row>
  );
}

export default function SettingsScreen(): React.ReactElement {
  const theme = useTheme();
  const { palette, spacing, type } = theme;
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const preferences = useSettings((state) => state.preferences);
  const apiKey = useSettings((state) => state.apiKey);
  const hasApiKey = useSettings((state) => state.hasApiKey);
  const updatePreferences = useSettings((state) => state.updatePreferences);
  const setApiKey = useSettings((state) => state.setApiKey);
  const clearApiKey = useSettings((state) => state.clearApiKey);
  const searchApiKey = useSettings((state) => state.searchApiKey);
  const setSearchApiKey = useSettings((state) => state.setSearchApiKey);
  const workspace = useSettings((state) => state.workspace);
  const chooseWorkspace = useSettings((state) => state.chooseWorkspace);
  const forgetWorkspace = useSettings((state) => state.forgetWorkspace);

  const [keySheet, setKeySheet] = useState(false);
  const [promptSheet, setPromptSheet] = useState(false);
  const [searchKeySheet, setSearchKeySheet] = useState(false);
  const [clearKeySheet, setClearKeySheet] = useState(false);
  const [clearDataSheet, setClearDataSheet] = useState(false);
  const [baseUrl, setBaseUrl] = useState(preferences.baseUrl);
  const [maxTokens, setMaxTokens] = useState(
    preferences.maxTokens === null ? '' : String(preferences.maxTokens),
  );
  const [testing, setTesting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [checkingFolder, setCheckingFolder] = useState(false);
  const [folderCheck, setFolderCheck] = useState<WorkspaceCheck | null>(null);

  const model = resolveModel(preferences.defaultModel, preferences.customModels);

  const runTest = useCallback(async () => {
    setTesting(true);
    setNotice(null);
    const result = await testConnection(apiKey, preferences.baseUrl, preferences.defaultModel);
    setTesting(false);
    setNotice(result.message);
  }, [apiKey, preferences.baseUrl, preferences.defaultModel]);

  const pickFolder = useCallback(async () => {
    const result = await chooseWorkspace();
    if (result.status === 'error') setNotice(result.message);
    // A new folder has not been tried yet, so the last result is about a
    // folder that is no longer the one on screen.
    setFolderCheck(null);
  }, [chooseWorkspace]);

  const checkFolder = useCallback(async () => {
    if (!workspace) return;
    setCheckingFolder(true);
    setFolderCheck(null);
    try {
      setFolderCheck(await testWorkspace(workspace));
    } catch (error) {
      setFolderCheck({
        ok: false,
        step: strings.workspace.checkOpen,
        message: error instanceof Error ? error.message : '',
      });
    } finally {
      setCheckingFolder(false);
    }
  }, [workspace]);

  const commitBaseUrl = useCallback(async () => {
    const next = baseUrl.trim();
    if (next.length === 0 || next === preferences.baseUrl) return;
    await updatePreferences({ baseUrl: next });
    setNotice(strings.settings.keySaved);
  }, [baseUrl, preferences.baseUrl, updatePreferences]);

  const commitMaxTokens = useCallback(async () => {
    const parsed = Number.parseInt(maxTokens.trim(), 10);
    const next = Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    if (next === preferences.maxTokens) return;
    await updatePreferences({ maxTokens: next });
  }, [maxTokens, preferences.maxTokens, updatePreferences]);

  const exportAll = useCallback(async () => {
    const conversations = await conversationRepo.listConversations();
    if (conversations.length === 0) {
      setNotice(strings.conversations.exportEmpty);
      return;
    }
    const result = await exportAllConversations(conversations);
    if (result.error) setNotice(result.error);
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: palette.background }}>
      <ScreenHeader title={strings.settings.title} showBack />

      <KeyboardScroll
        contentContainerStyle={{
          paddingHorizontal: spacing.lg,
          paddingBottom: insets.bottom + spacing.xxxl,
          gap: spacing.xxl,
        }}
      >
        <Section title={strings.settings.account}>
          <Row onPress={() => setKeySheet(true)} accessibilityLabel={strings.settings.apiKeyLabel}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[type.body, { color: palette.text }]}>{strings.settings.apiKeyLabel}</Text>
              <Text style={[type.meta, type.tabular, { color: palette.textTertiary }]}>
                {maskKey(apiKey)}
              </Text>
            </View>
            <ChevronRight size={17} color={palette.textTertiary} strokeWidth={1.5} />
          </Row>
          <Divider />
          <View style={{ paddingVertical: spacing.md, gap: spacing.md }}>
            <TextField
              label={strings.settings.baseUrlLabel}
              value={baseUrl}
              onChangeText={setBaseUrl}
              onBlur={() => void commitBaseUrl()}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              hint={strings.settings.baseUrlHint}
            />
            <Button
              label={testing ? strings.settings.testing : strings.settings.testConnection}
              onPress={() => void runTest()}
              loading={testing}
              disabled={!hasApiKey}
            />
          </View>
          <Divider />
          <Row>
            <Text style={[type.meta, { color: palette.textTertiary, flex: 1 }]}>
              {strings.settings.balanceNote}
            </Text>
          </Row>
        </Section>

        {notice ? (
          <Text style={[type.meta, { color: palette.textSecondary, marginTop: -spacing.md }]}>
            {notice}
          </Text>
        ) : null}

        <Section title={strings.settings.generation}>
          <Row onPress={() => router.push('/models')} accessibilityLabel={strings.settings.defaultModel}>
            <Text style={[type.body, { color: palette.text }]}>{strings.settings.defaultModel}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
              <Text style={[type.meta, { color: palette.textSecondary }]}>{model.label}</Text>
              <ChevronRight size={17} color={palette.textTertiary} strokeWidth={1.5} />
            </View>
          </Row>
          <Divider />
          <SwitchRow
            label={strings.settings.thinking}
            hint={strings.settings.thinkingHint}
            value={preferences.thinking}
            onChange={(next) => void updatePreferences({ thinking: next })}
          />
          <Divider />
          <View style={{ paddingVertical: spacing.md, gap: spacing.sm }}>
            <Text style={[type.body, { color: palette.text }]}>{strings.settings.reasoningEffort}</Text>
            <Segmented<ReasoningEffort>
              value={preferences.reasoningEffort}
              onChange={(next) => void updatePreferences({ reasoningEffort: next })}
              options={[
                { value: 'low', label: strings.settings.reasoningLow },
                { value: 'high', label: strings.settings.reasoningHigh },
                { value: 'max', label: strings.settings.reasoningMax },
              ]}
            />
            <Text style={[type.meta, { color: palette.textTertiary }]}>
              {strings.settings.reasoningHint}
            </Text>
            {!preferences.thinking ? (
              <Text style={[type.meta, { color: palette.textTertiary }]}>
                {strings.settings.paramIgnoredThinking}
              </Text>
            ) : null}
          </View>
          <Divider />
          <View style={{ paddingVertical: spacing.md }}>
            <TextField
              label={strings.settings.maxTokens}
              value={maxTokens}
              onChangeText={setMaxTokens}
              onBlur={() => void commitMaxTokens()}
              keyboardType="number-pad"
              placeholder="384000"
              hint={strings.settings.maxTokensHint}
            />
          </View>
        </Section>

        <Section title={strings.settings.systemPrompt}>
          <Row onPress={() => setPromptSheet(true)} accessibilityLabel={strings.settings.systemPromptDefault}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[type.body, { color: palette.text }]}>
                {strings.settings.systemPromptDefault}
              </Text>
              <Text style={[type.meta, { color: palette.textTertiary }]} numberOfLines={3}>
                {preferences.defaultSystemPrompt.trim().length > 0
                  ? preferences.defaultSystemPrompt.trim()
                  : strings.settings.systemPromptNone}
              </Text>
            </View>
            <ChevronRight size={17} color={palette.textTertiary} strokeWidth={1.5} />
          </Row>
          <Divider />
          <Row onPress={() => router.push('/presets')} accessibilityLabel={strings.settings.presetsRow}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[type.body, { color: palette.text }]}>
                {strings.settings.presetsRow}
              </Text>
              <Text style={[type.meta, { color: palette.textTertiary }]}>
                {strings.settings.presetsRowHint}
              </Text>
            </View>
            <ChevronRight size={17} color={palette.textTertiary} strokeWidth={1.5} />
          </Row>
          <Divider />
          <Row>
            <Text style={[type.meta, { color: palette.textTertiary, flex: 1 }]}>
              {strings.settings.systemPromptHint}
            </Text>
          </Row>
        </Section>

        <Section title={strings.agent.title}>
          <SwitchRow
            label={strings.agent.tools}
            hint={strings.agent.toolsHint}
            value={preferences.agentEnabled}
            onChange={(next) => void updatePreferences({ agentEnabled: next })}
          />
          <Divider />
          <Row onPress={() => void pickFolder()} accessibilityLabel={strings.agent.workspace}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[type.body, { color: palette.text }]}>{strings.agent.workspace}</Text>
              <Text style={[type.meta, { color: palette.textTertiary }]} numberOfLines={1}>
                {workspace ? workspace.name : strings.agent.none}
              </Text>
            </View>
            <Text style={[type.metaStrong, { color: palette.accent }]}>
              {workspace ? strings.agent.change : strings.agent.choose}
            </Text>
          </Row>
          {workspace ? (
            <>
              <Divider />
              <Row
                onPress={() => void checkFolder()}
                accessibilityLabel={strings.workspace.check}
              >
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={[type.body, { color: palette.text }]}>
                    {strings.workspace.check}
                  </Text>
                  <Text style={[type.meta, { color: palette.textTertiary }]}>
                    {strings.workspace.checkHint}
                  </Text>
                </View>
                <Text style={[type.metaStrong, { color: palette.accent }]}>
                  {checkingFolder ? strings.workspace.checkRunning : strings.workspace.checkRun}
                </Text>
              </Row>
              {folderCheck ? (
                <>
                  <Divider />
                  <View style={{ paddingVertical: spacing.md, gap: spacing.xs }}>
                    <Text style={[type.meta, { color: palette.textSecondary }]}>
                      {folderCheck.ok
                        ? strings.workspace.checkOk
                        : strings.workspace.checkFailed(folderCheck.step ?? '')}
                    </Text>
                    {folderCheck.ok || !folderCheck.message ? null : (
                      // The device's own words. Paraphrasing them would hide
                      // the one thing that says which layer refused.
                      <Text style={[type.meta, { color: palette.textTertiary }]}>
                        {folderCheck.message}
                      </Text>
                    )}
                    {folderCheck.leftBehind ? (
                      <Text style={[type.meta, { color: palette.textTertiary }]}>
                        {strings.workspace.checkLeftBehind}
                      </Text>
                    ) : null}
                  </View>
                </>
              ) : null}
              <Divider />
              <Row onPress={() => void forgetWorkspace()} accessibilityLabel={strings.agent.forget}>
                <Text style={[type.body, { color: palette.textSecondary }]}>
                  {strings.agent.forget}
                </Text>
              </Row>
            </>
          ) : null}
          <Divider />
          <Row>
            <Text style={[type.meta, { color: palette.textTertiary, flex: 1 }]}>
              {strings.agent.workspaceHint}
            </Text>
          </Row>
        </Section>

        <Section title={strings.research.title}>
          <SwitchRow
            label={strings.research.toggle}
            hint={strings.research.providerHint}
            value={preferences.researchEnabled}
            onChange={(next) => void updatePreferences({ researchEnabled: next })}
          />
          <Divider />
          <View style={{ paddingVertical: spacing.md, gap: spacing.sm }}>
            <Text style={[type.body, { color: palette.text }]}>{strings.research.provider}</Text>
            <Segmented<SearchProvider>
              value={preferences.searchProvider}
              onChange={(next) => void updatePreferences({ searchProvider: next })}
              options={SEARCH_PROVIDER_IDS.map((id) => ({
                value: id,
                label: strings.research.providerLabel[id],
              }))}
            />
          </View>
          {preferences.searchProvider === 'serper' ? (
            <>
              <Divider />
              <Row onPress={() => setSearchKeySheet(true)} accessibilityLabel={strings.research.serperKey}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={[type.body, { color: palette.text }]}>{strings.research.serperKey}</Text>
                  <Text style={[type.meta, type.tabular, { color: palette.textTertiary }]}>
                    {maskKey(searchApiKey)}
                  </Text>
                </View>
                <ChevronRight size={17} color={palette.textTertiary} strokeWidth={1.5} />
              </Row>
              <Row>
                <Text style={[type.meta, { color: palette.textTertiary, flex: 1 }]}>
                  {searchApiKey.length > 0 ? strings.research.serperKeyHint : strings.research.keyRequired}
                </Text>
              </Row>
            </>
          ) : null}
        </Section>

        <Section title={strings.settings.appearance}>
          <View style={{ paddingVertical: spacing.md, gap: spacing.sm }}>
            <Text style={[type.body, { color: palette.text }]}>{strings.settings.theme}</Text>
            <Segmented<ThemePreference>
              value={preferences.theme}
              onChange={(next) => void updatePreferences({ theme: next })}
              options={[
                { value: 'system', label: strings.settings.themeSystem },
                { value: 'dark', label: strings.settings.themeDark },
                { value: 'light', label: strings.settings.themeLight },
              ]}
            />
          </View>
        </Section>

        <Section title={strings.settings.behaviour}>
          <SwitchRow
            label={strings.settings.streamResponses}
            value={preferences.streaming}
            onChange={(next) => void updatePreferences({ streaming: next })}
          />
          <Divider />
          <SwitchRow
            label={strings.settings.haptics}
            value={preferences.haptics}
            onChange={(next) => void updatePreferences({ haptics: next })}
          />
        </Section>

        <Section title={strings.settings.data}>
          <Row onPress={() => void exportAll()} accessibilityLabel={strings.settings.exportAll}>
            <Text style={[type.body, { color: palette.text }]}>{strings.settings.exportAll}</Text>
            <ChevronRight size={17} color={palette.textTertiary} strokeWidth={1.5} />
          </Row>
          <Divider />
          <Row onPress={() => setClearDataSheet(true)} accessibilityLabel={strings.settings.clearAll}>
            <Text style={[type.body, { color: palette.text }]}>{strings.settings.clearAll}</Text>
            <ChevronRight size={17} color={palette.textTertiary} strokeWidth={1.5} />
          </Row>
        </Section>

        <Section title={strings.settings.aboutTitle}>
          <Row onPress={() => router.push('/settings/about')} accessibilityLabel={strings.settings.about}>
            <Text style={[type.body, { color: palette.text }]}>{strings.settings.about}</Text>
            <ChevronRight size={17} color={palette.textTertiary} strokeWidth={1.5} />
          </Row>
        </Section>
      </KeyboardScroll>

      <PromptSheet
        visible={keySheet}
        title={hasApiKey ? strings.settings.keyReplaced : strings.settings.apiKeyLabel}
        label={strings.settings.apiKeyLabel}
        placeholder={strings.settings.apiKeyPlaceholder}
        confirmLabel={strings.common.save}
        onConfirm={(value) => {
          setKeySheet(false);
          void setApiKey(value).then(() => setNotice(strings.settings.keySaved));
        }}
        onClose={() => setKeySheet(false)}
      />

      <PromptSheet
        visible={promptSheet}
        title={strings.settings.systemPrompt}
        label={strings.settings.systemPromptDefault}
        placeholder={strings.presets.bodyPlaceholder}
        initialValue={preferences.defaultSystemPrompt}
        confirmLabel={strings.common.save}
        onConfirm={(value) => {
          setPromptSheet(false);
          void updatePreferences({ defaultSystemPrompt: value.trim() });
        }}
        onClose={() => setPromptSheet(false)}
      />

      <PromptSheet
        visible={searchKeySheet}
        title={strings.research.serperKey}
        label={strings.research.serperKey}
        placeholder={strings.research.serperKeyPlaceholder}
        confirmLabel={strings.common.save}
        initialValue={searchApiKey}
        onConfirm={(value) => {
          setSearchKeySheet(false);
          void setSearchApiKey(value);
        }}
        onClose={() => setSearchKeySheet(false)}
      />

      <ConfirmSheet
        visible={clearKeySheet}
        title={strings.settings.clearKeyTitle}
        body={strings.settings.clearKeyBody}
        confirmLabel={strings.common.delete}
        onConfirm={() => {
          setClearKeySheet(false);
          void clearApiKey().then(() => setNotice(strings.settings.keyCleared));
        }}
        onClose={() => setClearKeySheet(false)}
      />

      <ConfirmSheet
        visible={clearDataSheet}
        title={strings.settings.clearAllTitle}
        body={strings.settings.clearAllBody}
        onConfirm={() => {
          setClearDataSheet(false);
          void conversationRepo
            .deleteAllConversations()
            .then(() => setNotice(strings.settings.cleared));
        }}
        onClose={() => setClearDataSheet(false)}
      />

      {hasApiKey ? (
        <View style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.lg }}>
          <Button label={strings.settings.clearKeyTitle} onPress={() => setClearKeySheet(true)} />
        </View>
      ) : null}
    </View>
  );
}
