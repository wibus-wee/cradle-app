import type { LucideIcon } from 'lucide-react-native'
import type { ComponentProps } from 'react'
import { ActivityIndicator, StyleSheet, Text } from 'react-native'

import { radius } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

import { PressableScale } from './pressable-scale'

interface ButtonProps extends ComponentProps<typeof PressableScale> {
  label: string
  icon?: LucideIcon
  variant?: 'primary' | 'secondary' | 'destructive'
  loading?: boolean
}

export function Button({
  label,
  icon: Icon,
  variant = 'primary',
  loading = false,
  disabled,
  style,
  ...props
}: ButtonProps) {
  const theme = useTheme()
  const colors = {
    primary: { background: theme.primary, foreground: theme.primaryForeground },
    secondary: { background: theme.muted, foreground: theme.foreground },
    destructive: { background: theme.destructive, foreground: '#ffffff' },
  }[variant]

  return (
    <PressableScale
      {...props}
      disabled={disabled || loading}
      haptic
      style={[
        styles.button,
        { backgroundColor: colors.background, opacity: disabled ? 0.45 : 1 },
        style,
      ]}
    >
      {loading
        ? <ActivityIndicator color={colors.foreground} />
        : Icon ? <Icon color={colors.foreground} size={18} strokeWidth={2} /> : null}
      <Text style={[styles.label, { color: colors.foreground }]}>{label}</Text>
    </PressableScale>
  )
}

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    borderRadius: radius.md,
    flexDirection: 'row',
    gap: 8,
    height: 44,
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  label: {

    fontSize: 13,
  },
})
