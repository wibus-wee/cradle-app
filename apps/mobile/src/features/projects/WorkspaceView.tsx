import { ChevronRight, File, Folder, GitBranch, Info, MessageSquareText } from 'lucide-react-native'
import { useRef } from 'react'
import { Keyboard, StyleSheet, View } from 'react-native'

import type {
  GetSessionsResponse,
  GetWorkspacesByWorkspaceIdFilesChildrenResponse,
  GetWorkspacesResponse,
  GetWorksResponse,
  PostWorksData,
} from '@/api-gen'
import { IconButton } from '@/components/ui/icon-button'
import { Item } from '@/components/ui/item'
import { Screen } from '@/components/ui/screen'
import { SectionHeading } from '@/components/ui/section-heading'
import { EmptyState } from '@/components/ui/states'
import { StatusPill } from '@/components/ui/status-pill'
import type { WorkComposerHandle } from '@/features/work/WorkComposer'
import { WorkComposer } from '@/features/work/WorkComposer'
import { relativeTime } from '@/lib/format'
import { spacing } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

type Workspace = GetWorkspacesResponse[number]
type Session = GetSessionsResponse[number]
type Work = GetWorksResponse[number]
type FileEntry = GetWorkspacesByWorkspaceIdFilesChildrenResponse[number]

export interface WorkspaceViewProps {
  workspace: Workspace
  workspaces: Workspace[]
  sessions: Session[]
  works: Work[]
  files: FileEntry[]
  isCreating?: boolean
  isRefreshing?: boolean
  onCreate: (input: PostWorksData['body']) => void
  onOpenSession: (sessionId: string) => void
  onOpenWork: (sessionId: string) => void
  onOpenWorkInfo: (workId: string) => void
  onRefresh?: () => void
}

function sessionTone(status: Session['status']) {
  if (status === 'streaming') { return 'success' as const }
  if (status === 'error') { return 'danger' as const }
  return 'neutral' as const
}

export function WorkspaceView({
  workspace,
  workspaces,
  sessions,
  works,
  files,
  isCreating = false,
  isRefreshing = false,
  onCreate,
  onOpenSession,
  onOpenWork,
  onOpenWorkInfo,
  onRefresh,
}: WorkspaceViewProps) {
  const theme = useTheme()
  const composerRef = useRef<WorkComposerHandle>(null)
  const canCreateWork = workspaces.some(candidate => candidate.id === workspace.id)
  return (
    <Screen
      avoidKeyboard={canCreateWork}
      footer={canCreateWork
        ? (
            <WorkComposer
              initialWorkspaceId={workspace.id}
              isCreating={isCreating}
              onCreate={onCreate}
              ref={composerRef}
              showWorkType={false}
              workspaces={workspaces}
            />
          )
        : undefined}
      insetTop={false}
      onPressBackground={() => {
        composerRef.current?.collapse()
        Keyboard.dismiss()
      }}
      onRefresh={onRefresh}
      refreshing={isRefreshing}
      title={workspace.name}
    >
      {works.length > 0 && (
        <View style={styles.section}>
          <SectionHeading meta={`${works.length}`} title="Work" />
          <View style={styles.group}>
            {works.map(work => (
              <Item
                actions={(
                  <>
                    <StatusPill
                      label={work.activity}
                      tone={work.activity === 'running' ? 'success' : work.activity === 'blocked' ? 'danger' : 'neutral'}
                    />
                    <IconButton
                      accessibilityLabel={`Open info for ${work.title}`}
                      icon={Info}
                      onPress={() => onOpenWorkInfo(work.id)}
                      stopPropagation
                    />
                  </>
                )}
                description={relativeTime(work.updatedAt)}
                key={work.id}
                media={<GitBranch color={theme.workspace} size={16} />}
                onPress={() => onOpenWork(work.primarySessionId)}
                title={work.title}
                variant="muted"
              />
            ))}
          </View>
        </View>
      )}

      <View style={styles.section}>
        <SectionHeading meta={`${sessions.length}`} title="Conversations" />
        {sessions.length === 0
          ? <EmptyState description="Start a conversation or Work from Cradle Desktop." title="No conversations" />
          : (
              <View style={styles.group}>
                {sessions.map(session => (
                  <Item
                    actions={<StatusPill label={session.status} tone={sessionTone(session.status)} />}
                    description={relativeTime(session.latestAssistantMessageAt ?? session.latestUserMessageAt ?? session.updatedAt)}
                    key={session.id}
                    media={<MessageSquareText color={theme.session} size={16} />}
                    onPress={() => onOpenSession(session.id)}
                    title={session.title ?? 'Untitled conversation'}
                    variant="muted"
                  />
                ))}
              </View>
            )}
      </View>

      {files.length > 0 && (
        <View style={styles.section}>
          <SectionHeading meta={`${files.length} top-level`} title="Files" />
          <View style={styles.group}>
            {files.slice(0, 12).map(entry => (
              <Item
                actions={entry.type === 'directory' && <ChevronRight color={theme.dimForeground} size={14} />}
                key={entry.path}
                media={entry.type === 'directory'
                  ? <Folder color={theme.tertiaryForeground} size={15} />
                  : <File color={theme.tertiaryForeground} size={15} />}
                size="sm"
                title={entry.name}
              />
            ))}
          </View>
        </View>
      )}
    </Screen>
  )
}

const styles = StyleSheet.create({
  group: {
    gap: 0,
  },
  section: {
    marginBottom: spacing.lg,
  },
})
