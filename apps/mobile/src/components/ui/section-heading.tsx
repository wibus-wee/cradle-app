import { StyleSheet, Text, View } from 'react-native'

import { spacing } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

interface SectionHeadingProps {
  title: string
  meta?: string
}

export function SectionHeading({ title, meta }: SectionHeadingProps) {
  const theme = useTheme()
  return (
    <View style={styles.root}>
      <Text style={[styles.title, { color: theme.mutedForeground }]}>{title}</Text>
      {meta && <Text style={[styles.meta, { color: theme.mutedForeground }]}>{meta}</Text>}
    </View>
  )
}

const styles = StyleSheet.create({
  meta: {
    fontFamily: 'GeistMono_400Regular',
    fontSize: 11,
    fontVariant: ['tabular-nums'],
  },
  root: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
    marginTop: spacing.sm,
  },
  title: {

    fontSize: 14,
    lineHeight: 19,
  },
})
