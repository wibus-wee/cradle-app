import type { LucideIcon } from 'lucide-react-native'
import { AlertCircle, Inbox } from 'lucide-react-native'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'

import { spacing } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

interface StateProps {
  title: string
  description?: string
  icon?: LucideIcon
}

export function EmptyState({ title, description, icon: Icon = Inbox }: StateProps) {
  const theme = useTheme()
  return (
    <View style={styles.state}>
      <Icon color={theme.mutedForeground} size={24} />
      <Text style={[styles.title, { color: theme.foreground }]}>{title}</Text>
      {description && <Text style={[styles.description, { color: theme.mutedForeground }]}>{description}</Text>}
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
    fontFamily: 'Geist_400Regular',
    fontSize: 14,
    lineHeight: 20,
    maxWidth: 280,
    textAlign: 'center',
  },
  state: {
    alignItems: 'center',
    flex: 1,
    gap: spacing.sm,
    justifyContent: 'center',
    minHeight: 240,
    padding: spacing.xl,
  },
  title: {
    fontFamily: 'Geist_600SemiBold',
    fontSize: 16,
  },
})
