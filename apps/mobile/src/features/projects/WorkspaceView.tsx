import { ChevronRight, File, Folder, GitBranch, MessageSquareText } from 'lucide-react-native'
import { StyleSheet, Text, View } from 'react-native'

import type {
  GetSessionsResponse,
  GetWorkspacesByWorkspaceIdFilesChildrenResponse,
  GetWorkspacesResponse,
  GetWorksResponse,
} from '@/api-gen'
import { PressableScale } from '@/components/ui/pressable-scale'
import { Screen } from '@/components/ui/screen'
import { EmptyState } from '@/components/ui/states'
import { StatusPill } from '@/components/ui/status-pill'
import { relativeTime } from '@/lib/format'
import { radius, spacing } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

type Workspace = GetWorkspacesResponse[number]
type Session = GetSessionsResponse[number]
type Work = GetWorksResponse[number]
type FileEntry = GetWorkspacesByWorkspaceIdFilesChildrenResponse[number]

export interface WorkspaceViewProps {
  workspace: Workspace
  sessions: Session[]
  works: Work[]
  files: FileEntry[]
  isRefreshing?: boolean
  onBack: () => void
  onOpenSession: (sessionId: string) => void
  onOpenWork: (workId: string) => void
  onRefresh?: () => void
}

function sessionTone(status: Session['status']) {
  if (status === 'streaming') { return 'success' as const }
  if (status === 'error') { return 'danger' as const }
  return 'neutral' as const
}

export function WorkspaceView({
  workspace,
  sessions,
  works,
  files,
  isRefreshing = false,
  onBack,
  onOpenSession,
  onOpenWork,
  onRefresh,
}: WorkspaceViewProps) {
  const theme = useTheme()
  return (
    <Screen
      onRefresh={onRefresh}
      refreshing={isRefreshing}
      subtitle={workspace.gitIdentity.branch ?? workspace.locator.path}
      title={workspace.name}
    >
      <PressableScale onPress={onBack} style={styles.back}>
        <Text style={[styles.backText, { color: theme.mutedForeground }]}>Projects</Text>
      </PressableScale>

      {works.length > 0 && (
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: theme.mutedForeground }]}>WORK</Text>
          {works.map(work => (
            <PressableScale
              key={work.id}
              onPress={() => onOpenWork(work.id)}
              style={[styles.row, { borderBottomColor: theme.border }]}
            >
              <GitBranch color={theme.foreground} size={19} />
              <View style={styles.rowCopy}>
                <Text numberOfLines={1} style={[styles.rowTitle, { color: theme.foreground }]}>{work.title}</Text>
                <Text style={[styles.rowMeta, { color: theme.mutedForeground }]}>
                  {relativeTime(work.updatedAt)}
                </Text>
              </View>
              <StatusPill
                label={work.activity}
                tone={work.activity === 'running' ? 'success' : work.activity === 'blocked' ? 'danger' : 'neutral'}
              />
            </PressableScale>
          ))}
        </View>
      )}

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: theme.mutedForeground }]}>CONVERSATIONS</Text>
        {sessions.length === 0
          ? <EmptyState description="Start a conversation or Work from Cradle Desktop." title="No conversations" />
          : sessions.map(session => (
              <PressableScale
                key={session.id}
                onPress={() => onOpenSession(session.id)}
                style={[styles.row, { borderBottomColor: theme.border }]}
              >
                <MessageSquareText color={theme.foreground} size={19} />
                <View style={styles.rowCopy}>
                  <Text numberOfLines={1} style={[styles.rowTitle, { color: theme.foreground }]}>
                    {session.title ?? 'Untitled conversation'}
                  </Text>
                  <Text style={[styles.rowMeta, { color: theme.mutedForeground }]}>
                    {relativeTime(session.latestAssistantMessageAt ?? session.latestUserMessageAt ?? session.updatedAt)}
                  </Text>
                </View>
                <StatusPill label={session.status} tone={sessionTone(session.status)} />
              </PressableScale>
            ))}
      </View>

      {files.length > 0 && (
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: theme.mutedForeground }]}>TOP-LEVEL FILES</Text>
          <View style={[styles.fileGrid, { backgroundColor: theme.card, borderColor: theme.border }]}>
            {files.slice(0, 12).map(entry => (
              <View key={entry.path} style={styles.file}>
                {entry.type === 'directory'
                  ? <Folder color={theme.mutedForeground} size={17} />
                  : <File color={theme.mutedForeground} size={17} />}
                <Text numberOfLines={1} style={[styles.fileName, { color: theme.foreground }]}>{entry.name}</Text>
                {entry.type === 'directory' && <ChevronRight color={theme.mutedForeground} size={15} />}
              </View>
            ))}
          </View>
        </View>
      )}
    </Screen>
  )
}

const styles = StyleSheet.create({
  back: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    height: 40,
    justifyContent: 'center',
    marginBottom: spacing.sm,
    marginTop: -spacing.lg,
  },
  backText: {
    fontFamily: 'Geist_500Medium',
    fontSize: 14,
  },
  file: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 44,
  },
  fileGrid: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    gap: spacing.xs,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  fileName: {
    flex: 1,
    fontFamily: 'Geist_400Regular',
    fontSize: 14,
  },
  row: {
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.md,
    minHeight: 66,
  },
  rowCopy: {
    flex: 1,
    gap: spacing.xs,
  },
  rowMeta: {
    fontFamily: 'Geist_400Regular',
    fontSize: 12,
    fontVariant: ['tabular-nums'],
  },
  rowTitle: {
    fontFamily: 'Geist_500Medium',
    fontSize: 15,
  },
  section: {
    marginBottom: spacing.xl,
  },
  sectionTitle: {
    fontFamily: 'Geist_600SemiBold',
    fontSize: 11,
    marginBottom: spacing.sm,
  },
})
