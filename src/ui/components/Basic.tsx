import React from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView as AvoidingKeyboardView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import {
  KeyboardAwareScrollView,
  useReanimatedKeyboardAnimation,
} from 'react-native-keyboard-controller';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';

import { useTheme } from './ThemeProvider';

export function Button({
  label,
  onPress,
  variant = 'secondary',
  disabled,
  loading,
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'quiet';
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
}): React.ReactElement {
  const theme = useTheme();
  const { palette, radius, spacing, type } = theme;

  const background =
    variant === 'primary' ? palette.accent : variant === 'secondary' ? palette.elevated : 'transparent';
  const foreground = variant === 'primary' ? palette.onAccent : palette.text;
  const border = variant === 'secondary' ? palette.hairline : 'transparent';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled) || Boolean(loading) }}
      onPress={disabled || loading ? undefined : onPress}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: background,
          borderColor: border,
          borderWidth: variant === 'secondary' ? StyleSheet.hairlineWidth : 0,
          borderRadius: radius.md,
          paddingHorizontal: spacing.lg,
          paddingVertical: spacing.md,
          opacity: disabled ? 0.4 : pressed ? 0.75 : 1,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={foreground} />
      ) : (
        <Text style={[type.body, { color: foreground, fontWeight: '600' }]}>{label}</Text>
      )}
    </Pressable>
  );
}

export function IconButton({
  onPress,
  children,
  accessibilityLabel,
  disabled,
  style,
}: {
  onPress: () => void;
  children: React.ReactNode;
  accessibilityLabel: string;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}): React.ReactElement {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: Boolean(disabled) }}
      onPress={disabled ? undefined : onPress}
      hitSlop={8}
      style={({ pressed }) => [
        styles.iconButton,
        { opacity: disabled ? 0.35 : pressed ? 0.6 : 1 },
        style,
      ]}
    >
      {children}
    </Pressable>
  );
}

/**
 * How much of the screen a multiline field may take before it scrolls within
 * itself. Without a bound the field grows with its text: a long system prompt
 * then makes a field taller than the sheet that holds it, and the lines being
 * edited sit outside the part of the screen the keyboard left.
 */
const MULTILINE_MAX_RATIO = 0.32;

export function TextField({
  label,
  hint,
  style,
  ...inputProps
}: TextInputProps & { label?: string; hint?: string }): React.ReactElement {
  const theme = useTheme();
  const { palette, radius, spacing, type } = theme;
  const { height: windowHeight } = useWindowDimensions();
  return (
    <View style={{ gap: spacing.xs }}>
      {label ? <Text style={[type.meta, { color: palette.textSecondary }]}>{label}</Text> : null}
      <TextInput
        placeholderTextColor={palette.textTertiary}
        selectionColor={palette.accent}
        {...inputProps}
        style={[
          type.body,
          {
            color: palette.text,
            backgroundColor: palette.surface,
            borderColor: palette.hairline,
            borderWidth: StyleSheet.hairlineWidth,
            borderRadius: radius.md,
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.md,
            minHeight: 46,
            maxHeight: inputProps.multiline
              ? Math.round(windowHeight * MULTILINE_MAX_RATIO)
              : undefined,
          },
          style,
        ]}
      />
      {hint ? <Text style={[type.meta, { color: palette.textTertiary }]}>{hint}</Text> : null}
    </View>
  );
}

export function Row({
  onPress,
  children,
  style,
  accessibilityLabel,
}: {
  onPress?: () => void;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}): React.ReactElement {
  const theme = useTheme();
  const content = (
    <View
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: theme.spacing.md,
          paddingVertical: theme.spacing.md,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
  if (!onPress) return content;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
    >
      {content}
    </Pressable>
  );
}

export function Divider({ style }: { style?: StyleProp<ViewStyle> }): React.ReactElement {
  const theme = useTheme();
  return (
    <View
      style={[
        { height: StyleSheet.hairlineWidth, backgroundColor: theme.palette.hairline },
        style,
      ]}
    />
  );
}

export function Badge({ label, tone = 'neutral' }: { label: string; tone?: 'neutral' | 'accent' }): React.ReactElement {
  const theme = useTheme();
  const { palette, radius, spacing, type } = theme;
  const accent = tone === 'accent';
  return (
    <View
      style={{
        borderColor: accent ? palette.accent : palette.hairline,
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: radius.sm,
        paddingHorizontal: spacing.sm,
        paddingVertical: 2,
      }}
    >
      <Text style={[type.meta, { color: accent ? palette.accent : palette.textSecondary }]}>
        {label}
      </Text>
    </View>
  );
}

