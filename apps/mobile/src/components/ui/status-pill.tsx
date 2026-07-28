import { StyleSheet, Text, View } from 'react-native'

import { radius } from '@/theme/tokens'
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
    <View style={[styles.pill, { backgroundColor: `${color}18` }]}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={[styles.label, { color }]}>{label}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  dot: {
    borderRadius: 3,
    height: 6,
    width: 6,
  },
  label: {
    fontFamily: 'Geist_500Medium',
    fontSize: 12,
    fontVariant: ['tabular-nums'],
  },
  pill: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: radius.sm,
    flexDirection: 'row',
    gap: 6,
    minHeight: 26,
    paddingHorizontal: 8,
  },
})
