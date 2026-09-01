import { Check, Copy, Share2 } from 'lucide-react-native'
import { useEffect, useRef, useState } from 'react'
import { Alert, StyleSheet, View } from 'react-native'

import { PressableScale } from '@/components/ui/pressable-scale'
import { spacing } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

export interface MessageActionsProps {
  align?: 'start' | 'end'
  onCopy: (text: string) => Promise<void>
  onShare: (text: string) => Promise<void>
  text: string
}

export function MessageActions({
  align = 'start',
  onCopy,
  onShare,
  text,
}: MessageActionsProps) {
  const theme = useTheme()
  const [copied, setCopied] = useState(false)
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (resetTimerRef.current) {
      clearTimeout(resetTimerRef.current)
    }
  }, [])

  const copy = async () => {
    try {
      await onCopy(text)
      setCopied(true)
      if (resetTimerRef.current) {
        clearTimeout(resetTimerRef.current)
      }
      resetTimerRef.current = setTimeout(setCopied, 1_500, false)
    }
    catch {
      Alert.alert('Could not copy message')
    }
  }
  const share = async () => {
    try {
      await onShare(text)
    }
    catch {
      Alert.alert('Could not share message')
    }
  }

  return (
    <View style={[styles.actions, align === 'end' && styles.actionsEnd]}>
      <PressableScale
        accessibilityLabel={copied ? 'Message copied' : 'Copy message'}
        accessibilityRole="button"
        haptic
        onPress={() => void copy()}
        style={[styles.action, { backgroundColor: theme.surfaceInset }]}
      >
        {copied
          ? <Check color={theme.success} size={15} />
          : <Copy color={theme.mutedForeground} size={15} />}
      </PressableScale>
      <PressableScale
        accessibilityLabel="Share message"
        accessibilityRole="button"
        haptic
        onPress={() => void share()}
        style={[styles.action, { backgroundColor: theme.surfaceInset }]}
      >
        <Share2 color={theme.mutedForeground} size={15} />
      </PressableScale>
    </View>
  )
}

const styles = StyleSheet.create({
  action: {
    alignItems: 'center',
    borderRadius: 22,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  actions: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  actionsEnd: {
    alignSelf: 'flex-end',
  },
})