/** A short, mutually exclusive set of choices. Selection reads as fill, not color. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (next: T) => void;
}): React.ReactElement {
  const theme = useTheme();
  const { palette, radius, spacing, type } = theme;
  return (
    <View
      style={{
        flexDirection: 'row',
        backgroundColor: palette.surface,
        borderColor: palette.hairline,
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: radius.md,
        padding: 3,
        gap: 3,
      }}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            accessibilityLabel={option.label}
            style={({ pressed }) => ({
              flex: 1,
              alignItems: 'center',
              justifyContent: 'center',
              paddingVertical: spacing.sm,
              borderRadius: radius.sm,
              backgroundColor: selected ? palette.elevated : 'transparent',
              borderColor: selected ? palette.hairline : 'transparent',
              borderWidth: StyleSheet.hairlineWidth,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Text style={[type.meta, { color: selected ? palette.text : palette.textSecondary }]}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Sheet({
  visible,
  onClose,
  title,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
}): React.ReactElement {
  const theme = useTheme();
  const { palette, radius, spacing, type } = theme;
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close"
        style={[styles.sheetBackdrop, { backgroundColor: palette.overlay }]}
        onPress={onClose}
      />
      <View style={styles.sheetAnchor} pointerEvents="box-none">
        <View
          style={{
            backgroundColor: palette.elevated,
            borderColor: palette.hairline,
            borderWidth: StyleSheet.hairlineWidth,
            borderRadius: radius.lg,
            padding: spacing.lg,
            gap: spacing.md,
            maxHeight: '80%',
            // The anchor lays out flush to the bottom, so the lift below this
            // card is what holds it above the keyboard — and since the card is
            // the only child that may shrink, its height follows the lift
            // instead of running off the top of the screen.
            flexShrink: 1,
            width: '100%',
            maxWidth: 520,
          }}
        >
          {title ? <Text style={[type.title, { color: palette.text }]}>{title}</Text> : null}
          <ScrollView bounces={false} contentContainerStyle={{ gap: spacing.sm }}>
            {children}
          </ScrollView>
        </View>
        <SheetKeyboardLift />
      </View>
    </Modal>
  );
}

/**
 * A scrolling screen that keeps the keyboard off its fields.
 *
 * Android 15 and up enforce edge-to-edge for apps targeting SDK 35 or later,
 * and that disables the window resize `adjustResize` used to perform. The stock
 * avoiding view measures that resize, so on Android it sees nothing change and
 * the keyboard covers whichever field is focused. The library's scroll view
 * reads the IME inset that edge-to-edge still delivers and scrolls the focused
 * input back into view. iOS keeps the stock pair, where `padding` is the
 * documented behaviour and works.
 *
 * The content style stays with the caller: screens differ in padding and gap,
 * and the only part that must not differ is how the keyboard is handled.
 */
export function KeyboardScroll({
  children,
  contentContainerStyle,
}: {
  children: React.ReactNode;
  contentContainerStyle?: StyleProp<ViewStyle>;
}): React.ReactElement {
  if (Platform.OS === 'android') {
    return (
      <KeyboardAwareScrollView
        style={{ flex: 1 }}
        contentContainerStyle={contentContainerStyle}
        keyboardShouldPersistTaps="handled"
      >
        {children}
      </KeyboardAwareScrollView>
    );
  }
  return (
    <AvoidingKeyboardView style={{ flex: 1 }} behavior="padding">
      <ScrollView contentContainerStyle={contentContainerStyle} keyboardShouldPersistTaps="handled">
        {children}
      </ScrollView>
    </AvoidingKeyboardView>
  );
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body?: string;
  action?: React.ReactNode;
}): React.ReactElement {
  const theme = useTheme();
  const { palette, spacing, type } = theme;
  return (
    <View style={[styles.empty, { gap: spacing.sm, padding: spacing.xxl }]}>
      <Text style={[type.bodyStrong, { color: palette.text, textAlign: 'center' }]}>{title}</Text>
      {body ? (
        <Text style={[type.meta, { color: palette.textSecondary, textAlign: 'center' }]}>{body}</Text>
      ) : null}
      {action ? <View style={{ marginTop: spacing.md }}>{action}</View> : null}
    </View>
  );
}

export function Banner({
  message,
  actionLabel,
  onAction,
  onDismiss,
}: {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  onDismiss?: () => void;
}): React.ReactElement {
  const theme = useTheme();
  const { palette, radius, spacing, type } = theme;
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: spacing.md,
        backgroundColor: palette.surface,
        borderColor: palette.hairline,
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: radius.md,
        paddingHorizontal: spacing.lg,
        paddingVertical: spacing.md,
      }}
    >
      <Text style={[type.meta, { color: palette.text, flexShrink: 1 }]}>{message}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
        {actionLabel && onAction ? (
          <Pressable onPress={onAction} accessibilityRole="button" hitSlop={8}>
            <Text style={[type.metaStrong, { color: palette.accent }]}>{actionLabel}</Text>
          </Pressable>
        ) : null}
        {onDismiss ? (
          <Pressable onPress={onDismiss} accessibilityRole="button" hitSlop={8}>
            <Text style={[type.meta, { color: palette.textSecondary }]}>Dismiss</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  button: { alignItems: 'center', justifyContent: 'center' },
  iconButton: { padding: 6, alignItems: 'center', justifyContent: 'center' },
  sheetBackdrop: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  sheetAnchor: { flex: 1, justifyContent: 'flex-end', padding: 16, alignItems: 'center' },
  empty: { alignItems: 'center', justifyContent: 'center' },
});

/**
 * A spacer that grows with the keyboard and so lifts the sheet above it.
 *
 * Sheets hold text inputs (renaming a chat, editing a message, writing a
 * system prompt) and open with the keyboard already up, so without this the
 * input sits underneath it.
 *
 * It has to be the anchor's **last** child. The anchor lays out flush to the
 * bottom, so whichever child comes last is the one pinned there: with the
 * spacer last the card is pushed up by the keyboard's height, and with the
 * spacer first it only opens an empty gap above a card that never moves. The
 * height arrives negative while the keyboard is open (that sign is what moves
 * a sticky view up), so it is negated here.
 */
function SheetKeyboardLift(): React.ReactElement {
  const { height } = useReanimatedKeyboardAnimation();
  const style = useAnimatedStyle(() => ({ height: Math.abs(height.value) }));
  return <Animated.View style={style} />;
}
