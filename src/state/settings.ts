import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';

import { DEFAULT_BASE_URL, DEFAULT_MODEL_ID } from '@/core/models';
import type { ReasoningEffort } from '@/core/api';
import type { SearchProvider } from '@/core/search';
import type { ModelInfo } from '@/core/types';
import {
  clearWorkspace,
  loadWorkspace,
  pickWorkspace,
  type PickWorkspaceResult,
  type Workspace,
} from '@/lib/workspace';

const PREFERENCES_KEY = 'nimtzyagent.preferences.v1';
const API_KEY_KEY = 'nimtzyagent.api-key';
/** Separate from the DeepSeek key: it is a different account and a different service. */
const SEARCH_KEY_KEY = 'nimtzyagent.search-key';

export type ThemePreference = 'system' | 'dark' | 'light';

export interface Preferences {
  baseUrl: string;
  theme: ThemePreference;
  defaultModel: string;
  customModels: ModelInfo[];
  thinking: boolean;
  reasoningEffort: ReasoningEffort;
  maxTokens: number | null;
  streaming: boolean;
  haptics: boolean;
  defaultPresetId: string | null;
  /** Starting prompt for new chats. A chosen preset takes precedence over it. */
  defaultSystemPrompt: string;
  /** Agent file tools. Off by default: they write to the device. */
  agentEnabled: boolean;
  /** The `search_web` tool. */
  researchEnabled: boolean;
  searchProvider: SearchProvider;
}

const DEFAULT_PREFERENCES: Preferences = {
  baseUrl: DEFAULT_BASE_URL,
  theme: 'dark',
  defaultModel: DEFAULT_MODEL_ID,
  customModels: [],
  thinking: true,
  reasoningEffort: 'high',
  maxTokens: null,
  streaming: true,
  haptics: true,
  defaultPresetId: null,
  defaultSystemPrompt: '',
  agentEnabled: false,
  researchEnabled: false,
  searchProvider: 'duckduckgo',
};

interface SettingsState {
  ready: boolean;
  preferences: Preferences;
  apiKey: string;
  hasApiKey: boolean;
  searchApiKey: string;
  hasSearchKey: boolean;
  /** The folder agent mode writes into, or null when none has been picked. */
  workspace: Workspace | null;
  load: () => Promise<void>;
  updatePreferences: (patch: Partial<Preferences>) => Promise<void>;
  setApiKey: (key: string) => Promise<void>;
  clearApiKey: () => Promise<void>;
  setSearchApiKey: (key: string) => Promise<void>;
  chooseWorkspace: () => Promise<PickWorkspaceResult>;
  forgetWorkspace: () => Promise<void>;
}

async function readPreferences(): Promise<Preferences> {
  try {
    const raw = await AsyncStorage.getItem(PREFERENCES_KEY);
    if (!raw) return DEFAULT_PREFERENCES;
    const parsed = JSON.parse(raw) as Partial<Preferences>;
    return { ...DEFAULT_PREFERENCES, ...parsed };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

export const useSettings = create<SettingsState>((set, get) => ({
  ready: false,
  preferences: DEFAULT_PREFERENCES,
  apiKey: '',
  hasApiKey: false,
  searchApiKey: '',
  hasSearchKey: false,
  workspace: null,

  load: async () => {
    const [preferences, apiKey, searchApiKey, workspace] = await Promise.all([
      readPreferences(),
      SecureStore.getItemAsync(API_KEY_KEY).catch(() => null),
      SecureStore.getItemAsync(SEARCH_KEY_KEY).catch(() => null),
      loadWorkspace(),
    ]);
    set({
      preferences,
      apiKey: apiKey ?? '',
      hasApiKey: Boolean(apiKey && apiKey.trim().length > 0),
      searchApiKey: searchApiKey ?? '',
      hasSearchKey: Boolean(searchApiKey && searchApiKey.trim().length > 0),
      workspace,
      ready: true,
    });
  },

  updatePreferences: async (patch) => {
    const next = { ...get().preferences, ...patch };
    set({ preferences: next });
    await AsyncStorage.setItem(PREFERENCES_KEY, JSON.stringify(next));
  },

  setApiKey: async (key) => {
    const trimmed = key.trim();
    if (trimmed.length === 0) {
      await SecureStore.deleteItemAsync(API_KEY_KEY).catch(() => undefined);
      set({ apiKey: '', hasApiKey: false });
      return;
    }
    await SecureStore.setItemAsync(API_KEY_KEY, trimmed);
    set({ apiKey: trimmed, hasApiKey: true });
  },

  clearApiKey: async () => {
    await SecureStore.deleteItemAsync(API_KEY_KEY).catch(() => undefined);
    set({ apiKey: '', hasApiKey: false });
  },

  setSearchApiKey: async (key) => {
    const trimmed = key.trim();
    if (trimmed.length === 0) {
      await SecureStore.deleteItemAsync(SEARCH_KEY_KEY).catch(() => undefined);
      set({ searchApiKey: '', hasSearchKey: false });
      return;
    }
    await SecureStore.setItemAsync(SEARCH_KEY_KEY, trimmed);
    set({ searchApiKey: trimmed, hasSearchKey: true });
  },

  chooseWorkspace: async () => {
    const result = await pickWorkspace();
    if (result.status === 'picked') set({ workspace: result.workspace });
    return result;
  },

  forgetWorkspace: async () => {
    await clearWorkspace();
    set({ workspace: null });
  },
}));
