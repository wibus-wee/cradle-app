import { describe, expect, it } from 'vitest'

import type { Workspace } from './types'
import type { WorkspaceSession } from './use-session'
import type { FabricNodeSummary, SidebarSessionEntry } from './workspace-sidebar-grouping'
import {
  classifyStatusBucket,
  classifyUpdatedBucket,
  computeSectionPreviewCount,
  groupSidebarSessions,
} from './workspace-sidebar-grouping'

function createSession(overrides: Partial<WorkspaceSession> & Pick<WorkspaceSession, 'id'>): WorkspaceSession {
  const now = 1_700_000_000
  return {
    workspaceId: 'workspace-1',
    title: overrides.id,
    providerTargetId: null,
    agentId: null,
    modelId: null,
    linkedIssueId: null,
    sessionGroupId: null,
    runtimeKind: 'standard',
    status: 'idle',
    pinned: 0,
    archivedAt: null,
    lastReadAt: null,
    createdAt: now,
    updatedAt: now,
    latestUserMessageAt: null,
    latestAssistantMessageAt: null,
    unread: false,
    origin: 'manual',
    isIsolated: false,
    worktreeId: null,
    worktreeBranch: null,
    execution: { kind: 'local' },
    ...overrides,
  }
}

const workspace: Workspace = {
  id: 'workspace-1',
  name: 'Cradle',
  locator: { nodeId: 'local', path: '/tmp/cradle' },
  gitIdentity: {},
  identifier: 'cradle',
  availability: 'available',
  multiFolder: false,
  pinned: 0,
  createdAt: 1_700_000_000,
  updatedAt: 1_700_000_000,
}

function entry(session: WorkspaceSession): SidebarSessionEntry {
  return { session, workspace }
}

function createNode(overrides: Partial<FabricNodeSummary> & Pick<FabricNodeSummary, 'nodeId'>): FabricNodeSummary {
  return {
    fabricId: 'fabric-1',
    displayName: overrides.nodeId,
    platform: 'darwin',
    version: '0.0.0',
    capabilities: [],
    status: 'online',
    lastSeenAt: '2026-07-20T00:00:00.000Z',
    revision: 1,
    ...overrides,
  }
}

const DAY_SECONDS = 24 * 60 * 60
// A fixed local "now" at noon so calendar-day bucketing is deterministic.
const NOW_MS = new Date(2026, 6, 20, 12, 0, 0).getTime()
const NOW_SECONDS = Math.floor(NOW_MS / 1000)

describe('classifyUpdatedBucket', () => {
  it('splits the current day at one hour, then buckets by local calendar day distance', () => {
    expect(classifyUpdatedBucket(NOW_SECONDS - 60, NOW_MS)).toBe('lastHour')
    expect(classifyUpdatedBucket(NOW_SECONDS - 3_599, NOW_MS)).toBe('lastHour')
    expect(classifyUpdatedBucket(NOW_SECONDS - 3_600, NOW_MS)).toBe('earlierToday')
    expect(classifyUpdatedBucket(NOW_SECONDS - DAY_SECONDS, NOW_MS)).toBe('yesterday')
    expect(classifyUpdatedBucket(NOW_SECONDS - 3 * DAY_SECONDS, NOW_MS)).toBe('previous7Days')
    expect(classifyUpdatedBucket(NOW_SECONDS - 7 * DAY_SECONDS, NOW_MS)).toBe('previous7Days')
    expect(classifyUpdatedBucket(NOW_SECONDS - 8 * DAY_SECONDS, NOW_MS)).toBe('earlier')
  })
})

