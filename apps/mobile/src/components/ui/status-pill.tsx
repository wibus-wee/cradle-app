import { StyleSheet, Text, View } from 'react-native'

import { spacing } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

interface StatusPillProps {
  label: string
  tone?: 'neutral' | 'info' | 'success' | 'warning' | 'danger'
}

export function StatusPill({ label, tone = 'neutral' }: StatusPillProps) {
  const theme = useTheme()
  const color = {
    neutral: theme.mutedForeground,
    info: theme.info,
    success: theme.success,
    warning: theme.warning,
    danger: theme.destructive,
  }[tone]

  return (
    <View style={styles.pill}>
      <View style={[styles.dot, { backgroundColor: tone === 'neutral' ? theme.dimForeground : color }]} />
      <Text style={[styles.label, { color }]}>{label}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  dot: {
    borderRadius: 4,
    height: 8,
    width: 8,
  },
  label: {

    fontSize: 12,
    fontVariant: ['tabular-nums'],
  },
  pill: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    flexDirection: 'row',
    gap: spacing.xs,
    minHeight: 24,
  },
})
