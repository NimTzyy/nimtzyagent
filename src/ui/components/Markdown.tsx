import MarkdownIt from 'markdown-it';
import React, { useMemo } from 'react';
import { Linking, StyleSheet, Text, View, type TextStyle } from 'react-native';

import { languageFromFence } from '@/core/language';
import { useTheme } from './ThemeProvider';
import { CodeBlock } from './CodeBlock';
import type { Theme } from '@/ui/theme';

/**
 * markdown-it token shapes are declared locally: the renderer only touches a
 * handful of fields, and this keeps the component independent of the library's
 * internal type paths.
 */
interface MdToken {
  type: string;
  tag: string;
  content: string;
  info: string;
  children: MdToken[] | null;
  attrGet(name: string): string | null;
}

const parser = new MarkdownIt({ html: false, linkify: true, breaks: false, typographer: false });

function parse(text: string): MdToken[] {
  try {
    return parser.parse(text, {}) as unknown as MdToken[];
  } catch {
    return [];
  }
}

function sliceUntilClose(
  tokens: MdToken[],
  startIndex: number,
  closeType: string,
): { inner: MdToken[]; nextIndex: number } {
  let depth = 0;
  let index = startIndex;
  for (; index < tokens.length; index += 1) {
    const type = tokens[index].type;
    if (type === closeType && depth === 0) break;
    if (type.endsWith('_open')) depth += 1;
    if (type.endsWith('_close')) depth -= 1;
  }
  return {
    inner: tokens.slice(startIndex + 1, index),
    nextIndex: Math.min(index + 1, tokens.length),
  };
}

function headingStyle(level: number, theme: Theme): TextStyle {
  const { palette } = theme;
  switch (level) {
    case 1:
      return { fontSize: 22, lineHeight: 28, fontWeight: '600', color: palette.text };
    case 2:
      return { fontSize: 19, lineHeight: 26, fontWeight: '600', color: palette.text };
    case 3:
      return { fontSize: 17, lineHeight: 24, fontWeight: '600', color: palette.text };
    default:
      return { fontSize: 16, lineHeight: 23, fontWeight: '600', color: palette.textSecondary };
  }
}

function renderInline(children: MdToken[] | null, theme: Theme, keyPrefix: string): React.ReactNode[] {
  const { palette, type } = theme;
  const nodes: React.ReactNode[] = [];
  const styleStack: TextStyle[] = [];
  let linkUrl: string | null = null;

  (children ?? []).forEach((child, index) => {
    const key = `${keyPrefix}-${index}`;
    switch (child.type) {
      case 'text':
        nodes.push(
          <Text
            key={key}
            style={[...styleStack]}
            onPress={linkUrl ? () => void Linking.openURL(linkUrl as string) : undefined}
          >
            {child.content}
          </Text>,
        );
        break;
      case 'strong_open':
        styleStack.push({ fontWeight: '600' });
        break;
      case 'strong_close':
        styleStack.pop();
        break;
      case 'em_open':
        styleStack.push({ fontStyle: 'italic' });
        break;
      case 'em_close':
        styleStack.pop();
        break;
      case 's_open':
        styleStack.push({ textDecorationLine: 'line-through' });
        break;
      case 's_close':
        styleStack.pop();
        break;
      case 'code_inline':
        nodes.push(
          <Text
            key={key}
            style={[type.mono, { color: palette.accent, backgroundColor: palette.surface }]}
          >
            {child.content}
          </Text>,
        );
        break;
      case 'link_open':
        linkUrl = child.attrGet('href');
        styleStack.push({ color: palette.accent, textDecorationLine: 'underline' });
        break;
      case 'link_close':
        styleStack.pop();
        linkUrl = null;
        break;
      case 'image':
        nodes.push(
          <Text key={key} style={{ color: palette.textSecondary }}>
            {child.content ? `[image: ${child.content}]` : '[image]'}
          </Text>,
        );
        break;
      case 'softbreak':
      case 'hardbreak':
        nodes.push(<Text key={key}>{'\n'}</Text>);
        break;
      case 'html_inline':
      case 'html_block':
        break;
      default:
        if (child.content) {
          nodes.push(
            <Text key={key} style={[...styleStack]}>
              {child.content}
            </Text>,
          );
        }
        break;
    }
  });

  return nodes;
}

function renderList(
  tokens: MdToken[],
  startIndex: number,
  theme: Theme,
  ordered: boolean,
): { node: React.ReactNode; nextIndex: number } {
  const { palette, spacing, type } = theme;
  const { inner, nextIndex } = sliceUntilClose(
    tokens,
    startIndex,
    ordered ? 'ordered_list_close' : 'bullet_list_close',
  );

  const items: React.ReactNode[] = [];
  let counter = ordered ? Number(tokens[startIndex].attrGet('start') ?? '1') : 0;
  let index = 0;

  while (index < inner.length) {
    if (inner[index].type === 'list_item_open') {
      const item = sliceUntilClose(inner, index, 'list_item_close');
      const nested: React.ReactNode[] = [];
      const flat: MdToken[] = [];

      let cursor = 0;
      while (cursor < item.inner.length) {
        const type = item.inner[cursor].type;
        if (type === 'bullet_list_open' || type === 'ordered_list_open') {
          const child = renderList(item.inner, cursor, theme, type === 'ordered_list_open');
          nested.push(child.node);
          cursor = child.nextIndex;
        } else {
          flat.push(item.inner[cursor]);
          cursor += 1;
        }
      }

      const marker = ordered ? `${counter}` : '•';
      counter += 1;
      items.push(
        <View key={`item-${index}`} style={{ flexDirection: 'row', gap: spacing.sm }}>
          <Text
            style={[
              type.chat,
              { color: palette.textSecondary, minWidth: ordered ? 18 : 10, textAlign: ordered ? 'right' : 'left' },
            ]}
          >
            {marker}
          </Text>
          <View style={{ flex: 1, gap: spacing.xs }}>
            {renderBlocks(flat, theme)}
            {nested}
          </View>
        </View>,
      );
      index = item.nextIndex;
    } else {
      index += 1;
    }
  }

  return {
    node: (
      <View key={`list-${startIndex}`} style={{ gap: spacing.xs }}>
        {items}
      </View>
    ),
    nextIndex,
  };
}

