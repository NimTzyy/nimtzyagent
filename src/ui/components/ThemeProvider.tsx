import React, { createContext, useContext, useMemo } from 'react';
import { useColorScheme } from 'react-native';

import { useSettings } from '@/state/settings';
import { makeTheme, type Theme } from '@/ui/theme';

const ThemeContext = createContext<Theme>(makeTheme('dark'));

export function ThemeProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const preference = useSettings((state) => state.preferences.theme);
  const systemScheme = useColorScheme();

  const scheme: 'dark' | 'light' =
    preference === 'system' ? (systemScheme === 'light' ? 'light' : 'dark') : preference;

  const theme = useMemo(() => makeTheme(scheme), [scheme]);
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  return useContext(ThemeContext);
}
