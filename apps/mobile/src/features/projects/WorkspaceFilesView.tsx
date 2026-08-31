import { ArrowLeft, ChevronRight, FileText, Folder, Search } from 'lucide-react-native'
import { FlatList, StyleSheet, Text, View } from 'react-native'

import type { GetWorkspacesByWorkspaceIdFilesChildrenResponse } from '@/api-gen'
import { IconButton } from '@/components/ui/icon-button'
import { InputGroup } from '@/components/ui/input-group'
import { Item } from '@/components/ui/item'
import { Screen } from '@/components/ui/screen'
import { EmptyState } from '@/components/ui/states'
import { radius, spacing } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

import {
  workspaceFilePreviewUnavailableDescription,
  workspaceFileSize,
  workspacePathName,
} from './workspace-files-model'
import type { WorkspaceFilesViewProps } from './workspace-files-view-contract'

type FileEntry = GetWorkspacesByWorkspaceIdFilesChildrenResponse[number]

export type { WorkspaceFilesViewProps } from './workspace-files-view-contract'

export function WorkspaceFilesView({
  currentPath,
  entries,
  file,
  isRefreshing = false,
  onBack,
  onOpenDirectory,
  onOpenFile,
  onRefresh,
  onSearchChange,
  search,
  showsInlineSearch = true,
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
        subtitle={`${file.info.path} · ${workspaceFileSize(file.info.size)}`}
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
                description={workspaceFilePreviewUnavailableDescription(
                  file.info.size,
                  file.previewable,
                )}
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
      title={workspacePathName(currentPath)}
    >
      {showsInlineSearch && (
        <View style={styles.search}>
          <InputGroup
            addon={<Search color={theme.mutedForeground} size={17} />}
            autoCapitalize="none"
            autoCorrect={false}
            clearButtonMode="while-editing"
            onChangeText={onSearchChange}
            placeholder="Search workspace files"
            returnKeyType="search"
            value={search}
          />
        </View>
      )}
      <FlatList<FileEntry>
        contentContainerStyle={entries.length === 0 ? styles.emptyList : undefined}
        data={entries}
        keyExtractor={entry => entry.path}
        ListEmptyComponent={(
          <EmptyState
            description={search
              ? 'Try a different file or directory name.'
              : 'This directory has no files.'}
            title={search ? 'No matching files' : 'Empty directory'}
          />
        )}
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
            description={search ? entry.path : undefined}
            monospaceDescription={Boolean(search)}
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
  search: {
    marginBottom: spacing.md,
  },
})
