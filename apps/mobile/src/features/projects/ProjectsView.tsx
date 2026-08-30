import { ChevronRight, Folder, FolderX, Search } from 'lucide-react-native'
import { useRef, useState } from 'react'
import { FlatList, Keyboard, StyleSheet, Text, View } from 'react-native'

import type { GetSessionsResponse, GetWorkspacesResponse, PostWorksData } from '@/api-gen'
import type { AppSection } from '@/components/common/app-menu-button'
import { AppMenuButton } from '@/components/common/app-menu-button'
import { CradleIconButton } from '@/components/common/cradle-icon-button'
import { InputGroup } from '@/components/ui/input-group'
import { Item } from '@/components/ui/item'
import { Screen } from '@/components/ui/screen'
import { EmptyState } from '@/components/ui/states'
import type { WorkComposerHandle } from '@/features/work/WorkComposer'
import { WorkComposer } from '@/features/work/WorkComposer'
import { spacing } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

type Workspace = GetWorkspacesResponse[number]
type Session = GetSessionsResponse['items'][number]

export interface WorkspaceSummary {
  workspace: Workspace
  sessions: Session[]
}

export interface ProjectsViewProps {
  projects: WorkspaceSummary[]
  isCreating?: boolean
  isRefreshing?: boolean
  onCreate: (input: PostWorksData['body']) => void
  onNavigate: (section: AppSection) => void
  onOpenUsage: () => void
  onOpenProject: (workspaceId: string) => void
  onRefresh?: () => void
}

export function ProjectsView({
  projects,
  isCreating = false,
  isRefreshing = false,
  onCreate,
  onNavigate,
  onOpenUsage,
  onOpenProject,
  onRefresh,
}: ProjectsViewProps) {
  const theme = useTheme()
  const composerRef = useRef<WorkComposerHandle>(null)
  const [search, setSearch] = useState('')
  const normalizedSearch = search.trim().toLocaleLowerCase()
  const filteredProjects = normalizedSearch
    ? projects.filter(({ workspace }) => [
        workspace.name,
        workspace.identifier,
        workspace.gitIdentity.branch,
      ].some(value => value?.toLocaleLowerCase().includes(normalizedSearch)))
    : projects
  const workspaces = projects
    .map(project => project.workspace)
    .filter(workspace => workspace.availability === 'available')
  return (
    <Screen
      avoidKeyboard={workspaces.length > 0}
      action={<AppMenuButton current="projects" onSelect={onNavigate} />}
      footer={workspaces.length > 0
        ? (
            <WorkComposer
              isCreating={isCreating}
              onCreate={onCreate}
              ref={composerRef}
              showWorkType={false}
              workspaces={workspaces}
            />
          )
        : undefined}
      leading={<CradleIconButton onPress={onOpenUsage} />}
      onPressBackground={() => {
        composerRef.current?.collapse()
        Keyboard.dismiss()
      }}
      scroll={false}
      title="Workspaces"
    >
      <View style={styles.search}>
        <InputGroup
          addon={<Search color={theme.mutedForeground} size={17} />}
          autoCapitalize="none"
          autoCorrect={false}
          clearButtonMode="while-editing"
          onChangeText={setSearch}
          placeholder="Search workspaces"
          returnKeyType="search"
          value={search}
        />
      </View>
      <FlatList
        contentContainerStyle={filteredProjects.length === 0 ? styles.emptyList : styles.list}
        data={filteredProjects}
        keyExtractor={({ workspace }) => workspace.id}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={(
          <EmptyState
            description={normalizedSearch
              ? 'Try a different workspace name, identifier, or branch.'
              : 'Add a Workspace from Cradle Desktop, then refresh this page.'}
            title={normalizedSearch ? 'No matching workspaces' : 'No projects yet'}
          />
        )}
        onRefresh={onRefresh}
        refreshing={isRefreshing}
        renderItem={({ item: { workspace, sessions } }) => (
          <Item
            actions={(
              <View style={styles.actions}>
                <Text style={[styles.count, { color: theme.mutedForeground }]}>{sessions.length}</Text>
                <ChevronRight color={theme.dimForeground} size={20} />
              </View>
            )}
            media={workspace.availability === 'missing'
              ? <FolderX color={theme.destructive} size={22} strokeWidth={1.7} />
              : <Folder color={theme.mutedForeground} size={22} strokeWidth={1.7} />}
            onPress={() => onOpenProject(workspace.id)}
            title={workspace.name}
          />
        )}
        style={styles.virtualList}
      />
    </Screen>
  )
}

const styles = StyleSheet.create({
  actions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
  },
  count: {

    fontSize: 15,
    fontVariant: ['tabular-nums'],
  },
  emptyList: {
    flexGrow: 1,
  },
  list: {
    marginTop: 8,
  },
  search: {
    marginBottom: spacing.sm,
  },
  virtualList: {
    flex: 1,
  },
})
