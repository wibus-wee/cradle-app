import { ChevronRight, Folder, FolderX } from 'lucide-react-native'
import { useRef } from 'react'
import { Keyboard, StyleSheet, Text, View } from 'react-native'

import type { GetSessionsResponse, GetWorkspacesResponse, PostWorksData } from '@/api-gen'
import type { AppSection } from '@/components/common/app-menu-button'
import { AppMenuButton } from '@/components/common/app-menu-button'
import { CradleIconButton } from '@/components/common/cradle-icon-button'
import { Item } from '@/components/ui/item'
import { Screen } from '@/components/ui/screen'
import { EmptyState } from '@/components/ui/states'
import type { WorkComposerHandle } from '@/features/work/WorkComposer'
import { WorkComposer } from '@/features/work/WorkComposer'
import { useTheme } from '@/theme/use-theme'

type Workspace = GetWorkspacesResponse[number]
type Session = GetSessionsResponse[number]

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
      onRefresh={onRefresh}
      refreshing={isRefreshing}
      title="Workspaces"
    >
      {projects.length === 0
        ? (
            <EmptyState
              description="Add a Workspace from Cradle Desktop, then refresh this page."
              title="No projects yet"
            />
          )
        : (
            <View style={styles.list}>
              {projects.map(({ workspace, sessions }) => {
                return (
                  <Item
                    actions={(
                      <View style={styles.actions}>
                        <Text style={[styles.count, { color: theme.mutedForeground }]}>{sessions.length}</Text>
                        <ChevronRight color={theme.dimForeground} size={20} />
                      </View>
                    )}
                    key={workspace.id}
                    media={workspace.availability === 'missing'
                      ? <FolderX color={theme.destructive} size={22} strokeWidth={1.7} />
                      : <Folder color={theme.mutedForeground} size={22} strokeWidth={1.7} />}
                    onPress={() => onOpenProject(workspace.id)}
                    title={workspace.name}
                  />
                )
              })}
            </View>
          )}
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
  list: {
    marginTop: 8,
  },
})
