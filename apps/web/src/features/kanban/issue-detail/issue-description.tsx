import { useQueries } from '@tanstack/react-query'
import { z } from 'zod'

import { getChatSessionsBySessionIdMessages, getIssuesSearch } from '~/api-gen/sdk.gen'
import { MarkdownEditor } from '~/components/editor/markdown-editor'
import { useUploadAsset } from '~/features/assets/use-upload-asset'
import type {
  SmartMentionAttrs,
  SmartMentionItem,
  SmartMentionKind,
} from '~/components/editor/smart-mention-utils'
import { useAgents } from '~/features/agent-runtime/use-agents'
import type { KanbanBoard, KanbanIssue } from '~/features/kanban/types'
import { useWorkspaceSessions } from '~/features/workspace/use-session'
import { getWorkspaceLocationLabel } from '~/features/workspace/types'
import { useWorkspaces } from '~/features/workspace/use-workspace'
import { searchWorkspaceFiles } from '~/features/workspace/use-workspace-files'
import { openChatSession, openKanbanBoard, openSettingsSection, openWorkspaceDetail } from '~/navigation/navigation-commands'
import { useBrowserPanelStore } from '~/store/browser-panel'
import { useLayoutStore } from '~/store/layout'
import { useSettingsOverlayStore } from '~/store/settings-overlay'

import { formatIssueId } from '../shared/format-issue-id'
import { useAllBoards, useIssues, useMilestones, useStatuses } from '../use-kanban'

interface IssueDescriptionProps {
  issue: KanbanIssue
  onUpdate: (patch: { description: string | null }) => void
  readOnly?: boolean
}

const SessionMessageListSchema = z
  .array(
    z.object({
      id: z.string(),
    }),
  )
  .default([])

const IssueSearchListSchema = z
  .array(
    z
      .object({
        id: z.string(),
        workspaceId: z.string(),
        number: z.number(),
        statusId: z.string().nullable(),
        milestoneId: z.string().nullable(),
        parentIssueId: z.string().nullable(),
        title: z.string(),
        description: z.string().nullable(),
        priority: z.enum(['none', 'low', 'medium', 'high', 'urgent']),
        labels: z.array(z.string()),
        assigneeKind: z.string().nullable(),
        assigneeId: z.string().nullable(),
        dueDate: z.number().nullable(),
        createdByKind: z.enum(['user', 'agent', 'provider-target', 'system']),
        createdById: z.string(),
        sourceChatSessionId: z.string().nullable(),
        delegateAgentId: z.string().nullable(),
        delegateProviderTargetId: z.string().nullable(),
        contextRefs: z.string(),
        order: z.number(),
        createdAt: z.number(),
        updatedAt: z.number(),
      })
      .passthrough(),
  )
  .default([])

const MENTION_KIND_ORDER: SmartMentionKind[] = [
  'issue',
  'session',
  'workspace',
  'agent',
  'milestone',
  'file',
]

const MENTION_KIND_PREFIX: Record<string, SmartMentionKind> = {
  issue: 'issue',
  session: 'session',
  workspace: 'workspace',
  agent: 'agent',
  milestone: 'milestone',
  file: 'file',
}

const MENTION_QUERY_PREFIX_PATTERN = /^(issue|session|workspace|agent|milestone|file)\s+/i

function parseMentionQuery(query: string): { kind: SmartMentionKind | null, text: string } {
  const trimmed = query.trim()
  const match = trimmed.match(MENTION_QUERY_PREFIX_PATTERN)
  if (!match) {
    return { kind: null, text: trimmed.toLowerCase() }
  }

  return {
    kind: MENTION_KIND_PREFIX[match[1].toLowerCase()] ?? null,
    text: trimmed.slice(match[0].length).trim().toLowerCase(),
  }
}

function itemMatches(item: SmartMentionItem, query: string) {
  const parsed = parseMentionQuery(query)
  if (parsed.kind && item.kind !== parsed.kind) {
    return false
  }
  if (!parsed.text) {
    return true
  }

  const searchText = [
    item.kind,
    item.id,
    item.label,
    item.title ?? '',
    item.detail ?? '',
    item.searchText ?? '',
  ]
    .join(' ')
    .toLowerCase()

  return searchText.includes(parsed.text)
}

function limitItems(items: SmartMentionItem[], query: string, limit: number) {
  return items.filter(item => itemMatches(item, query)).slice(0, limit)
}

