import { Button, Host, HStack, Image } from '@expo/ui/swift-ui'
import {
  accessibilityLabel,
  buttonStyle,
  frame,
} from '@expo/ui/swift-ui/modifiers'
import { useEffect, useRef, useState } from 'react'
import { Alert, StyleSheet } from 'react-native'

import type { MessageActionsProps } from './MessageActions'

const iconButton = buttonStyle('plain')
const touchTarget = frame({ height: 44, width: 44 })

export function MessageActions({
  align = 'start',
  onCopy,
  onShare,
  text,
}: MessageActionsProps) {
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
    <Host
      ignoreSafeArea="all"
      matchContents
      style={[styles.host, align === 'end' && styles.hostEnd]}
    >
      <HStack spacing={4}>
        <Button
          modifiers={[
            iconButton,
            touchTarget,
            accessibilityLabel(copied ? 'Message copied' : 'Copy message'),
          ]}
          onPress={() => void copy()}
        >
          <Image
            color={copied ? 'green' : 'secondary'}
            size={16}
            systemName={copied ? 'checkmark' : 'doc.on.doc'}
          />
        </Button>
        <Button
          modifiers={[iconButton, touchTarget, accessibilityLabel('Share message')]}
          onPress={() => void share()}
        >
          <Image color="secondary" size={16} systemName="square.and.arrow.up" />
        </Button>
      </HStack>
    </Host>
  )
}

const styles = StyleSheet.create({
  host: {
    alignSelf: 'flex-start',
  },
  hostEnd: {
    alignSelf: 'flex-end',
  },
})
