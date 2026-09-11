import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import css from 'highlight.js/lib/languages/css';
import go from 'highlight.js/lib/languages/go';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import markdown from 'highlight.js/lib/languages/markdown';
import python from 'highlight.js/lib/languages/python';
import rust from 'highlight.js/lib/languages/rust';
import sql from 'highlight.js/lib/languages/sql';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';
import * as Clipboard from 'expo-clipboard';
import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, type TextStyle } from 'react-native';

import { strings } from '@/lib/strings';
import { useTheme } from './ThemeProvider';

// A deliberate subset: enough for the languages this app is used with, without
// pulling the full highlight.js bundle into the binary.
const LANGUAGES = {
  bash,
  css,
  go,
  java,
  javascript,
  json,
  markdown,
  python,
  rust,
  sql,
  typescript,
  xml,
  yaml,
} as const;

let registered = false;
function ensureLanguages(): void {
  if (registered) return;
  for (const [name, definition] of Object.entries(LANGUAGES)) {
    hljs.registerLanguage(name, definition);
  }
  // Common aliases so fenced blocks like ```ts still highlight.
  hljs.registerAliases(['ts', 'tsx'], { languageName: 'typescript' });
  hljs.registerAliases(['js', 'jsx', 'mjs', 'cjs'], { languageName: 'javascript' });
  hljs.registerAliases(['py'], { languageName: 'python' });
  hljs.registerAliases(['sh', 'shell', 'zsh', 'console'], { languageName: 'bash' });
  hljs.registerAliases(['yml'], { languageName: 'yaml' });
  hljs.registerAliases(['html', 'svg'], { languageName: 'xml' });
  hljs.registerAliases(['md'], { languageName: 'markdown' });
  registered = true;
}

interface Segment {
  text: string;
  className: string | null;
}

const ENTITY = /&(?:amp|lt|gt|quot|#x27|#39|#x2F);/g;

function decodeEntities(text: string): string {
  return text.replace(ENTITY, (match) => {
    switch (match) {
      case '&amp;':
        return '&';
      case '&lt;':
        return '<';
      case '&gt;':
        return '>';
      case '&quot;':
        return '"';
      case '&#x2F;':
        return '/';
      default:
        return match.startsWith('&#') ? "'" : match;
    }
  });
}

/** highlight.js emits flat span markup; this walks it back into styled runs. */
export function parseHighlighted(html: string): Segment[] {
  const segments: Segment[] = [];
  const stack: string[] = [];
  const pattern = /<span class="([^"]*)">|<\/span>|([^<]+)/g;
  let match = pattern.exec(html);
  while (match !== null) {
    if (match[1] !== undefined) {
      stack.push(match[1]);
    } else if (match[2] !== undefined) {
      segments.push({
        text: decodeEntities(match[2]),
        className: stack.length > 0 ? stack[stack.length - 1] : null,
      });
    } else {
      stack.pop();
    }
    match = pattern.exec(html);
  }
  return segments;
}

/**
 * Three tones only, to stay inside the palette: comments recede, literals carry
 * the accent, everything else is plain text.
 */
function toneFor(className: string | null, tones: { text: string; accent: string; dim: string }): TextStyle {
  if (!className) return { color: tones.text };
  if (className.includes('comment') || className.includes('quote')) return { color: tones.dim };
  if (
    className.includes('string') ||
    className.includes('number') ||
    className.includes('literal') ||
    className.includes('regexp') ||
    className.includes('symbol') ||
    className.includes('bullet')
  ) {
    return { color: tones.accent };
  }
  return { color: tones.text };
}

export function CodeBlock({
  code,
  language,
}: {
  code: string;
  language?: string;
}): React.ReactElement {
  const theme = useTheme();
  const { palette, radius, spacing, type } = theme;
  const [copied, setCopied] = useState(false);

  const segments = useMemo<Segment[]>(() => {
    ensureLanguages();
    const trimmed = code.replace(/\n$/, '');
    if (language && hljs.getLanguage(language)) {
      try {
        return parseHighlighted(hljs.highlight(trimmed, { language }).value);
      } catch {
        return [{ text: trimmed, className: null }];
      }
    }
    return [{ text: trimmed, className: null }];
  }, [code, language]);

  const tones = { text: palette.text, accent: palette.accent, dim: palette.textTertiary };

  const copy = async (): Promise<void> => {
    await Clipboard.setStringAsync(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <View
      style={{
        borderColor: palette.hairline,
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: radius.md,
        backgroundColor: palette.surface,
        overflow: 'hidden',
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.sm,
          borderBottomColor: palette.hairline,
          borderBottomWidth: StyleSheet.hairlineWidth,
        }}
      >
        <Text style={[type.monoSmall, { color: palette.textTertiary }]}>{language ?? 'text'}</Text>
        <Pressable onPress={copy} accessibilityRole="button" hitSlop={8}>
          <Text style={[type.meta, { color: copied ? palette.accent : palette.textSecondary }]}>
            {copied ? strings.common.copied : strings.common.copy}
          </Text>
        </Pressable>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} bounces={false}>
        <Text
          selectable
          style={[type.mono, { paddingHorizontal: spacing.md, paddingVertical: spacing.md }]}
        >
          {segments.map((segment, index) => (
            <Text key={`${index}-${segment.text.length}`} style={toneFor(segment.className, tones)}>
              {segment.text}
            </Text>
          ))}
        </Text>
      </ScrollView>
    </View>
  );
}
