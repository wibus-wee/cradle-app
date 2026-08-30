import { ChevronRight, File, Folder, GitBranch, Info, MessageSquareText } from 'lucide-react-native'
import type { ReactElement } from 'react'
import { useRef } from 'react'
import { FlatList, Keyboard, StyleSheet, View } from 'react-native'

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
type Session = GetSessionsResponse['items'][number]
type Work = GetWorksResponse['items'][number]
type FileEntry = GetWorkspacesByWorkspaceIdFilesChildrenResponse[number]
type WorkspaceRow
  = | { key: string, kind: 'heading', title: string, meta: string }
    | { key: string, kind: 'work', work: Work }
    | { key: string, kind: 'session', session: Session }
    | { key: string, kind: 'file', entry: FileEntry }
    | { key: string, kind: 'empty', node: ReactElement }

export interface WorkspaceViewProps {
  workspace: Workspace
  workspaces: Workspace[]
  sessions: Session[]
  works: Work[]
  files: FileEntry[]
  isCreating?: boolean
  isRefreshing?: boolean
  onCreate: (input: PostWorksData['body']) => void
  onOpenFile: (path: string) => void
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
  onOpenFile,
  onOpenSession,
  onOpenWork,
  onOpenWorkInfo,
  onRefresh,
}: WorkspaceViewProps) {
  const theme = useTheme()
  const composerRef = useRef<WorkComposerHandle>(null)
  const canCreateWork = workspaces.some(candidate => candidate.id === workspace.id)
  const rows: WorkspaceRow[] = []
  if (works.length > 0) {
    rows.push({ key: 'heading-work', kind: 'heading', meta: `${works.length}`, title: 'Work' })
    rows.push(...works.map(work => ({ key: `work-${work.id}`, kind: 'work' as const, work })))
  }
  rows.push({ key: 'heading-sessions', kind: 'heading', meta: `${sessions.length}`, title: 'Conversations' })
  if (sessions.length === 0) {
    rows.push({
      key: 'empty-sessions',
      kind: 'empty',
      node: <EmptyState description="Start a conversation or Work from Cradle Desktop." title="No conversations" />,
    })
  }
  else {
    rows.push(...sessions.map(session => ({ key: `session-${session.id}`, kind: 'session' as const, session })))
  }
  if (files.length > 0) {
    rows.push({ key: 'heading-files', kind: 'heading', meta: `${files.length} top-level`, title: 'Files' })
    rows.push(...files.slice(0, 12).map(entry => ({ key: `file-${entry.path}`, entry, kind: 'file' as const })))
  }
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
      scroll={false}
      title={workspace.name}
    >
      <FlatList
        data={rows}
        keyExtractor={row => row.key}
        keyboardShouldPersistTaps="handled"
        onRefresh={onRefresh}
        refreshing={isRefreshing}
        renderItem={({ item }) => {
          if (item.kind === 'heading') {
            return <View style={styles.section}><SectionHeading meta={item.meta} title={item.title} /></View>
          }
          if (item.kind === 'empty') { return item.node }
          if (item.kind === 'work') {
            const { work } = item
            return (
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
            )
          }
          if (item.kind === 'session') {
            const { session } = item
            return (
              <Item
                actions={<StatusPill label={session.status} tone={sessionTone(session.status)} />}
                description={relativeTime(session.latestAssistantMessageAt ?? session.latestUserMessageAt ?? session.updatedAt)}
                media={<MessageSquareText color={theme.session} size={16} />}
                onPress={() => onOpenSession(session.id)}
                title={session.title ?? 'Untitled conversation'}
                variant="muted"
              />
            )
          }
          const { entry } = item
          return (
            <Item
              actions={entry.type === 'file' && <ChevronRight color={theme.dimForeground} size={14} />}
              media={entry.type === 'directory'
                ? <Folder color={theme.tertiaryForeground} size={15} />
                : <File color={theme.tertiaryForeground} size={15} />}
              onPress={entry.type === 'file' ? () => onOpenFile(entry.path) : undefined}
              size="sm"
              title={entry.name}
            />
          )
        }}
        style={styles.list}
      />
    </Screen>
  )
}

const styles = StyleSheet.create({
  list: {
    flex: 1,
  },
  section: {
    marginTop: spacing.md,
  },
})
