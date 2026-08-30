import { FileQuestion } from 'lucide-react-native'
import { StyleSheet, Text, View } from 'react-native'
import Markdown from 'react-native-markdown-display'

import type { GetWorkspacesByWorkspaceIdFilesInfoResponse } from '@/api-gen'
import { Screen } from '@/components/ui/screen'
import { EmptyState } from '@/components/ui/states'
import { radius, spacing } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

type FileInfo = GetWorkspacesByWorkspaceIdFilesInfoResponse

export interface FilePreviewViewProps {
  file: FileInfo
  content: string | null
  isRefreshing?: boolean
  onRefresh?: () => void
}

function formatFileSize(bytes: number): string {
  if (bytes < 1_024) {
    return `${bytes} B`
  }
  if (bytes < 1_048_576) {
    return `${(bytes / 1_024).toFixed(1)} KB`
  }
  return `${(bytes / 1_048_576).toFixed(1)} MB`
}

export function FilePreviewView({
  file,
  content,
  isRefreshing = false,
  onRefresh,
}: FilePreviewViewProps) {
  const theme = useTheme()
  const supported = file.previewKind === 'text' || file.previewKind === 'markdown'

  return (
    <Screen insetTop={false} onRefresh={onRefresh} refreshing={isRefreshing}>
      <View style={[styles.metadata, { borderBottomColor: theme.border }]}>
        <Text selectable style={[styles.path, { color: theme.foreground }]}>{file.path}</Text>
        <Text style={[styles.details, { color: theme.mutedForeground }]}>
          {`${formatFileSize(file.size)} · ${file.mimeType}`}
        </Text>
      </View>

      {!supported
        ? (
            <EmptyState
              description="This file type is not available in the mobile preview yet."
              icon={FileQuestion}
              title="Preview unavailable"
            />
          )
        : file.previewKind === 'markdown'
          ? (
              <Markdown
                style={{
                  body: { color: theme.foreground, fontSize: 14, lineHeight: 22 },
                  code_inline: {
                    backgroundColor: theme.muted,
                    borderRadius: radius.sm,
                    color: theme.foreground,
                    fontFamily: 'GeistMono_400Regular',
                    fontSize: 12,
                  },
                  fence: {
                    backgroundColor: theme.muted,
                    borderColor: theme.border,
                    borderRadius: radius.md,
                    color: theme.foreground,
                    fontFamily: 'GeistMono_400Regular',
                    fontSize: 11,
                    lineHeight: 17,
                    padding: spacing.sm,
                  },
                  link: { color: theme.info },
                }}
              >
                {content ?? ''}
              </Markdown>
            )
          : (
              <Text selectable style={[styles.source, { color: theme.foreground }]}>
                {content}
              </Text>
            )}
    </Screen>
  )
}

const styles = StyleSheet.create({
  details: {
    fontSize: 12,
    lineHeight: 17,
  },
  metadata: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: spacing.xs,
    marginBottom: spacing.md,
    paddingBottom: spacing.md,
  },
  path: {
    fontFamily: 'GeistMono_400Regular',
    fontSize: 13,
    lineHeight: 19,
  },
  source: {
    fontFamily: 'GeistMono_400Regular',
    fontSize: 12,
    lineHeight: 18,
  },
})
