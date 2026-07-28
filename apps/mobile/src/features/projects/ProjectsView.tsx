import { Folder, Radio, ServerOff } from 'lucide-react-native'
import { StyleSheet, Text, View } from 'react-native'

import type { GetSessionsResponse, GetWorkspacesResponse } from '@/api-gen'
import { PressableScale } from '@/components/ui/pressable-scale'
import { Screen } from '@/components/ui/screen'
import { EmptyState } from '@/components/ui/states'
import { StatusPill } from '@/components/ui/status-pill'
import { compactPath, relativeTime } from '@/lib/format'
import { radius, spacing } from '@/theme/tokens'
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
  onOpenProject: (workspaceId: string) => void
  onRefresh?: () => void
}

export function ProjectsView({
  projects,
  isRefreshing = false,
  onOpenProject,
  onRefresh,
}: ProjectsViewProps) {
  const theme = useTheme()
  const activeCount = projects.reduce(
    (count, project) => count + project.sessions.filter(session => session.status === 'streaming').length,
    0,
  )

  return (
    <Screen
      onRefresh={onRefresh}
      refreshing={isRefreshing}
      subtitle={activeCount > 0 ? `${activeCount} active across your server` : 'Your server is quiet'}
      title="Projects"
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
                const active = sessions.filter(session => session.status === 'streaming').length
                const latest = sessions.reduce<number | null>((value, session) => {
                  const activity = session.latestAssistantMessageAt ?? session.latestUserMessageAt ?? session.updatedAt
                  return value === null || activity > value ? activity : value
                }, null)
                return (
                  <PressableScale
                    accessibilityRole="button"
                    key={workspace.id}
                    onPress={() => onOpenProject(workspace.id)}
                    style={[styles.project, { backgroundColor: theme.card, borderColor: theme.border }]}
                  >
                    <View style={[styles.iconFrame, { backgroundColor: theme.muted }]}>
                      {workspace.availability === 'missing'
                        ? <ServerOff color={theme.destructive} size={21} />
                        : <Folder color={theme.foreground} fill={`${theme.foreground}18`} size={21} />}
                    </View>
                    <View style={styles.projectCopy}>
                      <View style={styles.titleRow}>
                        <Text numberOfLines={1} style={[styles.projectTitle, { color: theme.foreground }]}>
                          {workspace.name}
                        </Text>
                        {active > 0 && <StatusPill label={`${active} active`} tone="success" />}
                      </View>
                      <Text numberOfLines={1} style={[styles.path, { color: theme.mutedForeground }]}>
                        {compactPath(workspace.locator.path)}
                      </Text>
                      <View style={styles.meta}>
                        <Text style={[styles.metaText, { color: theme.mutedForeground }]}>
                          {sessions.length}
{' '}
conversations
                        </Text>
                        <View style={[styles.separator, { backgroundColor: theme.border }]} />
                        <Text style={[styles.metaText, { color: theme.mutedForeground }]}>
                          {relativeTime(latest)}
                        </Text>
                      </View>
                    </View>
                    {active > 0 && <Radio color={theme.success} size={17} />}
                  </PressableScale>
                )
              })}
            </View>
          )}
    </Screen>
  )
}

const styles = StyleSheet.create({
  iconFrame: {
    alignItems: 'center',
    borderRadius: radius.md,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  list: {
    gap: spacing.md,
  },
  meta: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  metaText: {
    fontFamily: 'Geist_400Regular',
    fontSize: 12,
    fontVariant: ['tabular-nums'],
  },
  path: {
    fontFamily: 'Geist_400Regular',
    fontSize: 13,
  },
  project: {
    alignItems: 'center',
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.md,
    minHeight: 104,
    padding: spacing.lg,
  },
  projectCopy: {
    flex: 1,
    gap: 7,
  },
  projectTitle: {
    flex: 1,
    fontFamily: 'Geist_600SemiBold',
    fontSize: 16,
  },
  separator: {
    height: 3,
    width: 3,
    borderRadius: 2,
  },
  titleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
})
