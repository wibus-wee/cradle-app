import { requireNativeViewManager } from 'expo-modules-core'
import { useCallback, useState } from 'react'
import type { StyleProp, ViewProps, ViewStyle } from 'react-native'

interface NativeMarkdownProps extends ViewProps {
  markdown: string
  onContentSizeChange?: (event: { nativeEvent: { height: number, width: number } }) => void
  streaming?: boolean
}

const NativeMarkdownView = requireNativeViewManager<NativeMarkdownProps>('CradleMarkdown')

export interface NativeMarkdownComponentProps {
  markdown: string
  streaming: boolean
  style?: StyleProp<ViewStyle>
}

export function NativeMarkdown({ markdown, streaming, style }: NativeMarkdownComponentProps) {
  const [height, setHeight] = useState(1)
  const handleContentSizeChange = useCallback((event: { nativeEvent: { height: number, width: number } }) => {
    const nextHeight = Math.max(1, Math.ceil(event.nativeEvent.height))
    setHeight(previous => previous === nextHeight ? previous : nextHeight)
  }, [])

  return (
    <NativeMarkdownView
      markdown={markdown}
      onContentSizeChange={handleContentSizeChange}
      streaming={streaming}
      style={[styles.view, style, { height }]}
    />
  )
}

const styles = {
  view: {
    alignSelf: 'stretch',
    minHeight: 1,
  } satisfies ViewStyle,
}
