import type { ReactNode } from 'react'
import { StyleSheet, Text, View } from 'react-native'

import { spacing } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

import { PressableScale } from './pressable-scale'

interface ItemProps {
  title: string
  description?: string
  monospaceDescription?: boolean
  media?: ReactNode
  actions?: ReactNode
  footer?: ReactNode
  onPress?: () => void
  testID?: string
  size?: 'default' | 'sm' | 'xs'
  variant?: 'default' | 'muted' | 'outline'
}

export function Item({
  title,
  description,
  monospaceDescription = false,
  media,
  actions,
  footer,
  onPress,
  testID,
  size = 'default',
}: ItemProps) {
  const theme = useTheme()
  const height = size === 'xs' ? 40 : size === 'sm' ? 46 : 56

  return (
    <PressableScale
      accessibilityRole={onPress ? 'button' : undefined}
      disabled={!onPress}
      onPress={onPress}
      testID={testID}
      style={[
        styles.item,
        {
          minHeight: height,
        },
      ]}
    >
      {media && (
        <View style={[styles.media, (description || footer) ? styles.mediaTop : styles.mediaCenter]}>
          {media}
        </View>
      )}
      <View style={[styles.body, { borderBottomColor: theme.border }]}>
        <View style={styles.content}>
          <Text numberOfLines={2} style={[styles.title, { color: theme.foreground }]}>{title}</Text>
          {description && (
            <Text
              numberOfLines={2}
              style={[
                styles.description,
                monospaceDescription && styles.mono,
                { color: theme.mutedForeground },
              ]}
            >
              {description}
            </Text>
          )}
          {footer}
        </View>
        {actions && <View style={styles.actions}>{actions}</View>}
      </View>
    </PressableScale>
  )
}

const styles = StyleSheet.create({
  actions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  body: {
    alignItems: 'center',
    alignSelf: 'stretch',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flex: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingVertical: 9,
  },
  content: {
    flex: 1,
    gap: 3,
    minWidth: 0,
  },
  description: {

    fontSize: 13,
    lineHeight: 18,
  },
  item: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
  },
  media: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 24,
    width: 24,
  },
  mediaCenter: {
    alignSelf: 'stretch',
  },
  mediaTop: {
    alignSelf: 'flex-start',
    paddingTop: 11,
  },
  mono: {
    fontFamily: 'GeistMono_400Regular',
    fontSize: 12,
  },
  title: {

    fontSize: 15,
    lineHeight: 20,
  },
})
