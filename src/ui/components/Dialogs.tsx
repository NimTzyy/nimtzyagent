import React, { useState } from 'react';
import { Text, View } from 'react-native';

import { strings } from '@/lib/strings';
import { Button, Sheet, TextField } from './Basic';
import { useTheme } from './ThemeProvider';

/**
 * A single-field prompt. The platform's own prompt is iOS-only, and a styled
 * sheet keeps validation and wording identical on both.
 */
export function PromptSheet({
  visible,
  title,
  label,
  placeholder,
  initialValue,
  confirmLabel = strings.common.save,
  error,
  onConfirm,
  onClose,
}: {
  visible: boolean;
  title: string;
  label?: string;
  placeholder?: string;
  initialValue?: string;
  confirmLabel?: string;
  error?: string | null;
  onConfirm: (value: string) => void;
  onClose: () => void;
}): React.ReactElement {
  const { spacing, type, palette } = useTheme();
  const [value, setValue] = useState(initialValue ?? '');
  const [wasVisible, setWasVisible] = useState(visible);

  // Each time the sheet opens it starts from the value it was given. Adjusting
  // during render rather than in an effect avoids a second render pass.
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) setValue(initialValue ?? '');
  }

  return (
    <Sheet visible={visible} onClose={onClose} title={title}>
      <TextField
        label={label}
        value={value}
        onChangeText={setValue}
        placeholder={placeholder}
        autoFocus
        multiline
      />
      {error ? (
        <Text style={[type.meta, { color: palette.textSecondary }]}>{error}</Text>
      ) : null}
      <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
        <View style={{ flex: 1 }}>
          <Button label={strings.common.cancel} onPress={onClose} />
        </View>
        <View style={{ flex: 1 }}>
          <Button label={confirmLabel} variant="primary" onPress={() => onConfirm(value)} />
        </View>
      </View>
    </Sheet>
  );
}

/**
 * Confirmation for destructive actions. The wording carries the weight: there
 * is no red, and the confirming control is the quieter of the two.
 */
export function ConfirmSheet({
  visible,
  title,
  body,
  confirmLabel = strings.common.delete,
  onConfirm,
  onClose,
}: {
  visible: boolean;
  title: string;
  body?: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onClose: () => void;
}): React.ReactElement {
  const { spacing, type, palette } = useTheme();
  return (
    <Sheet visible={visible} onClose={onClose} title={title}>
      {body ? (
        <Text style={[type.body, { color: palette.textSecondary }]}>{body}</Text>
      ) : null}
      <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
        <View style={{ flex: 1 }}>
          <Button label={strings.common.cancel} onPress={onClose} />
        </View>
        <View style={{ flex: 1 }}>
          <Button label={confirmLabel} variant="primary" onPress={onConfirm} />
        </View>
      </View>
    </Sheet>
  );
}