function balancedItems(items: SmartMentionItem[], query: string, limit: number) {
  const matches = items.filter(item => itemMatches(item, query))
  const selected: SmartMentionItem[] = []
  const selectedKeys = new Set<string>()

  for (const kind of MENTION_KIND_ORDER) {
    const item = matches.find(candidate => candidate.kind === kind)
    if (!item) {
      continue
    }

    selected.push(item)
    selectedKeys.add(`${item.kind}:${item.id}`)
  }

  for (const item of matches) {
    if (selected.length >= limit) {
      break
    }
    const key = `${item.kind}:${item.id}`
    if (selectedKeys.has(key)) {
      continue
    }

    selected.push(item)
    selectedKeys.add(key)
  }

  return selected
}

function getFirstBoardForWorkspace(
  boards: KanbanBoard[] | undefined,
  workspaceId: string | null | undefined,
) {
  if (!workspaceId) {
    return null
  }
  return boards?.find(board => board.workspaceId === workspaceId) ?? null
}

export function IssueDescription({ issue, onUpdate, readOnly = false }: IssueDescriptionProps) {
  const openWorkspaceFileTab = useBrowserPanelStore(state => state.openWorkspaceFileTab)
  const setBrowserPanelOpen = useLayoutStore(state => state.setBrowserPanelOpen)
  const { workspaces } = useWorkspaces()
  const { agents } = useAgents()
  const { sessions } = useWorkspaceSessions(issue.workspaceId)
  const { data: statuses = [] } = useStatuses(issue.workspaceId)
  const { data: milestones = [] } = useMilestones(issue.workspaceId)
  const { data: workspaceIssues = [] } = useIssues({ workspaceId: issue.workspaceId })
  const { data: boards = [] } = useAllBoards()
  const setSettingsSection = useSettingsOverlayStore(s => s.setSettingsSection)
  const setAgentFocusTarget = useSettingsOverlayStore(s => s.setAgentFocusTarget)
  const assetUpload = useUploadAsset({ workspaceId: issue.workspaceId })

  const sessionMessageCounts = useQueries({
    queries: sessions.slice(0, 20).map(session => ({
      queryKey: ['session-message-count', session.id] as const,
      queryFn: async () => {
        const { data } = await getChatSessionsBySessionIdMessages({
          path: { sessionId: session.id },
        })
        return SessionMessageListSchema.parse(data).length
      },
      staleTime: 30_000,
    })),
  })

  const sessionMessageCountById = (() => {
    const counts = new Map<string, number>()
    sessions.slice(0, 20).forEach((session, index) => {
      const count = sessionMessageCounts[index]?.data
      if (typeof count === 'number') {
        counts.set(session.id, count)
      }
    })
    return counts
  })()

  const staticItems = ((): SmartMentionItem[] => {
    const workspaceById = new Map(workspaces.map(workspace => [workspace.id, workspace]))
    const statusById = new Map(statuses.map(status => [status.id, status]))

    const sessionItems = sessions.map((session): SmartMentionItem => {
      const count = sessionMessageCountById.get(session.id)
      return {
        kind: 'session',
        id: session.id,
        label: session.title || session.id.slice(0, 8),
        title: session.title || 'Untitled session',
        detail: typeof count === 'number' ? `${count} messages` : 'Message count loading',
        workspaceId: session.workspaceId,
        searchText: `${session.title ?? ''} ${session.runtimeKind}`,
      }
    })

    const workspaceItems = workspaces.map(
      (workspace): SmartMentionItem => {
        const locationLabel = getWorkspaceLocationLabel(workspace)
        return {
        kind: 'workspace',
        id: workspace.id,
        label: workspace.name,
        title: workspace.name,
        detail: locationLabel,
        workspaceId: workspace.id,
        searchText: `${workspace.identifier} ${locationLabel}`,
        }
      },
    )

    const agentItems = agents.map(
      (agent): SmartMentionItem => ({
        kind: 'agent',
        id: agent.id,
        label: agent.name,
        title: agent.name,
        detail: agent.enabled ? 'Enabled' : 'Disabled',
        searchText: `${agent.description ?? ''} ${agent.runtimeKind}`,
      }),
    )

    const completedStatusIds = new Set(
      statuses.filter(status => status.category === 'completed').map(status => status.id),
    )

    const milestoneItems = milestones.map((milestone): SmartMentionItem => {
      const milestoneIssues = workspaceIssues.filter(
        candidate => candidate.milestoneId === milestone.id,
      )
      const completedCount = milestoneIssues.filter(
        candidate => candidate.statusId && completedStatusIds.has(candidate.statusId),
      ).length
      const progress
        = milestoneIssues.length > 0
          ? `${completedCount}/${milestoneIssues.length} completed`
          : 'No issues'
      return {
        kind: 'milestone',
        id: milestone.id,
        label: milestone.title,
        title: milestone.title,
        detail: `${milestone.status} · ${progress}`,
        workspaceId: milestone.workspaceId,
        searchText: milestone.description ?? '',
      }
    })

    const currentIssueStatus = issue.statusId ? statusById.get(issue.statusId) : null
    const currentWorkspace = workspaceById.get(issue.workspaceId)
    const currentIssueItem: SmartMentionItem = {
      kind: 'issue',
      id: issue.id,
      label: formatIssueId(issue, workspaces),
      title: issue.title,
      detail: `${currentIssueStatus?.name ?? 'No status'} · ${issue.priority}`,
      workspaceId: issue.workspaceId,
      searchText: `${currentWorkspace?.identifier ?? ''} ${issue.description ?? ''}`,
    }

    return [currentIssueItem, ...sessionItems, ...workspaceItems, ...agentItems, ...milestoneItems]
  })()

  const getMentionItems = async (query: string): Promise<SmartMentionItem[]> => {
    const parsed = parseMentionQuery(query)
    const localItems = limitItems(staticItems, query, 12)

    if (!parsed.text) {
      return balancedItems(staticItems, query, 20)
    }

    let issueItems: SmartMentionItem[] = []
    let fileItems: SmartMentionItem[] = []
    try {
      if (parsed.kind === 'file' || (!parsed.kind && parsed.text)) {
        const files = await searchWorkspaceFiles({
          workspaceId: issue.workspaceId,
          query: parsed.text,
          limit: 8,
        })
        fileItems = files
          .filter(file => file.type === 'file')
          .map(
            (file): SmartMentionItem => ({
              kind: 'file',
              id: file.path,
              label: file.name,
              title: file.path,
              detail: file.path,
              workspaceId: issue.workspaceId,
              searchText: file.path,
            }),
          )
      }

      if (parsed.kind && parsed.kind !== 'issue') {
        return [...fileItems, ...localItems].slice(0, 20)
      }

      const { data } = await getIssuesSearch({ query: { q: parsed.text, limit: '8' } })
      const searchResults = IssueSearchListSchema.parse(data) satisfies KanbanIssue[]
      issueItems = searchResults.map((result): SmartMentionItem => {
        const status = result.statusId ? statuses.find(s => s.id === result.statusId) : null
        return {
          kind: 'issue',
          id: result.id,
          label: formatIssueId(result, workspaces),
          title: result.title,
          detail: `${status?.name ?? 'No status'} · ${result.priority}`,
          workspaceId: result.workspaceId,
          searchText: result.description ?? '',
        }
      })
    }
 catch (error) {
      console.error('[IssueDescription] failed to search issue mentions:', error)
    }

    const seen = new Set<string>()
    return [...issueItems, ...fileItems, ...localItems]
      .filter((item) => {
        const key = `${item.kind}:${item.id}`
        if (seen.has(key)) {
          return false
        }
        seen.add(key)
        return true
      })
      .slice(0, 20)
  }

  const handleMentionOpen = (attrs: SmartMentionAttrs) => {
    if (attrs.kind === 'issue') {
      const board = getFirstBoardForWorkspace(boards, attrs.workspaceId ?? issue.workspaceId)
      if (board) {
        openKanbanBoard({ boardId: board.id, issueId: attrs.id })
      }
      return
    }

    if (attrs.kind === 'session') {
      openChatSession(attrs.id)
      return
    }

    if (attrs.kind === 'workspace') {
      openWorkspaceDetail(attrs.id)
      return
    }

    if (attrs.kind === 'file') {
      openWorkspaceFileTab({
        workspaceId: attrs.workspaceId ?? issue.workspaceId,
        path: attrs.id,
        view: 'preview',
      })
      setBrowserPanelOpen(true)
      return
    }

    if (attrs.kind === 'agent') {
      setSettingsSection('agents')
      setAgentFocusTarget({ id: attrs.id })
      openSettingsSection('agents')
      return
    }

    if (attrs.kind === 'milestone') {
      const board = getFirstBoardForWorkspace(boards, attrs.workspaceId ?? issue.workspaceId)
      if (board) {
        openKanbanBoard({ boardId: board.id, milestoneId: attrs.id })
      }
    }
  }

  return (
    <div data-testid="issue-description-editor">
      <MarkdownEditor
        content={issue.description ?? ''}
        documentId={issue.id}
        onSave={(md) => {
          if (!readOnly && md !== (issue.description ?? '')) {
            onUpdate({ description: md || null })
          }
        }}
        readonly={readOnly}
        placeholder="Add description..."
        assetImages={readOnly ? undefined : { upload: assetUpload.upload }}
        smartMentions={{
          getItems: getMentionItems,
          onOpen: handleMentionOpen,
        }}
      />
    </div>
  )
}
