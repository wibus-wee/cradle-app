import { File, Folder, Search } from 'lucide-react-native'
import { ActivityIndicator, FlatList, StyleSheet, View } from 'react-native'

import type { GetWorkspacesByWorkspaceIdFilesSearchResponse } from '@/api-gen'
import { InputGroup } from '@/components/ui/input-group'
import { Item } from '@/components/ui/item'
import { Screen } from '@/components/ui/screen'
import { EmptyState, ErrorState } from '@/components/ui/states'
import { spacing } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

type SearchResult = GetWorkspacesByWorkspaceIdFilesSearchResponse[number]

export interface WorkspaceSearchViewProps {
  error: string | null
  isSearching: boolean
  onOpenDirectory: (path: string) => void
  onOpenFile: (path: string) => void
  onQueryChange: (query: string) => void
  onRetry: () => void
  query: string
  results: SearchResult[]
}

export function WorkspaceSearchView({
  error,
  isSearching,
  onOpenDirectory,
  onOpenFile,
  onQueryChange,
  onRetry,
  query,
  results,
}: WorkspaceSearchViewProps) {
  const theme = useTheme()
  const hasQuery = query.trim().length > 0

  let content
  if (!hasQuery) {
    content = (
      <EmptyState
        description="Search file and directory names across this workspace."
        icon={Search}
        title="Search workspace files"
      />
    )
  }
  else if (isSearching) {
    content = (
      <View style={styles.centered}>
        <ActivityIndicator color={theme.foreground} />
      </View>
    )
  }
  else if (error) {
    content = <ErrorState description={error} onRetry={onRetry} title="Could not search files" />
  }
  else {
    content = (
      <FlatList
        contentContainerStyle={results.length === 0 ? styles.emptyList : undefined}
        data={results}
        keyExtractor={result => result.path}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={(
          <EmptyState
            description="Try a different file or directory name."
            title="No matching files"
          />
        )}
        renderItem={({ item }) => (
          <Item
            description={item.path}
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
    )
  }

  return (
    <Screen insetTop={false} scroll={false}>
      <InputGroup
        addon={<Search color={theme.mutedForeground} size={18} />}
        autoCapitalize="none"
        autoCorrect={false}
        autoFocus
        clearButtonMode="while-editing"
        onChangeText={onQueryChange}
        placeholder="Search files..."
        returnKeyType="search"
        value={query}
      />
      <View style={styles.results}>{content}</View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  centered: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
  },
  emptyList: {
    flexGrow: 1,
  },
  list: {
    flex: 1,
  },
  results: {
    flex: 1,
    marginTop: spacing.md,
  },
})