describe('classifyStatusBucket', () => {
  const noStreaming = new Set<string>()
  const noErrored = new Set<string>()
  const noAttention = new Map<string, 'userInput' | 'toolApproval'>()

  it('assigns the highest-priority bucket only', () => {
    const session = createSession({ id: 's1', status: 'error', unread: true })
    expect(classifyStatusBucket(session, null, new Set(['s1']), noErrored, noAttention))
      .toBe('streaming')
    expect(classifyStatusBucket(
      session,
      null,
      noStreaming,
      noErrored,
      new Map([['s1', 'userInput' as const]]),
    )).toBe('needsYou')
    expect(classifyStatusBucket(session, null, noStreaming, noErrored, noAttention)).toBe('error')
    expect(classifyStatusBucket(
      createSession({ id: 'read-error', status: 'error', unread: false }),
      null,
      noStreaming,
      noErrored,
      noAttention,
    )).toBe('idle')
    expect(classifyStatusBucket(
      createSession({ id: 'local-read-error', unread: false }),
      null,
      noStreaming,
      new Set(['local-read-error']),
      noAttention,
    )).toBe('idle')
    expect(classifyStatusBucket(
      createSession({ id: 's2', unread: true }),
      null,
      noStreaming,
      noErrored,
      noAttention,
    )).toBe('unread')
    expect(classifyStatusBucket(
      createSession({ id: 's3' }),
      null,
      noStreaming,
      noErrored,
      noAttention,
    )).toBe('idle')
  })
})

function baseGroupingInput(entries: SidebarSessionEntry[]) {
  return {
    entries,
    ordering: 'updated' as const,
    orderingDirection: 'desc' as const,
    workByPrimarySessionId: new Map(),
    locallyStreamingSessionIds: new Set<string>(),
    locallyErroredSessionIds: new Set<string>(),
    attentionBySessionId: new Map<string, 'userInput' | 'toolApproval'>(),
    nodes: [],
  }
}

describe('groupSidebarSessions', () => {
  it('groups by updated buckets in fixed order, skipping empty buckets', () => {
    const sections = groupSidebarSessions({
      ...baseGroupingInput([
        entry(createSession({ id: 'last-hour', updatedAt: NOW_SECONDS - 60 })),
        entry(createSession({ id: 'earlier-today', updatedAt: NOW_SECONDS - 3_600 })),
        entry(createSession({ id: 'earlier', updatedAt: NOW_SECONDS - 30 * DAY_SECONDS })),
        entry(createSession({ id: 'yesterday', updatedAt: NOW_SECONDS - DAY_SECONDS })),
      ]),
      grouping: 'updated',
      now: NOW_MS,
    })

    expect(sections.map(section => section.labelKey)).toEqual([
      'sidebar.filter.bucket.lastHour',
      'sidebar.filter.bucket.earlierToday',
      'sidebar.filter.bucket.yesterday',
      'sidebar.filter.bucket.earlier',
    ])
  })

  it('sorts pinned sessions first within a bucket, then by ordering', () => {
    const [section] = groupSidebarSessions({
      ...baseGroupingInput([
        entry(createSession({ id: 'old', updatedAt: NOW_SECONDS - 120 })),
        entry(createSession({ id: 'pinned', pinned: 1, updatedAt: NOW_SECONDS - 180 })),
        entry(createSession({ id: 'new', updatedAt: NOW_SECONDS - 60 })),
      ]),
      grouping: 'updated',
      now: NOW_MS,
    })

    expect(section.entries.map(({ session }) => session.id)).toEqual(['pinned', 'new', 'old'])
  })

  it('groups by environment with a local bucket and named Node buckets', () => {
    const sections = groupSidebarSessions({
      ...baseGroupingInput([
        entry(createSession({ id: 'local' })),
        entry(createSession({
          id: 'remote',
          execution: { kind: 'node', nodeId: 'node-1', remoteSessionId: 'r1' },
        })),
        entry(createSession({
          id: 'unknown-node',
          execution: { kind: 'node', nodeId: 'node-gone', remoteSessionId: 'r2' },
        })),
      ]),
      grouping: 'environment',
      nodes: [createNode({ nodeId: 'node-1', displayName: 'Build Server' })],
    })

    expect(sections.map(section => [section.labelKey ?? null, section.label ?? null])).toEqual([
      ['sidebar.filter.environment.local', null],
      [null, 'Build Server'],
      [null, 'node-gone'],
    ])
  })
})

describe('computeSectionPreviewCount', () => {
  it('extends the preview so pinned or running sessions stay visible', () => {
    const entries = [
      entry(createSession({ id: 'a' })),
      entry(createSession({ id: 'b' })),
      entry(createSession({ id: 'c' })),
      entry(createSession({ id: 'pinned', pinned: 1 })),
    ]
    expect(computeSectionPreviewCount(entries, 2, new Set())).toBe(4)
    expect(computeSectionPreviewCount(entries, 5, new Set())).toBe(5)
  })
})
