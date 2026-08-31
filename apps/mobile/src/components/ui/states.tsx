import { AlertCircle, Inbox } from 'lucide-react-native'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'

import { spacing } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

import type { StateProps } from './states-contract'

export function EmptyState({ title, description, icon: Icon = Inbox }: StateProps) {
  const theme = useTheme()
  return (
    <View style={styles.state}>
      <View style={[styles.media, { backgroundColor: theme.muted }]}>
        <Icon color={theme.foreground} size={16} />
      </View>
      <View style={styles.copy}>
        <Text style={[styles.title, { color: theme.foreground }]}>{title}</Text>
        {description && <Text style={[styles.description, { color: theme.mutedForeground }]}>{description}</Text>}
      </View>
    </View>
  )
}

export function ErrorState({ title, description }: StateProps) {
  return <EmptyState icon={AlertCircle} title={title} description={description} />
}

export function LoadingState() {
  const theme = useTheme()
  return (
    <View style={styles.state}>
      <ActivityIndicator color={theme.foreground} />
    </View>
  )
}

const styles = StyleSheet.create({
  description: {

    fontSize: 13,
    lineHeight: 19,
    maxWidth: 300,
    textAlign: 'center',
  },
  copy: {
    alignItems: 'center',
    gap: spacing.sm,
  },
  media: {
    alignItems: 'center',
    borderRadius: 8,
    height: 32,
    justifyContent: 'center',
    marginBottom: spacing.sm,
    width: 32,
  },
  state: {
    alignItems: 'center',
    flex: 1,
    gap: spacing.md,
    justifyContent: 'center',
    minHeight: 168,
    padding: spacing.lg,
  },
  title: {

    fontSize: 13,
  },
})