function renderTable(
  tokens: MdToken[],
  startIndex: number,
  theme: Theme,
): { node: React.ReactNode; nextIndex: number } {
  const { palette, radius, spacing, type } = theme;
  const { inner, nextIndex } = sliceUntilClose(tokens, startIndex, 'table_close');
  const rows: React.ReactNode[] = [];
  let rowIndex = 0;
  let index = 0;

  while (index < inner.length) {
    if (inner[index].type === 'tr_open') {
      const row = sliceUntilClose(inner, index, 'tr_close');
      const isHeader = row.inner.some((token) => token.type === 'th_open');
      const cells: React.ReactNode[] = [];
      let cellIndex = 0;
      let cursor = 0;

      while (cursor < row.inner.length) {
        const type_ = row.inner[cursor].type;
        if (type_ === 'th_open' || type_ === 'td_open') {
          cells.push(
            <View
              key={`cell-${cellIndex}`}
              style={{ flex: 1, paddingHorizontal: spacing.md, paddingVertical: spacing.sm }}
            >
              <Text
                style={[
                  type.chat,
                  {
                    color: isHeader ? palette.text : palette.textSecondary,
                    fontWeight: isHeader ? '600' : '400',
                  },
                ]}
              >
                {renderInline(row.inner[cursor + 1]?.children ?? [], theme, `t${index}-${cursor}`)}
              </Text>
            </View>,
          );
          cellIndex += 1;
          cursor += 3;
        } else {
          cursor += 1;
        }
      }

      rows.push(
        <View
          key={`row-${index}`}
          style={{
            flexDirection: 'row',
            borderTopColor: palette.hairline,
            borderTopWidth: rowIndex > 0 ? StyleSheet.hairlineWidth : 0,
          }}
        >
          {cells}
        </View>,
      );
      rowIndex += 1;
      index = row.nextIndex;
    } else {
      index += 1;
    }
  }

  return {
    node: (
      <View
        key={`table-${startIndex}`}
        style={{
          borderColor: palette.hairline,
          borderWidth: StyleSheet.hairlineWidth,
          borderRadius: radius.sm,
          overflow: 'hidden',
        }}
      >
        {rows}
      </View>
    ),
    nextIndex,
  };
}

function renderBlocks(tokens: MdToken[], theme: Theme): React.ReactNode[] {
  const { palette, spacing, type } = theme;
  const nodes: React.ReactNode[] = [];
  let index = 0;

  while (index < tokens.length) {
    const token = tokens[index];
    switch (token.type) {
      case 'heading_open': {
        const level = Number(token.tag.replace('h', '')) || 1;
        nodes.push(
          <Text key={`h-${index}`} style={headingStyle(level, theme)}>
            {renderInline(tokens[index + 1]?.children ?? [], theme, `h${index}`)}
          </Text>,
        );
        index += 3;
        break;
      }
      case 'paragraph_open': {
        const isTight = tokens[index - 1]?.type === 'list_item_open';
        nodes.push(
          <Text
            key={`p-${index}`}
            style={[type.chat, { color: palette.text, marginTop: isTight ? 0 : 0 }]}
          >
            {renderInline(tokens[index + 1]?.children ?? [], theme, `p${index}`)}
          </Text>,
        );
        index += 3;
        break;
      }
      case 'fence':
        nodes.push(
          <CodeBlock
            key={`fence-${index}`}
            code={token.content}
            language={languageFromFence(token.info)}
          />,
        );
        index += 1;
        break;
      case 'code_block':
        nodes.push(<CodeBlock key={`code-${index}`} code={token.content} />);
        index += 1;
        break;
      case 'bullet_list_open':
      case 'ordered_list_open': {
        const list = renderList(tokens, index, theme, token.type === 'ordered_list_open');
        nodes.push(list.node);
        index = list.nextIndex;
        break;
      }
      case 'blockquote_open': {
        const quote = sliceUntilClose(tokens, index, 'blockquote_close');
        nodes.push(
          <View
            key={`quote-${index}`}
            style={{
              borderLeftColor: palette.hairline,
              borderLeftWidth: 2,
              paddingLeft: spacing.md,
              gap: spacing.sm,
            }}
          >
            {renderBlocks(quote.inner, theme)}
          </View>,
        );
        index = quote.nextIndex;
        break;
      }
      case 'hr':
        nodes.push(
          <View
            key={`hr-${index}`}
            style={{ height: StyleSheet.hairlineWidth, backgroundColor: palette.hairline }}
          />,
        );
        index += 1;
        break;
      case 'table_open': {
        const table = renderTable(tokens, index, theme);
        nodes.push(table.node);
        index = table.nextIndex;
        break;
      }
      default:
        index += 1;
        break;
    }
  }

  return nodes;
}

export const Markdown = React.memo(function Markdown({ text }: { text: string }): React.ReactElement {
  const theme = useTheme();
  const tokens = useMemo(() => parse(text), [text]);
  return <View style={{ gap: theme.spacing.md }}>{renderBlocks(tokens, theme)}</View>;
});
