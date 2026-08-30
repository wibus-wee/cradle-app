import { ChevronRight, File, Folder } from 'lucide-react-native'
import { FlatList, StyleSheet } from 'react-native'

import type { GetWorkspacesByWorkspaceIdFilesChildrenResponse } from '@/api-gen'
import { Item } from '@/components/ui/item'
import { Screen } from '@/components/ui/screen'
import { EmptyState } from '@/components/ui/states'
import { useTheme } from '@/theme/use-theme'

type FileEntry = GetWorkspacesByWorkspaceIdFilesChildrenResponse[number]

export interface WorkspaceDirectoryViewProps {
  entries: FileEntry[]
  isRefreshing?: boolean
  onOpenDirectory: (path: string) => void
  onOpenFile: (path: string) => void
  onRefresh?: () => void
}

export function WorkspaceDirectoryView({
  entries,
  isRefreshing = false,
  onOpenDirectory,
  onOpenFile,
  onRefresh,
}: WorkspaceDirectoryViewProps) {
  const theme = useTheme()

  return (
    <Screen insetTop={false} scroll={false}>
      <FlatList
        contentContainerStyle={entries.length === 0 ? styles.emptyList : undefined}
        data={entries}
        keyExtractor={entry => entry.path}
        ListEmptyComponent={(
          <EmptyState
            description="This directory does not contain any visible files or folders."
            title="Empty directory"
          />
        )}
        onRefresh={onRefresh}
        refreshing={isRefreshing}
        renderItem={({ item }) => (
          <Item
            actions={<ChevronRight color={theme.dimForeground} size={16} />}
            media={item.type === 'directory'
              ? <Folder color={theme.tertiaryForeground} size={18} />
              : <File color={theme.tertiaryForeground} size={18} />}
            onPress={() => item.type === 'directory'
              ? onOpenDirectory(item.path)
              : onOpenFile(item.path)}
            title={item.name}
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
  list: {
    flex: 1,
  },
})
