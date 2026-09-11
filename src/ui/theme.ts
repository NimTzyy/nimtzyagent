import { Platform, type TextStyle } from 'react-native';

/**
 * One neutral ramp plus a single accent hue. Nothing else is colored: errors,
 * destructive actions, and warnings are carried by wording, weight, and icons
 * rather than by a second hue.
 */
export interface Palette {
  background: string;
  surface: string;
  elevated: string;
  hairline: string;
  text: string;
  textSecondary: string;
  textTertiary: string;
  accent: string;
  onAccent: string;
  overlay: string;
}

export const darkPalette: Palette = {
  background: '#0B0B0C',
  surface: '#161618',
  elevated: '#1E1E21',
  hairline: '#2A2A2E',
  text: '#ECECEE',
  textSecondary: '#9A9AA0',
  textTertiary: '#6E6E74',
  accent: '#FBBF24',
  onAccent: '#0B0B0C',
  overlay: 'rgba(0, 0, 0, 0.55)',
};

export const lightPalette: Palette = {
  background: '#FFFFFF',
  surface: '#F7F7F8',
  elevated: '#FFFFFF',
  hairline: '#E4E4E7',
  text: '#111113',
  textSecondary: '#6B6B72',
  textTertiary: '#9A9AA0',
  accent: '#B45309',
  onAccent: '#FFFFFF',
  overlay: 'rgba(17, 17, 19, 0.35)',
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const;

export const radius = {
  sm: 6,
  md: 10,
  lg: 14,
  full: 999,
} as const;

export const monoFont = Platform.select({ ios: 'Menlo', default: 'monospace' });

/**
 * Held as a standalone value rather than written inline: a `const` assertion on
 * the scale below would otherwise freeze the array into a readonly tuple that
 * does not satisfy TextStyle.
 */
const tabularNums: TextStyle = { fontVariant: ['tabular-nums'] };

export const type = {
  display: { fontSize: 28, lineHeight: 34, fontWeight: '600' as const },
  title: { fontSize: 17, lineHeight: 22, fontWeight: '600' as const },
  body: { fontSize: 16, lineHeight: 24, fontWeight: '400' as const },
  bodyStrong: { fontSize: 16, lineHeight: 24, fontWeight: '600' as const },
  chat: { fontSize: 15.5, lineHeight: 24, fontWeight: '400' as const },
  meta: { fontSize: 12.5, lineHeight: 16, fontWeight: '400' as const },
  metaStrong: { fontSize: 12.5, lineHeight: 16, fontWeight: '600' as const },
  mono: { fontSize: 13, lineHeight: 20, fontFamily: monoFont, fontWeight: '400' as const },
  monoSmall: { fontSize: 11.5, lineHeight: 16, fontFamily: monoFont, fontWeight: '400' as const },
  tabular: tabularNums,
} as const;

export interface Theme {
  scheme: 'dark' | 'light';
  palette: Palette;
  spacing: typeof spacing;
  radius: typeof radius;
  type: typeof type;
}

export function makeTheme(scheme: 'dark' | 'light'): Theme {
  return {
    scheme,
    palette: scheme === 'dark' ? darkPalette : lightPalette,
    spacing,
    radius,
    type,
  };
}
