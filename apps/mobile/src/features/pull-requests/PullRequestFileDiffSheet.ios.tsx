/* eslint-disable react/no-array-index-key -- Unified diff lines have no stable ids and duplicate content is meaningful. */
import { BottomSheet } from '@expo/ui/community/bottom-sheet'
import {
  Button,
  ContentUnavailableView,
  Divider,
  Host,
  HStack,
  Image,
  ScrollView,
  Spacer,
  Text,
  VStack,
} from '@expo/ui/swift-ui'
import {
  buttonStyle,
  fixedSize,
  font,
  foregroundStyle,
  frame,
  lineLimit,
  padding,
  textSelection,
} from '@expo/ui/swift-ui/modifiers'

import type { GetPullRequestsByOwnerByRepoByNumberDetailResponse } from '@/api-gen'

type PullRequestFile = GetPullRequestsByOwnerByRepoByNumberDetailResponse['files'][number]

interface PullRequestFileDiffSheetProps {
  file: PullRequestFile | null
  onClose: () => void
  onOpenExternal: (url: string) => void
}

const snapPoints = ['72%', '95%']
const fullWidth = frame({ maxWidth: Infinity, alignment: 'leading' })
const minimumTapTarget = frame({ minHeight: 44, minWidth: 44 })
const plainButton = buttonStyle('plain')
const secondaryForeground = foregroundStyle({ type: 'hierarchical', style: 'secondary' })

function diffLineColor(line: string) {
  if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff ') || line.startsWith('index ')) {
    return 'secondary' as const
  }
  if (line.startsWith('+')) {
    return 'green' as const
  }
  if (line.startsWith('-')) {
    return 'red' as const
  }
  if (line.startsWith('@@')) {
    return 'blue' as const
  }
  return 'primary' as const
}

export function PullRequestFileDiffSheet({
  file,
  onClose,
  onOpenExternal,
}: PullRequestFileDiffSheetProps) {
  const lines = file?.patch?.split('\n') ?? []

  return (
    <BottomSheet
      enableDynamicSizing={false}
      enablePanDownToClose
      index={file ? 0 : -1}
      onClose={onClose}
      snapPoints={snapPoints}
    >
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        <VStack alignment="leading" modifiers={[frame({ maxHeight: Infinity, maxWidth: Infinity })]}>
          <HStack modifiers={[fullWidth, padding({ horizontal: 16, vertical: 8 })]} spacing={10}>
            <VStack alignment="leading" spacing={2}>
              <Text modifiers={[font({ textStyle: 'headline' }), lineLimit(1)]}>
                {file?.filename ?? 'Changed File'}
              </Text>
              {file && (
                <HStack spacing={7}>
                  <Text modifiers={[font({ textStyle: 'caption' }), secondaryForeground]}>
                    {file.status}
                  </Text>
                  <Text modifiers={[font({ textStyle: 'caption' }), foregroundStyle('green')]}>
                    {`+${file.additions}`}
                  </Text>
                  <Text modifiers={[font({ textStyle: 'caption' }), foregroundStyle('red')]}>
                    {`−${file.deletions}`}
                  </Text>
                </HStack>
              )}
            </VStack>
            <Spacer />
            {file && (
              <Button
                modifiers={[plainButton, minimumTapTarget]}
                onPress={() => onOpenExternal(file.blobUrl)}
              >
                <Image color="blue" size={17} systemName="safari" />
              </Button>
            )}
            <Button modifiers={[plainButton, minimumTapTarget]} onPress={onClose}>
              <Text modifiers={[foregroundStyle('blue')]}>Done</Text>
            </Button>
          </HStack>
          <Divider />

          {lines.length > 0
            ? (
                <ScrollView
                  axes="both"
                  modifiers={[frame({ maxHeight: Infinity, maxWidth: Infinity })]}
                >
                  <VStack
                    alignment="leading"
                    modifiers={[padding({ all: 12 }), textSelection(true)]}
                    spacing={0}
                  >
                    {lines.map((line, index) => (
                      <Text
                        key={`${index}-${line}`}
                        modifiers={[
                          font({ design: 'monospaced', textStyle: 'caption' }),
                          foregroundStyle(diffLineColor(line)),
                          fixedSize({ horizontal: true, vertical: true }),
                        ]}
                      >
                        {line || ' '}
                      </Text>
                    ))}
                  </VStack>
                </ScrollView>
              )
            : (
                <ContentUnavailableView
                  description="Open the file on GitHub to inspect its complete contents."
                  systemImage="doc.text.magnifyingglass"
                  title="No Inline Patch"
                />
              )}
        </VStack>
      </Host>
    </BottomSheet>
  )
}
