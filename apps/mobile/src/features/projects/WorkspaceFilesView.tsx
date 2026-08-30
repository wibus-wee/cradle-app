import { ArrowLeft, ChevronRight, FileText, Folder } from 'lucide-react-native'
import { FlatList, StyleSheet, Text } from 'react-native'

import type {
  GetWorkspacesByWorkspaceIdFilesChildrenResponse,
  GetWorkspacesByWorkspaceIdFilesInfoResponse,
} from '@/api-gen'
import { IconButton } from '@/components/ui/icon-button'
import { Item } from '@/components/ui/item'
import { Screen } from '@/components/ui/screen'
import { EmptyState } from '@/components/ui/states'
import { radius, spacing } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

type FileEntry = GetWorkspacesByWorkspaceIdFilesChildrenResponse[number]

export interface WorkspaceFilesViewProps {
  currentPath: string
  entries: GetWorkspacesByWorkspaceIdFilesChildrenResponse
  file?: {
    content: string | null
    info: GetWorkspacesByWorkspaceIdFilesInfoResponse
    previewable: boolean
  }
  isRefreshing?: boolean
  onBack: () => void
  onOpenDirectory: (path: string) => void
  onOpenFile: (path: string) => void
  onRefresh?: () => void
}

function pathName(path: string): string {
  return path.split('/').filter(Boolean).at(-1) ?? 'Files'
}

function fileSize(bytes: number): string {
  if (bytes < 1024) { return `${bytes} B` }
  if (bytes < 1024 * 1024) { return `${Math.ceil(bytes / 1024)} KB` }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function WorkspaceFilesView({
  currentPath,
  entries,
  file,
  isRefreshing = false,
  onBack,
  onOpenDirectory,
  onOpenFile,
  onRefresh,
}: WorkspaceFilesViewProps) {
  const theme = useTheme()
  const backAction = (
    <IconButton
      accessibilityLabel={file ? 'Close file preview' : 'Go up one level'}
      icon={ArrowLeft}
      onPress={onBack}
    />
  )

  if (file) {
    return (
      <Screen
        action={backAction}
        insetTop={false}
        subtitle={`${file.info.path} · ${fileSize(file.info.size)}`}
        title={file.info.name}
      >
        {file.previewable && file.content !== null
          ? (
              <Text
                selectable
                style={[
                  styles.fileContent,
                  { backgroundColor: theme.surfaceInset, color: theme.foreground },
                ]}
              >
                {file.content}
              </Text>
            )
          : (
              <EmptyState
                description={file.info.size > 128 * 1024
                  ? 'Text previews are limited to 128 KB on Mobile.'
                  : file.previewable
                    ? 'Text content is unavailable.'
                  : 'This file type does not have a Mobile preview.'}
                title="Preview unavailable"
              />
            )}
      </Screen>
    )
  }

  return (
    <Screen
      action={backAction}
      insetTop={false}
      scroll={false}
      subtitle={currentPath || 'Workspace root'}
      title={pathName(currentPath)}
    >
      <FlatList<FileEntry>
        contentContainerStyle={entries.length === 0 ? styles.emptyList : undefined}
        data={entries}
        keyExtractor={entry => entry.path}
        ListEmptyComponent={<EmptyState description="This directory has no files." title="Empty directory" />}
        onRefresh={onRefresh}
        refreshing={isRefreshing}
        renderItem={({ item: entry }) => (
          <Item
            actions={entry.type === 'directory'
              ? <ChevronRight color={theme.dimForeground} size={16} />
              : undefined}
            media={entry.type === 'directory'
              ? <Folder color={theme.workspace} size={18} />
              : <FileText color={theme.tertiaryForeground} size={18} />}
            onPress={() => entry.type === 'directory'
              ? onOpenDirectory(entry.path)
              : onOpenFile(entry.path)}
            title={entry.name}
          />
        )}
        style={styles.list}
      />
    </Screen>
  )
}

const styles = StyleSheet.create({
  emptyList: {
    flexGrow: 1,
  },
  fileContent: {
    borderRadius: radius.md,
    fontFamily: 'GeistMono_400Regular',
    fontSize: 12,
    lineHeight: 19,
    padding: spacing.md,
  },
  list: {
    flex: 1,
  },
})
