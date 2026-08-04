import type { ReactNode } from 'react'
import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native'

import { radius, spacing } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

interface InputGroupProps extends TextInputProps {
  addon?: ReactNode
}

export function InputGroup({ addon, multiline, style, ...props }: InputGroupProps) {
  const theme = useTheme()

  return (
    <View
      style={[
        styles.group,
        multiline && styles.multiline,
        { backgroundColor: theme.surface, borderColor: theme.input },
      ]}
    >
      {addon && <View style={styles.addon}>{addon}</View>}
      <TextInput
        {...props}
        multiline={multiline}
        placeholderTextColor={theme.tertiaryForeground}
        style={[
          styles.input,
          multiline && styles.multilineInput,
          { color: theme.foreground },
          style,
        ]}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  addon: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  group: {
    alignItems: 'center',
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 44,
    paddingHorizontal: spacing.sm,
  },
  input: {
    flex: 1,

    fontSize: 14,
    minHeight: 42,
    paddingVertical: 0,
  },
  multiline: {
    alignItems: 'flex-start',
    minHeight: 96,
  },
  multilineInput: {
    lineHeight: 21,
    minHeight: 94,
    paddingVertical: spacing.sm,
    textAlignVertical: 'top',
  },
})
