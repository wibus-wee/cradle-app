import { ChevronRight, Folder, FolderX } from 'lucide-react-native'
import { StyleSheet, Text, View } from 'react-native'

import type { GetSessionsResponse, GetWorkspacesResponse } from '@/api-gen'
import type { AppSection } from '@/components/common/app-menu-button'
import { AppMenuButton } from '@/components/common/app-menu-button'
import { CradleIconButton } from '@/components/common/cradle-icon-button'
import { Item } from '@/components/ui/item'
import { Screen } from '@/components/ui/screen'
import { EmptyState } from '@/components/ui/states'
import { useTheme } from '@/theme/use-theme'

type Workspace = GetWorkspacesResponse[number]
type Session = GetSessionsResponse[number]

export interface WorkspaceSummary {
  workspace: Workspace
  sessions: Session[]
}

export interface ProjectsViewProps {
  projects: WorkspaceSummary[]
  isRefreshing?: boolean
  onNavigate: (section: AppSection) => void
  onOpenUsage: () => void
  onOpenProject: (workspaceId: string) => void
  onRefresh?: () => void
}

export function ProjectsView({
  projects,
  isRefreshing = false,
  onNavigate,
  onOpenUsage,
  onOpenProject,
  onRefresh,
}: ProjectsViewProps) {
  const theme = useTheme()
  return (
    <Screen
      action={<AppMenuButton current="projects" onSelect={onNavigate} />}
      leading={<CradleIconButton onPress={onOpenUsage} />}
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
