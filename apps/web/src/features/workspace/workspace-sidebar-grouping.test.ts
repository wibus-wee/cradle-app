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
  const now = 1_700_000_000_000
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
    listActivityAt: now,
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
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
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

const DAY_MS = 24 * 60 * 60 * 1000
// A fixed local "now" at noon so calendar-day bucketing is deterministic.
const NOW = new Date(2026, 6, 20, 12, 0, 0).getTime()

describe('classifyUpdatedBucket', () => {
  it('buckets by local calendar day distance', () => {
    expect(classifyUpdatedBucket(NOW - 60_000, NOW)).toBe('today')
    expect(classifyUpdatedBucket(NOW - DAY_MS, NOW)).toBe('yesterday')
    expect(classifyUpdatedBucket(NOW - 3 * DAY_MS, NOW)).toBe('previous7Days')
    expect(classifyUpdatedBucket(NOW - 7 * DAY_MS, NOW)).toBe('previous7Days')
    expect(classifyUpdatedBucket(NOW - 8 * DAY_MS, NOW)).toBe('earlier')
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
        entry(createSession({ id: 'today', listActivityAt: NOW - 60_000 })),
        entry(createSession({ id: 'earlier', listActivityAt: NOW - 30 * DAY_MS })),
        entry(createSession({ id: 'yesterday', listActivityAt: NOW - DAY_MS })),
      ]),
      grouping: 'updated',
      now: NOW,
    })

    expect(sections.map(section => section.labelKey)).toEqual([
      'sidebar.filter.bucket.today',
      'sidebar.filter.bucket.yesterday',
      'sidebar.filter.bucket.earlier',
    ])
  })

  it('sorts pinned sessions first within a bucket, then by ordering', () => {
    const [section] = groupSidebarSessions({
      ...baseGroupingInput([
        entry(createSession({ id: 'old', listActivityAt: NOW - 2 * 60_000 })),
        entry(createSession({ id: 'pinned', pinned: 1, listActivityAt: NOW - 3 * 60_000 })),
        entry(createSession({ id: 'new', listActivityAt: NOW - 60_000 })),
      ]),
      grouping: 'updated',
      now: NOW,
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
