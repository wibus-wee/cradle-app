import type { LucideIcon } from 'lucide-react-native'
import { AlertCircle, Inbox, RefreshCw } from 'lucide-react-native'
import type { ReactNode } from 'react'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'

import { spacing } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

import { Button } from './button'

interface StateProps {
  title: string
  description?: string
  icon?: LucideIcon
  action?: ReactNode
}

export function EmptyState({ title, description, icon: Icon = Inbox, action }: StateProps) {
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
      {action}
    </View>
  )
}

interface ErrorStateProps extends Omit<StateProps, 'action' | 'icon'> {
  onRetry?: () => void
  retrying?: boolean
}

export function ErrorState({ title, description, onRetry, retrying = false }: ErrorStateProps) {
  return (
    <EmptyState
      action={onRetry
        ? (
            <Button
              icon={RefreshCw}
              label="Retry"
              loading={retrying}
              onPress={onRetry}
              variant="secondary"
            />
          )
        : undefined}
      icon={AlertCircle}
      title={title}
      description={description}
    />
  )
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
