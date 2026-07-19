// FILE: browser-panel.ts
// Purpose: Caches owner-scoped native BrowserPanel metadata and browser history for renderer chrome.
// Layer: Renderer Zustand store
// Depends on: Zustand persistence, browser IPC state snapshots

import type { FileUIPart } from 'ai'
import isEqual from 'fast-deep-equal'
import { z } from 'zod'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import { persistStorage } from './persist-storage'
import {
  closePaneInState,
  openPaneInState,
  setActivePaneInState,
  setDockOpenInState,
} from './right-dock.logic'

export const DEFAULT_BROWSER_PANEL_OWNER_ID = 'global'
export const BROWSER_PANEL_WEBVIEW_TAB_SHORTCUT_CHANNEL = 'browser-panel:webview-tab-shortcut'

const BROWSER_HISTORY_LIMIT = 12
const EMPTY_BROWSER_HISTORY: BrowserHistoryEntry[] = []
const EMPTY_BROWSER_ANNOTATIONS: BrowserAnnotationRecord[] = []
const BROWSER_PANEL_STORAGE_KEY = 'cradle:browser-panel:v2'
const BROWSER_PANEL_PERSIST_VERSION = 3
const BROWSER_PANEL_TAB_SHORTCUT_KEYS = new Set(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'])

interface BrowserPanelPersistedState {
  recentHistoryByOwnerId?: Record<string, BrowserHistoryEntry[]>
  annotationTrayCollapsedByOwnerId?: Record<string, boolean>
  dockStateByOwnerId?: Record<string, PersistedBrowserPanelDockState>
}

const browserHistoryEntrySchema = z.object({
  url: z.string(),
  title: z.string(),
  tabId: z.string(),
}) satisfies z.ZodType<BrowserHistoryEntry>

const browserHistoryByOwnerIdSchema = z.record(z.string(), z.array(browserHistoryEntrySchema))
const annotationTrayCollapsedByOwnerIdSchema = z.record(z.string(), z.boolean())
const browserPanelPersistedStateSchema = z.object({
  recentHistoryByOwnerId: z.unknown().optional(),
  annotationTrayCollapsedByOwnerId: z.unknown().optional(),
  dockStateByOwnerId: z.unknown().optional(),
})

export function readBrowserPanelPersistedState(raw: unknown): BrowserPanelPersistedState {
  const parsedState = browserPanelPersistedStateSchema.safeParse(raw)
  if (!parsedState.success) {
    return {
      recentHistoryByOwnerId: {},
      annotationTrayCollapsedByOwnerId: {},
      dockStateByOwnerId: {},
    }
  }

  const recentHistoryResult = parsedState.data.recentHistoryByOwnerId === undefined
    ? undefined
    : browserHistoryByOwnerIdSchema.safeParse(parsedState.data.recentHistoryByOwnerId)
  const collapsedResult = parsedState.data.annotationTrayCollapsedByOwnerId === undefined
    ? undefined
    : annotationTrayCollapsedByOwnerIdSchema.safeParse(parsedState.data.annotationTrayCollapsedByOwnerId)

  return {
    recentHistoryByOwnerId: recentHistoryResult?.success ? recentHistoryResult.data : {},
    annotationTrayCollapsedByOwnerId: collapsedResult?.success ? collapsedResult.data : {},
    dockStateByOwnerId: sanitizePersistedDockStateByOwnerId(parsedState.data.dockStateByOwnerId),
  }
}

export type BrowserPanelScriptRunAt = 'document-start' | 'document-end' | 'document-idle'

export interface BrowserPanelCustomScript {
  id: string
  label: string
  runAt: BrowserPanelScriptRunAt
  source: string
}

export interface BrowserTabSource {
  sessionId?: string | null
  sessionTitle?: string | null
}

export interface BrowserTabState {
  id: string
  url: string
  title: string
  status: 'live' | 'suspended'
  isLoading: boolean
  canGoBack: boolean
  canGoForward: boolean
  faviconUrl: string | null
  lastCommittedUrl: string | null
  lastError: string | null
}

export interface ThreadBrowserState {
  threadId: string
  version: number
  open: boolean
  activeTabId: string | null
  tabs: BrowserTabState[]
  lastError: string | null
}

export type BrowserWebTab = BrowserTabState & {
  kind: 'browser'
  sessionId: string | null
  sessionTitle: string | null
  scriptIds: string[]
  customScripts: BrowserPanelCustomScript[]
  loading: boolean
  favicon: string | null
}

export interface BrowserWorkspaceFileTab {
  kind: 'workspace-file'
  id: string
  workspaceId: string
  path: string
  view: 'editor' | 'preview'
  title: string
  loading: false
  favicon: null
}

export interface BrowserWorkspaceDiffTab {
  kind: 'workspace-diff'
  id: string
  workspaceId: string
  repositoryPath?: string
  paths?: string[]
  title: string
  loading: false
  favicon: null
}

export interface BrowserPullRequestTab {
  kind: 'pull-request'
  id: string
  owner: string
  repo: string
  number: number
  // Only present when Cradle created/bound this PR through a Work session -
  // an optional overlay, not the PR's identity (see pull-request module README).
  workId?: string
  sessionId?: string
  title: string
  loading: false
  favicon: null
}

export interface BrowserSubagentTab {
  kind: 'subagent'
  id: string
  sessionId: string
  threadId: string
  agentName: string
  agentRole: string | null
  title: string
  loading: false
  favicon: null
}

/** Live workflow runtime agent row (SSE snapshot from chat-runtime). */
export interface BrowserWorkflowRuntimeAgent {
  id: string
  declarationId: string | null
  index: number | null
  label: string
  phaseIndex: number | null
  phaseTitle: string | null
  alignment: 'declared' | 'unmatched' | 'inferred' | 'observed'
  prompt: string | null
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped'
  model: string | null
  totalTokens: number | null
  toolUses: number
  lastToolName: string | null
  lastToolSummary: string | null
  queuedAt: number | null
  startedAt: number | null
  updatedAt: number | null
  completedAt: number | null
  durationMs: number | null
  attempt: number | null
  result: unknown
  resultPreview: string | null
}

export interface BrowserWorkflowRuntimePhase {
  index: number
  title: string
  detail: string | null
  status: 'pending' | 'running' | 'completed' | 'failed'
  agentCount: number
  completedAgentCount: number
  runningAgentCount: number
  failedAgentCount: number
}

/** Live workflow runtime snapshot streamed from `/workflows/:toolCallId/stream`. */
export interface BrowserWorkflowRuntimeSnapshot {
  type: 'workflow-snapshot'
  workflow: {
    runId: string
    name: string | null
    description: string | null
    status: 'running' | 'completed' | 'failed' | 'stopped'
    startedAt: number
    durationMs: number | null
    result: unknown
    totalTokens: number | null
    totalToolCalls: number | null
    declarationIncomplete: boolean
  }
  phases: BrowserWorkflowRuntimePhase[]
  currentPhase: BrowserWorkflowRuntimePhase | null
  agents: BrowserWorkflowRuntimeAgent[]
  logs: string[]
  updatedAt: number
}

/** Static surface derived from tool input/output for opening a workflow tab. */
export interface BrowserWorkflowSurfaceSnapshot {
  workflowName: string | null
  description: string | null
  status: string | null
  taskId: string | null
  taskType: string | null
  runId: string | null
  scriptPath: string | null
  transcriptDir: string | null
  sessionUrl: string | null
  warning: string | null
  error: string | null
  phases: Array<{ name: string, description: string | null }>
  input: unknown
  output: unknown
  lifecycle: unknown[]
  runtime: BrowserWorkflowRuntimeSnapshot | null
}

export interface BrowserWorkflowTab {
  kind: 'workflow'
  id: string
  sessionId: string | null
  toolCallId: string
  title: string
  surface: BrowserWorkflowSurfaceSnapshot
  loading: false
  favicon: null
}

export interface BrowserSideConversationTab {
  kind: 'side-conversation'
  id: string
  parentSessionId: string
  sideConversationId: string
  providerSessionId: string | null
  title: string
  loading: false
  favicon: null
}

export interface BrowserContextUsageReportTab {
  kind: 'context-usage-report'
  id: string
  sessionId: string
  sessionTitle: string | null
  title: string
  loading: false
  favicon: null
}

export interface BrowserPanelLauncherTab {
  kind: 'launcher'
  id: string
  title: string
  loading: false
  favicon: null
}

export interface BrowserTuiTab {
  kind: 'tui'
  id: string
  ptyId: string
  cwd: string
  title: string
  loading: false
  favicon: null
}

export interface BrowserPlanDocumentTab {
  kind: 'plan-document'
  id: string
  sessionId: string | null
  toolCallId: string
  title: string
  text: string
  loading: false
  favicon: null
}

export interface BrowserPlanRefineTab {
  kind: 'plan-refine'
  id: string
  sessionId: string | null
  requestId: string
  title: string
  text: string
  loading: false
  favicon: null
}

/** Live workflow agent row (SSE runtime snapshot). */
export interface BrowserWorkflowRuntimeAgent {
  id: string
  label: string
  status: string
  phaseIndex: number | null
  startedAt: number | null
  completedAt: number | null
  model?: string | null
  lastToolName?: string | null
  totalTokens?: number | null
  toolUses?: number | null
}

export interface BrowserWorkflowRuntimePhase {
  index: number
  title: string
  detail?: string | null
  status: string
  agentCount: number
  completedAgentCount: number
  runningAgentCount: number
  failedAgentCount: number
}

export interface BrowserWorkflowRuntimeSnapshot {
  updatedAt: number
  workflow: {
    name?: string | null
    description?: string | null
    status?: string | null
    startedAt: number
    durationMs?: number | null
    result?: unknown
  }
  phases: BrowserWorkflowRuntimePhase[]
  currentPhase?: BrowserWorkflowRuntimePhase | null
  agents: BrowserWorkflowRuntimeAgent[]
}

export interface BrowserWorkflowSurfaceSnapshot {
  workflowName: string | null
  description: string | null
  status: string | null
  taskId: string | null
  taskType: string | null
  runId: string | null
  scriptPath: string | null
  transcriptDir: string | null
  sessionUrl: string | null
  warning: string | null
  error: string | null
  phases: { name: string, description?: string | null }[]
  input: unknown
  output: unknown
  lifecycle: unknown
  runtime: BrowserWorkflowRuntimeSnapshot | null
}

export interface BrowserWorkflowTab {
  kind: 'workflow'
  id: string
  sessionId: string | null
  toolCallId: string
  title: string
  surface: BrowserWorkflowSurfaceSnapshot
  loading: false
  favicon: null
}

export type BrowserPanelTab
  = | BrowserWebTab
    | BrowserWorkspaceFileTab
    | BrowserWorkspaceDiffTab
    | BrowserPullRequestTab
    | BrowserSubagentTab
    | BrowserWorkflowTab
    | BrowserSideConversationTab
    | BrowserContextUsageReportTab
    | BrowserPanelLauncherTab
    | BrowserTuiTab
    | BrowserPlanDocumentTab
    | BrowserPlanRefineTab
    | BrowserWorkflowTab

export const BROWSER_PANEL_TAB_KINDS = [
  'browser',
  'workspace-file',
  'workspace-diff',
  'pull-request',
  'subagent',
  'workflow',
  'side-conversation',
  'context-usage-report',
  'launcher',
  'tui',
  'plan-document',
  'plan-refine',
  'workflow',
] as const satisfies readonly BrowserPanelTab['kind'][]

export type BrowserPanelTabKind = (typeof BROWSER_PANEL_TAB_KINDS)[number]

const MULTI_INSTANCE_BROWSER_PANEL_TAB_KINDS: ReadonlySet<BrowserPanelTabKind> = new Set([
  'browser',
  'workspace-file',
  'pull-request',
  'subagent',
  'workflow',
  'side-conversation',
  'tui',
  'plan-document',
  'plan-refine',
  'workflow',
])

export const SINGLETON_BROWSER_PANEL_TAB_KINDS: ReadonlySet<BrowserPanelTabKind> = new Set(
  BROWSER_PANEL_TAB_KINDS.filter(kind => !MULTI_INSTANCE_BROWSER_PANEL_TAB_KINDS.has(kind)),
)

export function isSingletonBrowserPanelTabKind(kind: BrowserPanelTabKind): boolean {
  return SINGLETON_BROWSER_PANEL_TAB_KINDS.has(kind)
}

type RestorableBrowserPanelTab = Exclude<
  BrowserPanelTab,
  BrowserWebTab | BrowserPanelLauncherTab | BrowserTuiTab
>

interface PersistedBrowserPanelDockState {
  open: boolean
  panes: RestorableBrowserPanelTab[]
  activePaneId: string | null
}

const workspaceFileTabSchema = z.object({
  kind: z.literal('workspace-file'),
  id: z.string(),
  workspaceId: z.string(),
  path: z.string(),
  view: z.enum(['editor', 'preview']),
  title: z.string(),
  loading: z.literal(false),
  favicon: z.null(),
}) satisfies z.ZodType<BrowserWorkspaceFileTab>

const workspaceDiffTabSchema = z.object({
  kind: z.literal('workspace-diff'),
  id: z.string(),
  workspaceId: z.string(),
  repositoryPath: z.string().optional(),
  paths: z.array(z.string()).optional(),
  title: z.string(),
  loading: z.literal(false),
  favicon: z.null(),
}) satisfies z.ZodType<BrowserWorkspaceDiffTab>

const pullRequestTabSchema = z.object({
  kind: z.literal('pull-request'),
  id: z.string(),
  owner: z.string(),
  repo: z.string(),
  number: z.number(),
  workId: z.string().optional(),
  sessionId: z.string().optional(),
  title: z.string(),
  loading: z.literal(false),
  favicon: z.null(),
}) satisfies z.ZodType<BrowserPullRequestTab>

const subagentTabSchema = z.object({
  kind: z.literal('subagent'),
  id: z.string(),
  sessionId: z.string(),
  threadId: z.string(),
  agentName: z.string(),
  agentRole: z.string().nullable(),
  title: z.string(),
  loading: z.literal(false),
  favicon: z.null(),
}) satisfies z.ZodType<BrowserSubagentTab>

const workflowPhaseSchema = z.object({
  name: z.string(),
  description: z.string().nullable(),
})

const browserWorkflowRuntimeAgentSchema = z.object({
  id: z.string(),
  declarationId: z.string().nullable(),
  index: z.number().nullable(),
  label: z.string(),
  phaseIndex: z.number().nullable(),
  phaseTitle: z.string().nullable(),
  alignment: z.enum(['declared', 'unmatched', 'inferred', 'observed']),
  prompt: z.string().nullable(),
  status: z.enum(['pending', 'running', 'completed', 'failed', 'skipped']),
  model: z.string().nullable(),
  totalTokens: z.number().nullable(),
  toolUses: z.number(),
  lastToolName: z.string().nullable(),
  lastToolSummary: z.string().nullable(),
  queuedAt: z.number().nullable(),
  startedAt: z.number().nullable(),
  updatedAt: z.number().nullable(),
  completedAt: z.number().nullable(),
  durationMs: z.number().nullable(),
  attempt: z.number().nullable(),
  result: z.unknown(),
  resultPreview: z.string().nullable(),
}) satisfies z.ZodType<BrowserWorkflowRuntimeAgent>

const browserWorkflowRuntimePhaseSchema = z.object({
  index: z.number(),
  title: z.string(),
  detail: z.string().nullable(),
  status: z.enum(['pending', 'running', 'completed', 'failed']),
  agentCount: z.number(),
  completedAgentCount: z.number(),
  runningAgentCount: z.number(),
  failedAgentCount: z.number(),
}) satisfies z.ZodType<BrowserWorkflowRuntimePhase>

export const browserWorkflowRuntimeSnapshotSchema = z.object({
  type: z.literal('workflow-snapshot'),
  workflow: z.object({
    runId: z.string(),
    name: z.string().nullable(),
    description: z.string().nullable(),
    status: z.enum(['running', 'completed', 'failed', 'stopped']),
    startedAt: z.number(),
    durationMs: z.number().nullable(),
    result: z.unknown(),
    totalTokens: z.number().nullable(),
    totalToolCalls: z.number().nullable(),
    declarationIncomplete: z.boolean(),
  }),
  phases: z.array(browserWorkflowRuntimePhaseSchema),
  currentPhase: browserWorkflowRuntimePhaseSchema.nullable(),
  agents: z.array(browserWorkflowRuntimeAgentSchema),
  logs: z.array(z.string()),
  updatedAt: z.number(),
}) satisfies z.ZodType<BrowserWorkflowRuntimeSnapshot>

const browserWorkflowSurfaceSnapshotSchema = z.object({
  workflowName: z.string().nullable(),
  description: z.string().nullable(),
  status: z.string().nullable(),
  taskId: z.string().nullable(),
  taskType: z.string().nullable(),
  runId: z.string().nullable(),
  scriptPath: z.string().nullable(),
  transcriptDir: z.string().nullable(),
  sessionUrl: z.string().nullable(),
  warning: z.string().nullable(),
  error: z.string().nullable(),
  phases: z.array(workflowPhaseSchema),
  input: z.unknown(),
  output: z.unknown(),
  lifecycle: z.array(z.unknown()),
  runtime: browserWorkflowRuntimeSnapshotSchema.nullable(),
}) satisfies z.ZodType<BrowserWorkflowSurfaceSnapshot>

const workflowTabSchema = z.object({
  kind: z.literal('workflow'),
  id: z.string(),
  sessionId: z.string().nullable(),
  toolCallId: z.string(),
  title: z.string(),
  surface: browserWorkflowSurfaceSnapshotSchema,
  loading: z.literal(false),
  favicon: z.null(),
}) satisfies z.ZodType<BrowserWorkflowTab>

const sideConversationTabSchema = z.object({
  kind: z.literal('side-conversation'),
  id: z.string(),
  parentSessionId: z.string(),
  sideConversationId: z.string(),
  providerSessionId: z.string().nullable(),
  title: z.string(),
  loading: z.literal(false),
  favicon: z.null(),
}) satisfies z.ZodType<BrowserSideConversationTab>

const contextUsageReportTabSchema = z.object({
  kind: z.literal('context-usage-report'),
  id: z.string(),
  sessionId: z.string(),
  sessionTitle: z.string().nullable(),
  title: z.string(),
  loading: z.literal(false),
  favicon: z.null(),
}) satisfies z.ZodType<BrowserContextUsageReportTab>

const planDocumentTabSchema = z.object({
  kind: z.literal('plan-document'),
  id: z.string(),
  sessionId: z.string().nullable(),
  toolCallId: z.string(),
  title: z.string(),
  text: z.string(),
  loading: z.literal(false),
  favicon: z.null(),
}) satisfies z.ZodType<BrowserPlanDocumentTab>

const planRefineTabSchema = z.object({
  kind: z.literal('plan-refine'),
  id: z.string(),
  sessionId: z.string().nullable(),
  requestId: z.string(),
  title: z.string(),
  text: z.string(),
  loading: z.literal(false),
  favicon: z.null(),
}) satisfies z.ZodType<BrowserPlanRefineTab>

const workflowRuntimePhaseSchema = z.object({
  index: z.number(),
  title: z.string(),
  detail: z.string().nullable().optional(),
  status: z.string(),
  agentCount: z.number(),
  completedAgentCount: z.number(),
  runningAgentCount: z.number(),
  failedAgentCount: z.number(),
})

const workflowRuntimeAgentSchema = z.object({
  id: z.string(),
  label: z.string(),
  status: z.string(),
  phaseIndex: z.number().nullable(),
  startedAt: z.number().nullable(),
  completedAt: z.number().nullable(),
  model: z.string().nullable().optional(),
  lastToolName: z.string().nullable().optional(),
  totalTokens: z.number().nullable().optional(),
  toolUses: z.number().nullable().optional(),
})

export const browserWorkflowRuntimeSnapshotSchema = z.object({
  updatedAt: z.number(),
  workflow: z.object({
    name: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    status: z.string().nullable().optional(),
    startedAt: z.number(),
    durationMs: z.number().nullable().optional(),
    result: z.unknown().optional(),
  }),
  phases: z.array(workflowRuntimePhaseSchema),
  currentPhase: workflowRuntimePhaseSchema.nullable().optional(),
  agents: z.array(workflowRuntimeAgentSchema),
}) satisfies z.ZodType<BrowserWorkflowRuntimeSnapshot>

const workflowSurfaceSnapshotSchema = z.object({
  workflowName: z.string().nullable(),
  description: z.string().nullable(),
  status: z.string().nullable(),
  taskId: z.string().nullable(),
  taskType: z.string().nullable(),
  runId: z.string().nullable(),
  scriptPath: z.string().nullable(),
  transcriptDir: z.string().nullable(),
  sessionUrl: z.string().nullable(),
  warning: z.string().nullable(),
  error: z.string().nullable(),
  phases: z.array(z.object({
    name: z.string(),
    description: z.string().nullable().optional(),
  })),
  input: z.unknown(),
  output: z.unknown(),
  lifecycle: z.unknown(),
  runtime: browserWorkflowRuntimeSnapshotSchema.nullable(),
}) satisfies z.ZodType<BrowserWorkflowSurfaceSnapshot>

const workflowTabSchema = z.object({
  kind: z.literal('workflow'),
  id: z.string(),
  sessionId: z.string().nullable(),
  toolCallId: z.string(),
  title: z.string(),
  surface: workflowSurfaceSnapshotSchema,
  loading: z.literal(false),
  favicon: z.null(),
}) satisfies z.ZodType<BrowserWorkflowTab>

const restorableBrowserPanelTabSchema = z.discriminatedUnion('kind', [
  workspaceFileTabSchema,
  workspaceDiffTabSchema,
  pullRequestTabSchema,
  subagentTabSchema,
  workflowTabSchema,
  sideConversationTabSchema,
  contextUsageReportTabSchema,
  planDocumentTabSchema,
  planRefineTabSchema,
  workflowTabSchema,
]) satisfies z.ZodType<RestorableBrowserPanelTab>

const persistedBrowserPanelDockStateSchema = z.object({
  open: z.boolean(),
  panes: z.array(z.unknown()),
  activePaneId: z.string().nullable(),
})

function sanitizePersistedDockStateByOwnerId(
  value: unknown,
): Record<string, PersistedBrowserPanelDockState> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }

  const result: Record<string, PersistedBrowserPanelDockState> = {}
  for (const [ownerId, rawState] of Object.entries(value)) {
    const parsed = persistedBrowserPanelDockStateSchema.safeParse(rawState)
    if (!parsed.success) {
      continue
    }
    const panes = parsed.data.panes.flatMap((rawPane) => {
      const pane = restorableBrowserPanelTabSchema.safeParse(rawPane)
      return pane.success ? [pane.data] : []
    })
    const activePaneId = parsed.data.activePaneId
      && panes.some(pane => pane.id === parsed.data.activePaneId)
      ? parsed.data.activePaneId
      : (panes[0]?.id ?? null)
    result[ownerId] = {
      open: panes.length > 0 && parsed.data.open,
      panes,
      activePaneId,
    }
  }
  return result
}

export interface BrowserHistoryEntry {
  url: string
  title: string
  tabId: string
}

export interface BrowserAnnotationElementStyle {
  color: string
  backgroundColor: string
  opacity: string
  fontFamily: string
  fontSize: string
  fontWeight: string
  lineHeight: string
  borderRadius: string
  borderColor?: string
  borderWidth?: string
  display?: string
  alignItems?: string
  justifyContent?: string
  flexDirection?: string
  width?: string
  height?: string
  marginTop?: string
  marginRight?: string
  marginBottom?: string
  marginLeft?: string
  paddingTop?: string
  paddingRight?: string
  paddingBottom?: string
  paddingLeft?: string
  rowGap?: string
  columnGap?: string
}

export interface BrowserAnnotationElement {
  id: string
  tagName: string
  label: string
  description?: string
  role: string
  selector: string
  attributes?: {
    id?: string
    className?: string
    ariaLabel?: string
    title?: string
    alt?: string
    href?: string
    type?: string
    name?: string
    placeholder?: string
    value?: string
    testId?: string
  }
  rect: {
    x: number
    y: number
    width: number
    height: number
  }
  styles: BrowserAnnotationElementStyle
  pageUrl?: string
  nearbyText?: string
  reactComponents?: string | null
}

export interface BrowserAnnotationPoint {
  kind: 'point'
  x: number
  y: number
  scrollY?: number
}

export interface BrowserAnnotationRegion {
  kind: 'region'
  x: number
  y: number
  width: number
  height: number
  scrollY?: number
}

export interface BrowserAnnotationTextAnchor {
  kind: 'text'
  text: string
  x: number
  y: number
  width: number
  height: number
  scrollY?: number
}

export interface BrowserAnnotationElementAnchor {
  kind: 'element'
  element: BrowserAnnotationElement
}

export type BrowserAnnotationAnchor
  = | BrowserAnnotationPoint
    | BrowserAnnotationRegion
    | BrowserAnnotationTextAnchor
    | BrowserAnnotationElementAnchor

export type BrowserAnnotationLayoutHint
  = | {
      id: string
      kind: 'placement'
      componentType: string
      label: string
      x: number
      y: number
      width: number
      height: number
      scrollY: number
    }
    | {
      id: string
      kind: 'rearrange'
      selector: string
      label: string
      from: { x: number, y: number, width: number, height: number }
      to: { x: number, y: number, width: number, height: number }
      scrollY: number
    }

export interface BrowserAnnotationDesignChange {
  comment?: string
  color?: string
  backgroundColor?: string
  opacity?: string
  fontFamily?: string
  fontSize?: string
  fontWeight?: string
  borderRadius?: string
  borderColor?: string
  borderWidth?: string
  display?: string
  alignItems?: string
  justifyContent?: string
  flexDirection?: string
  width?: string
  height?: string
  marginTop?: string
  marginRight?: string
  marginBottom?: string
  marginLeft?: string
  paddingTop?: string
  paddingRight?: string
  paddingBottom?: string
  paddingLeft?: string
  rowGap?: string
  columnGap?: string
}

export interface BrowserAnnotationRecord {
  id: string
  ownerId: string
  tabId: string
  title: string
  url: string
  body: string
  anchor: BrowserAnnotationAnchor
  designChange: BrowserAnnotationDesignChange | null
  attachedImages: FileUIPart[]
  screenshot: FileUIPart
  elements: BrowserAnnotationElement[]
  surfaceSize: {
    width: number
    height: number
  }
  createdAt: number
  updatedAt: number
  status: 'saved' | 'sent'
}

export type BrowserAnnotationInteractionMode = 'browse' | 'comment'

export interface BrowserAnnotationAdjustmentSession {
  ownerId: string
  tabId: string
  annotationId: string | null
  selectedElement: BrowserAnnotationElement | null
  designChanges: BrowserAnnotationDesignChange
}

export interface BrowserPanelCloseTabResult {
  closed: boolean
  closedLastTab: boolean
}

interface BrowserPanelTabShortcutInput {
  key: string
  metaKey: boolean
  altKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
}

interface BrowserPanelOwnerState {
  open: boolean
  threadState: ThreadBrowserState | null
  tabs: BrowserPanelTab[]
  activeTabId: string | null
  requestedTab: {
    id: number
    url?: string
    sessionId?: string | null
    sessionTitle?: string | null
  } | null
  scrollToFilePath: { path: string, tabId: string, nonce: number } | null
  annotations: BrowserAnnotationRecord[]
  annotationLayoutHintsByTabId: Record<string, BrowserAnnotationLayoutHint[] | undefined>
}

interface BrowserPanelState {
  activeOwnerId: string
  owners: Record<string, BrowserPanelOwnerState | undefined>
  open: boolean
  tabs: BrowserPanelTab[]
  activeTabId: string | null
  requestedTab: BrowserPanelOwnerState['requestedTab']
  scrollToFilePath: BrowserPanelOwnerState['scrollToFilePath']
  recentHistoryByOwnerId: Record<string, BrowserHistoryEntry[] | undefined>
  annotationInteractionModeByOwnerId: Record<string, BrowserAnnotationInteractionMode | undefined>
  annotationTrayCollapsedByOwnerId: Record<string, boolean | undefined>
  annotationAdjustmentSession: BrowserAnnotationAdjustmentSession | null
  setActiveOwner: (ownerId: string | null | undefined) => void
  setDockOpen: (open: boolean, ownerId?: string | null) => void
  toggleDock: (ownerId?: string | null) => void
  upsertOwnerState: (state: ThreadBrowserState) => void
  releaseOwnerRuntimeState: (ownerId: string) => void
  removeOwnerState: (ownerId: string) => void
  requestTab: (url?: string, source?: BrowserTabSource, ownerId?: string | null) => void
  fulfillRequestedTab: (id: number, ownerId?: string | null) => void
  createTab: (url?: string, source?: BrowserTabSource, ownerId?: string | null) => string
  closeTab: (id: string, ownerId?: string | null) => BrowserPanelCloseTabResult
  setActiveTab: (id: string, ownerId?: string | null) => void
  updateTab: (id: string, updates: Partial<BrowserWebTab>, ownerId?: string | null) => void
  navigateTo: (id: string, url: string, ownerId?: string | null) => void
  setBrowserTabScripts: (id: string, scriptIds: string[], ownerId?: string | null) => void
  addBrowserTabCustomScript: (
    id: string,
    input: Omit<BrowserPanelCustomScript, 'id'>,
    ownerId?: string | null,
  ) => string
  openWorkspaceFileTab: (input: {
    workspaceId: string
    path: string
    view: 'editor' | 'preview'
    ownerId?: string | null
  }) => string
  openWorkspaceDiffTab: (input: {
    workspaceId: string
    repositoryPath?: string | null
    paths?: string[]
    title?: string
    ownerId?: string | null
  }) => string
  openPullRequestTab: (input: {
    owner: string
    repo: string
    number: number
    workId?: string
    sessionId?: string
    title: string
    ownerId?: string | null
  }) => string
  openSubagentTab: (input: {
    sessionId: string
    threadId: string
    agentName: string
    agentRole?: string | null
    ownerId?: string | null
  }) => string
  openWorkflowTab: (input: {
    sessionId?: string | null
    toolCallId: string
    title?: string
    surface: BrowserWorkflowSurfaceSnapshot
    ownerId?: string | null
  }) => string
  updateWorkflowTab: (input: {
    sessionId?: string | null
    toolCallId: string
    surface: BrowserWorkflowSurfaceSnapshot
    title?: string
    ownerId?: string | null
  }) => void
  openSideConversationTab: (input: {
    parentSessionId: string
    sideConversationId: string
    providerSessionId?: string | null
    title: string
    ownerId?: string | null
  }) => string
  openContextUsageReportTab: (input: {
    sessionId: string
    sessionTitle?: string | null
    ownerId?: string | null
  }) => string
  openLauncherTab: (ownerId?: string | null) => string
  openTuiTab: (input: {
    cwd: string
    title?: string
    ownerId?: string | null
  }) => string
  updateTuiTabTitle: (id: string, title: string, ownerId?: string | null) => void
  openPlanDocumentTab: (input: {
    sessionId?: string | null
    toolCallId: string
    title?: string
    text: string
    ownerId?: string | null
  }) => string
  openPlanRefineTab: (input: {
    sessionId?: string | null
    requestId: string
    title?: string
    text: string
    ownerId?: string | null
  }) => string
  openWorkflowTab: (input: {
    sessionId: string | null
    toolCallId: string
    title: string
    surface: BrowserWorkflowSurfaceSnapshot
    ownerId?: string | null
  }) => string
  updateWorkflowTab: (input: {
    sessionId: string | null
    toolCallId: string
    surface: BrowserWorkflowSurfaceSnapshot
    ownerId?: string | null
  }) => void
  requestScrollToFilePath: (input: { path: string, tabId: string }) => void
  clearScrollToFilePath: (ownerId?: string | null) => void
  saveAnnotation: (
    input: Omit<BrowserAnnotationRecord, 'id' | 'createdAt' | 'updatedAt' | 'status'> & {
      id?: string
      status?: BrowserAnnotationRecord['status']
    },
    ownerId?: string | null,
  ) => string
  markAnnotationSent: (id: string, ownerId?: string | null) => void
  deleteAnnotation: (id: string, ownerId?: string | null) => void
  clearAnnotations: (input?: { ownerId?: string | null, tabId?: string | null }) => void
  syncAnnotationLayoutHints: (
    input: { tabId: string, hints: BrowserAnnotationLayoutHint[] },
    ownerId?: string | null,
  ) => void
  setAnnotationInteractionMode: (
    mode: BrowserAnnotationInteractionMode,
    ownerId?: string | null,
  ) => void
  setAnnotationTrayCollapsed: (
    collapsed: boolean,
    ownerId?: string | null,
  ) => void
  setAnnotationAdjustmentSession: (session: BrowserAnnotationAdjustmentSession | null) => void
  updateAnnotationAdjustmentDesignChanges: (changes: Partial<BrowserAnnotationDesignChange>) => void
}

let localTabCounter = 0
let customScriptCounter = 0
let annotationCounter = 0

function normalizeBrowserPanelOwnerId(ownerId: string | null | undefined): string {
  return ownerId || DEFAULT_BROWSER_PANEL_OWNER_ID
}

function createEmptyThreadState(ownerId: string): ThreadBrowserState {
  return {
    threadId: ownerId,
    version: 0,
    open: false,
    activeTabId: null,
    tabs: [],
    lastError: null,
  }
}

function createEmptyOwnerState(ownerId: string): BrowserPanelOwnerState {
  return {
    open: false,
    threadState: createEmptyThreadState(ownerId),
    tabs: [],
    activeTabId: null,
    requestedTab: null,
    scrollToFilePath: null,
    annotations: [],
    annotationLayoutHintsByTabId: {},
  }
}

function toBrowserPanelTab(tab: BrowserTabState): BrowserWebTab {
  return {
    ...tab,
    kind: 'browser',
    sessionId: null,
    sessionTitle: null,
    scriptIds: [],
    customScripts: [],
    loading: tab.isLoading,
    favicon: tab.faviconUrl,
  }
}

function projectThreadState(
  state: ThreadBrowserState,
  previousOwnerState?: BrowserPanelOwnerState,
): BrowserPanelOwnerState {
  const nextBrowserTabsById = new Map(state.tabs.map(tab => [tab.id, toBrowserPanelTab(tab)]))
  const projectedTabs: BrowserPanelTab[] = []
  const seenBrowserTabIds = new Set<string>()

  for (const previousTab of previousOwnerState?.tabs ?? []) {
    if (previousTab.kind !== 'browser') {
      projectedTabs.push(previousTab)
      continue
    }

    const nextBrowserTab = nextBrowserTabsById.get(previousTab.id)
    if (!nextBrowserTab) {
      continue
    }

    seenBrowserTabIds.add(previousTab.id)
    projectedTabs.push({
      ...nextBrowserTab,
      sessionId: previousTab.sessionId,
      sessionTitle: previousTab.sessionTitle,
      scriptIds: previousTab.scriptIds,
      customScripts: previousTab.customScripts,
    })
  }

  for (const nextBrowserTab of nextBrowserTabsById.values()) {
    if (!seenBrowserTabIds.has(nextBrowserTab.id)) {
      projectedTabs.push(nextBrowserTab)
    }
  }

  const previousActiveTab = previousOwnerState?.tabs.find(
    tab => tab.id === previousOwnerState.activeTabId,
  )
  const previousActiveWorkspaceTab
    = previousActiveTab && previousActiveTab.kind !== 'browser' ? previousActiveTab : null
  const shouldKeepWorkspaceActiveTab = previousActiveWorkspaceTab !== null
    && projectedTabs.some(tab => tab.id === previousActiveWorkspaceTab.id)
  const nextBrowserTabIds = new Set(state.tabs.map(tab => tab.id))
  const projectedActiveTabId = projectedTabs.some(tab => tab.id === state.activeTabId)
    ? state.activeTabId
    : null

  return {
    open: previousOwnerState?.open ?? false,
    threadState: state,
    tabs: projectedTabs,
    activeTabId: shouldKeepWorkspaceActiveTab
      ? previousActiveWorkspaceTab.id
      : (projectedActiveTabId ?? projectedTabs.at(-1)?.id ?? null),
    requestedTab: null,
    scrollToFilePath: null,
    annotations: (previousOwnerState?.annotations ?? []).filter(annotation =>
      nextBrowserTabIds.has(annotation.tabId)),
    annotationLayoutHintsByTabId: Object.fromEntries(
      Object.entries(previousOwnerState?.annotationLayoutHintsByTabId ?? {})
        .filter(([tabId]) => nextBrowserTabIds.has(tabId)),
    ),
  }
}

function getOwnerState(state: BrowserPanelState, ownerId: string): BrowserPanelOwnerState {
  return state.owners[ownerId] ?? createEmptyOwnerState(ownerId)
}

function projectActiveOwner(ownerState: BrowserPanelOwnerState) {
  return {
    open: ownerState.open,
    tabs: ownerState.tabs,
    activeTabId: ownerState.activeTabId,
    requestedTab: ownerState.requestedTab,
    scrollToFilePath: ownerState.scrollToFilePath,
  }
}

function applyOwnerState(
  state: BrowserPanelState,
  ownerId: string,
  ownerState: BrowserPanelOwnerState,
): Partial<BrowserPanelState> {
  return {
    owners: {
      ...state.owners,
      [ownerId]: ownerState,
    },
    ...(state.activeOwnerId === ownerId ? projectActiveOwner(ownerState) : {}),
  }
}

function normalizeHistoryUrl(url: string): string {
  const trimmed = url.trim()
  return trimmed === 'about:blank' ? '' : trimmed
}

function upsertRecentHistoryEntry(
  entries: BrowserHistoryEntry[] | undefined,
  nextEntry: BrowserHistoryEntry,
): BrowserHistoryEntry[] {
  const normalizedUrl = normalizeHistoryUrl(nextEntry.url)
  if (!normalizedUrl) {
    return entries ?? []
  }

  const nextEntries = (entries ?? []).filter(
    entry => normalizeHistoryUrl(entry.url) !== normalizedUrl,
  )
  nextEntries.unshift({
    ...nextEntry,
    url: normalizedUrl,
  })
  return nextEntries.slice(0, BROWSER_HISTORY_LIMIT)
}

function buildHistoryFromState(
  previousHistory: BrowserHistoryEntry[] | undefined,
  state: ThreadBrowserState,
): BrowserHistoryEntry[] {
  const activeTab = state.tabs.find(tab => tab.id === state.activeTabId) ?? null
  const orderedTabs = activeTab
    ? [activeTab, ...state.tabs.filter(tab => tab.id !== activeTab.id)]
    : state.tabs

  return orderedTabs.reduce(
    (entries, tab) =>
      upsertRecentHistoryEntry(entries, {
        url: tab.lastCommittedUrl ?? tab.url,
        title: tab.title,
        tabId: tab.id,
      }),
    previousHistory ?? EMPTY_BROWSER_HISTORY,
  )
}

function createLocalBrowserTab(url = 'about:blank', source?: BrowserTabSource): BrowserWebTab {
  const id = `local-browser-${++localTabCounter}`
  return {
    kind: 'browser',
    id,
    sessionId: source?.sessionId ?? null,
    sessionTitle: source?.sessionTitle ?? null,
    scriptIds: [],
    customScripts: [],
    url,
    title: url === 'about:blank' ? 'New tab' : url,
    status: 'suspended',
    isLoading: false,
    loading: false,
    canGoBack: false,
    canGoForward: false,
    faviconUrl: null,
    favicon: null,
    lastCommittedUrl: null,
    lastError: null,
  }
}

function createLauncherTab(): BrowserPanelLauncherTab {
  return {
    kind: 'launcher',
    id: `browser-panel-launcher-${++localTabCounter}`,
    title: 'New Tab',
    loading: false,
    favicon: null,
  }
}

function createTuiTab(ownerId: string, input: { cwd: string, title?: string }): BrowserTuiTab {
  const index = ++localTabCounter
  return {
    kind: 'tui',
    id: `browser-tui-${index}`,
    ptyId: `browser-panel:${ownerId}:${index}`,
    cwd: input.cwd,
    title: input.title ?? 'Terminal',
    loading: false,
    favicon: null,
  }
}

function matchesMultiInstanceBrowserPanelTab(
  existing: BrowserPanelTab,
  incoming: BrowserPanelTab,
): boolean {
  if (existing.kind !== incoming.kind) {
    return false
  }

  switch (incoming.kind) {
    case 'browser':
    case 'tui':
      return false
    case 'workspace-file':
      return existing.kind === 'workspace-file'
        && existing.workspaceId === incoming.workspaceId
        && existing.path === incoming.path
        && existing.view === incoming.view
    case 'pull-request':
      return existing.kind === 'pull-request'
        && existing.owner === incoming.owner
        && existing.repo === incoming.repo
        && existing.number === incoming.number
    case 'subagent':
      return existing.kind === 'subagent'
        && existing.sessionId === incoming.sessionId
        && existing.threadId === incoming.threadId
    case 'workflow':
      return existing.kind === 'workflow'
        && existing.toolCallId === incoming.toolCallId
        && existing.sessionId === incoming.sessionId
    case 'side-conversation':
      return existing.kind === 'side-conversation'
        && existing.sideConversationId === incoming.sideConversationId
    case 'plan-document':
      return existing.kind === 'plan-document' && existing.toolCallId === incoming.toolCallId
    case 'plan-refine':
      return existing.kind === 'plan-refine' && existing.requestId === incoming.requestId
    case 'workspace-diff':
    case 'context-usage-report':
    case 'launcher':
      return false
  }
}

function mergeReopenedSingletonBrowserPanelTab(
  existing: BrowserPanelTab,
  incoming: BrowserPanelTab,
): BrowserPanelTab {
  const merged = { ...incoming, id: existing.id } as BrowserPanelTab
  return isEqual(existing, merged) ? existing : merged
}

const browserPanelDockPolicy = {
  isSingletonKind: isSingletonBrowserPanelTabKind,
  matchesMultiInstancePane: matchesMultiInstanceBrowserPanelTab,
  mergeReopenedSingleton: mergeReopenedSingletonBrowserPanelTab,
}

function openTabInOwnerState(
  ownerState: BrowserPanelOwnerState,
  tab: BrowserPanelTab,
): BrowserPanelOwnerState {
  const next = openPaneInState({
    open: ownerState.open,
    panes: ownerState.tabs,
    activePaneId: ownerState.activeTabId,
  }, tab, browserPanelDockPolicy)
  if (
    next.open === ownerState.open
    && next.panes === ownerState.tabs
    && next.activePaneId === ownerState.activeTabId
  ) {
    return ownerState
  }
  return {
    ...ownerState,
    open: next.open,
    tabs: next.panes,
    activeTabId: next.activePaneId,
  }
}

function isRestorableBrowserPanelTab(tab: BrowserPanelTab): tab is RestorableBrowserPanelTab {
  return tab.kind !== 'browser' && tab.kind !== 'launcher' && tab.kind !== 'tui'
}

function toPersistedDockState(ownerState: BrowserPanelOwnerState): PersistedBrowserPanelDockState | null {
  const panes = ownerState.tabs.filter(isRestorableBrowserPanelTab)
  if (panes.length === 0) {
    return null
  }
  return {
    open: ownerState.open,
    panes,
    activePaneId: ownerState.activeTabId && panes.some(pane => pane.id === ownerState.activeTabId)
      ? ownerState.activeTabId
      : (panes[0]?.id ?? null),
  }
}

function buildPersistedDockStateByOwnerId(
  owners: BrowserPanelState['owners'],
): Record<string, PersistedBrowserPanelDockState> {
  const result: Record<string, PersistedBrowserPanelDockState> = {}
  for (const [ownerId, ownerState] of Object.entries(owners)) {
    if (!ownerState) {
      continue
    }
    const persisted = toPersistedDockState(ownerState)
    if (persisted) {
      result[ownerId] = persisted
    }
  }
  return result
}

function createOwnerStateFromPersisted(
  ownerId: string,
  state: PersistedBrowserPanelDockState,
): BrowserPanelOwnerState {
  return {
    ...createEmptyOwnerState(ownerId),
    open: state.open,
    threadState: null,
    tabs: state.panes,
    activeTabId: state.activePaneId,
  }
}

function commitOpenTab(
  set: (update: (state: BrowserPanelState) => Partial<BrowserPanelState> | BrowserPanelState) => void,
  ownerId: string,
  tab: BrowserPanelTab,
): string {
  let openedTabId = tab.id
  set((state) => {
    const ownerState = getOwnerState(state, ownerId)
    const nextOwnerState = openTabInOwnerState(ownerState, tab)
    openedTabId = nextOwnerState.activeTabId ?? tab.id
    if (nextOwnerState === ownerState) {
      return state
    }
    return applyOwnerState(state, ownerId, nextOwnerState)
  })
  return openedTabId
}

function createBrowserPanelStore() {
  return create<BrowserPanelState>()(
    persist(
    (set, get) => ({
      activeOwnerId: DEFAULT_BROWSER_PANEL_OWNER_ID,
      owners: {},
      open: false,
      tabs: [],
      activeTabId: null,
      requestedTab: null,
      scrollToFilePath: null,
      recentHistoryByOwnerId: {},
      annotationInteractionModeByOwnerId: {},
      annotationTrayCollapsedByOwnerId: {},
      annotationAdjustmentSession: null,

      setActiveOwner: (ownerIdInput) => {
        const ownerId = normalizeBrowserPanelOwnerId(ownerIdInput)
        set((state) => {
          if (state.activeOwnerId === ownerId) {
            return state
          }
          return {
            activeOwnerId: ownerId,
            ...projectActiveOwner(getOwnerState(state, ownerId)),
          }
        })
      },

      setDockOpen: (open, ownerIdInput) => {
        const ownerId = normalizeBrowserPanelOwnerId(ownerIdInput ?? get().activeOwnerId)
        set((state) => {
          const ownerState = getOwnerState(state, ownerId)
          const next = setDockOpenInState({
            open: ownerState.open,
            panes: ownerState.tabs,
            activePaneId: ownerState.activeTabId,
          }, open)
          if (next.open === ownerState.open) {
            return state
          }
          return applyOwnerState(state, ownerId, { ...ownerState, open: next.open })
        })
      },

      toggleDock: (ownerIdInput) => {
        const ownerId = normalizeBrowserPanelOwnerId(ownerIdInput ?? get().activeOwnerId)
        const ownerState = getOwnerState(get(), ownerId)
        if (!ownerState.open && ownerState.tabs.length === 0) {
          get().openLauncherTab(ownerId)
          return
        }
        get().setDockOpen(!ownerState.open, ownerId)
      },

      upsertOwnerState: (threadState) => {
        set((state) => {
          const ownerId = normalizeBrowserPanelOwnerId(threadState.threadId)
          const previousOwnerState = state.owners[ownerId]
          if (
            previousOwnerState?.threadState
            && previousOwnerState.threadState.version >= threadState.version
          ) {
            return state
          }

          const ownerState = {
            ...projectThreadState(threadState, previousOwnerState),
            requestedTab: previousOwnerState?.requestedTab ?? null,
            scrollToFilePath: previousOwnerState?.scrollToFilePath ?? null,
          }
          return {
            ...applyOwnerState(state, ownerId, ownerState),
            recentHistoryByOwnerId: {
              ...state.recentHistoryByOwnerId,
              [ownerId]: buildHistoryFromState(state.recentHistoryByOwnerId[ownerId], threadState),
            },
          }
        })
      },

      removeOwnerState: (ownerIdInput) => {
        const ownerId = normalizeBrowserPanelOwnerId(ownerIdInput)
        set((state) => {
          if (!Object.hasOwn(state.owners, ownerId)) {
            return state
          }
          const owners = { ...state.owners }
          delete owners[ownerId]
          const nextOwnerState = createEmptyOwnerState(ownerId)
          return {
            owners,
            ...(state.activeOwnerId === ownerId ? projectActiveOwner(nextOwnerState) : {}),
          }
        })
      },

      releaseOwnerRuntimeState: (ownerIdInput) => {
        const ownerId = normalizeBrowserPanelOwnerId(ownerIdInput)
        set((state) => {
          const ownerState = state.owners[ownerId]
          if (!ownerState) {
            return state
          }
          const persisted = toPersistedDockState(ownerState)
          if (!persisted) {
            const owners = { ...state.owners }
            delete owners[ownerId]
            const empty = createEmptyOwnerState(ownerId)
            return {
              owners,
              ...(state.activeOwnerId === ownerId ? projectActiveOwner(empty) : {}),
            }
          }
          return applyOwnerState(
            state,
            ownerId,
            createOwnerStateFromPersisted(ownerId, persisted),
          )
        })
      },

      requestTab: (url, source, ownerIdInput) => {
        const ownerId = normalizeBrowserPanelOwnerId(ownerIdInput ?? get().activeOwnerId)
        set((state) => {
          const ownerState = getOwnerState(state, ownerId)
          return applyOwnerState(state, ownerId, {
            ...ownerState,
            // A pending native-tab request is itself dock content intent. Open
            // the host so its effects can fulfill the request, even before the
            // native browser snapshot supplies the concrete pane.
            open: true,
            requestedTab: {
              id: Date.now(),
              url,
              sessionId: source?.sessionId ?? null,
              sessionTitle: source?.sessionTitle ?? null,
            },
          })
        })
      },

      fulfillRequestedTab: (id, ownerIdInput) => {
        const ownerId = normalizeBrowserPanelOwnerId(ownerIdInput ?? get().activeOwnerId)
        set((state) => {
          const ownerState = getOwnerState(state, ownerId)
          if (ownerState.requestedTab?.id !== id) {
            return state
          }
          return applyOwnerState(state, ownerId, {
            ...ownerState,
            requestedTab: null,
          })
        })
      },

      createTab: (url, source, ownerIdInput) => {
        const ownerId = normalizeBrowserPanelOwnerId(ownerIdInput ?? get().activeOwnerId)
        const tab = createLocalBrowserTab(url, source)
        return commitOpenTab(set, ownerId, tab)
      },

      closeTab: (id, ownerIdInput) => {
        const ownerId = normalizeBrowserPanelOwnerId(ownerIdInput ?? get().activeOwnerId)
        let result: BrowserPanelCloseTabResult = { closed: false, closedLastTab: false }
        set((state) => {
          const ownerState = getOwnerState(state, ownerId)
          const closedIndex = ownerState.tabs.findIndex(tab => tab.id === id)
          if (closedIndex === -1) {
            return state
          }
          const next = closePaneInState({
            open: ownerState.open,
            panes: ownerState.tabs,
            activePaneId: ownerState.activeTabId,
          }, id)
          result = { closed: true, closedLastTab: next.panes.length === 0 }
          return applyOwnerState(state, ownerId, {
            ...ownerState,
            open: next.open,
            tabs: next.panes,
            annotations: ownerState.annotations.filter(annotation => annotation.tabId !== id),
            activeTabId: next.activePaneId,
          })
        })
        return result
      },

      setActiveTab: (id, ownerIdInput) => {
        const ownerId = normalizeBrowserPanelOwnerId(ownerIdInput ?? get().activeOwnerId)
        set((state) => {
          const ownerState = getOwnerState(state, ownerId)
          const next = setActivePaneInState({
            open: ownerState.open,
            panes: ownerState.tabs,
            activePaneId: ownerState.activeTabId,
          }, id)
          if (next.open === ownerState.open && next.activePaneId === ownerState.activeTabId) {
            return state
          }
          return applyOwnerState(state, ownerId, {
            ...ownerState,
            open: next.open,
            activeTabId: next.activePaneId,
          })
        })
      },

      updateTab: (id, updates, ownerIdInput) => {
        const ownerId = normalizeBrowserPanelOwnerId(ownerIdInput ?? get().activeOwnerId)
        set((state) => {
          const ownerState = getOwnerState(state, ownerId)
          return applyOwnerState(state, ownerId, {
            ...ownerState,
            tabs: ownerState.tabs.map(tab =>
              tab.id === id && tab.kind === 'browser'
                ? ({ ...tab, ...updates } satisfies BrowserWebTab)
                : tab),
          })
        })
      },

      navigateTo: (id, url, ownerIdInput) => {
        get().updateTab(id, { url }, ownerIdInput)
      },

      setBrowserTabScripts: (id, scriptIds, ownerIdInput) => {
        get().updateTab(id, { scriptIds }, ownerIdInput)
      },

      addBrowserTabCustomScript: (id, input, ownerIdInput) => {
        const scriptId = `custom-script-${++customScriptCounter}`
        const script = { ...input, id: scriptId }
        const ownerId = normalizeBrowserPanelOwnerId(ownerIdInput ?? get().activeOwnerId)
        set((state) => {
          const ownerState = getOwnerState(state, ownerId)
          return applyOwnerState(state, ownerId, {
            ...ownerState,
            tabs: ownerState.tabs.map(tab =>
              tab.id === id && tab.kind === 'browser'
                ? ({
                    ...tab,
                    customScripts: [...tab.customScripts, script],
                  } satisfies BrowserWebTab)
                : tab),
          })
        })
        return scriptId
      },

      openWorkspaceFileTab: ({ workspaceId, path, view, ownerId: ownerIdInput }) => {
        const ownerId = normalizeBrowserPanelOwnerId(ownerIdInput ?? get().activeOwnerId)
        const tab: BrowserWorkspaceFileTab = {
          kind: 'workspace-file',
          id: `legacy-workspace-file-${++localTabCounter}`,
          workspaceId,
          path,
          view,
          title: path.split('/').filter(Boolean).at(-1) ?? path,
          loading: false,
          favicon: null,
        }
        return commitOpenTab(set, ownerId, tab)
      },

      openWorkspaceDiffTab: ({ workspaceId, repositoryPath, paths, title, ownerId: ownerIdInput }) => {
        const ownerId = normalizeBrowserPanelOwnerId(ownerIdInput ?? get().activeOwnerId)
        const tab: BrowserWorkspaceDiffTab = {
          kind: 'workspace-diff',
          id: `legacy-workspace-diff-${++localTabCounter}`,
          workspaceId,
          repositoryPath: repositoryPath ?? undefined,
          paths,
          title:
            title
            ?? (paths?.length === 1
              ? (paths[0]?.split('/').filter(Boolean).at(-1) ?? 'Changes')
              : 'Changes'),
          loading: false,
          favicon: null,
        }
        return commitOpenTab(set, ownerId, tab)
      },

      openPullRequestTab: ({ owner, repo, number, workId, sessionId, title, ownerId: ownerIdInput }) => {
        const ownerId = normalizeBrowserPanelOwnerId(ownerIdInput ?? get().activeOwnerId)
        const tabId = `pull-request:${owner}/${repo}#${number}`
        const tab: BrowserPullRequestTab = {
          kind: 'pull-request',
          id: tabId,
          owner,
          repo,
          number,
          workId,
          sessionId,
          title,
          loading: false,
          favicon: null,
        }
        return commitOpenTab(set, ownerId, tab)
      },

      openSubagentTab: ({ sessionId, threadId, agentName, agentRole, ownerId: ownerIdInput }) => {
        const ownerId = normalizeBrowserPanelOwnerId(ownerIdInput ?? get().activeOwnerId)
        const tab: BrowserSubagentTab = {
          kind: 'subagent',
          id: `subagent-${threadId}-${++localTabCounter}`,
          sessionId,
          threadId,
          agentName,
          agentRole: agentRole ?? null,
          title: agentName,
          loading: false,
          favicon: null,
        }
        return commitOpenTab(set, ownerId, tab)
      },

      openWorkflowTab: ({ sessionId, toolCallId, title, surface, ownerId: ownerIdInput }) => {
        const ownerId = normalizeBrowserPanelOwnerId(ownerIdInput ?? get().activeOwnerId)
        const tabId = `workflow:${sessionId ?? 'local'}:${toolCallId}`
        const tab: BrowserWorkflowTab = {
          kind: 'workflow',
          id: tabId,
          sessionId: sessionId ?? null,
          toolCallId,
          title: title ?? surface.workflowName ?? 'Workflow',
          surface,
          loading: false,
          favicon: null,
        }
        return commitOpenTab(set, ownerId, tab)
      },

      updateWorkflowTab: ({ sessionId, toolCallId, surface, title, ownerId: ownerIdInput }) => {
        const ownerId = normalizeBrowserPanelOwnerId(ownerIdInput ?? get().activeOwnerId)
        const tabId = `workflow:${sessionId ?? 'local'}:${toolCallId}`
        set((state) => {
          const ownerState = getOwnerState(state, ownerId)
          let found = false
          const tabs = ownerState.tabs.map((tab) => {
            if (tab.kind !== 'workflow' || tab.toolCallId !== toolCallId) {
              return tab
            }
            if (sessionId != null && tab.sessionId != null && tab.sessionId !== sessionId) {
              return tab
            }
            found = true
            return {
              ...tab,
              sessionId: sessionId ?? tab.sessionId,
              title: title ?? surface.workflowName ?? tab.title,
              surface,
            }
          })
          if (!found) {
            return state
          }
          return applyOwnerState(state, ownerId, {
            ...ownerState,
            tabs,
          })
        })
        void tabId
      },

      openSideConversationTab: ({
        parentSessionId,
        sideConversationId,
        providerSessionId,
        title,
        ownerId: ownerIdInput,
      }) => {
        const ownerId = normalizeBrowserPanelOwnerId(ownerIdInput ?? get().activeOwnerId)
        const tab: BrowserSideConversationTab = {
          kind: 'side-conversation',
          id: `side:${sideConversationId}`,
          parentSessionId,
          sideConversationId,
          providerSessionId: providerSessionId ?? null,
          title,
          loading: false,
          favicon: null,
        }
        return commitOpenTab(set, ownerId, tab)
      },

      openContextUsageReportTab: ({ sessionId, sessionTitle, ownerId: ownerIdInput }) => {
        const ownerId = normalizeBrowserPanelOwnerId(ownerIdInput ?? get().activeOwnerId)
        const tab: BrowserContextUsageReportTab = {
          kind: 'context-usage-report',
          id: `context-usage-report:${sessionId}`,
          sessionId,
          sessionTitle: sessionTitle ?? null,
          title: 'Context Usage Report',
          loading: false,
          favicon: null,
        }
        return commitOpenTab(set, ownerId, tab)
      },

      openLauncherTab: (ownerIdInput) => {
        const ownerId = normalizeBrowserPanelOwnerId(ownerIdInput ?? get().activeOwnerId)
        const tab = createLauncherTab()
        return commitOpenTab(set, ownerId, tab)
      },

      openTuiTab: ({ cwd, title, ownerId: ownerIdInput }) => {
        const ownerId = normalizeBrowserPanelOwnerId(ownerIdInput ?? get().activeOwnerId)
        const tab = createTuiTab(ownerId, { cwd, title })
        return commitOpenTab(set, ownerId, tab)
      },

      updateTuiTabTitle: (id, title, ownerIdInput) => {
        const ownerId = normalizeBrowserPanelOwnerId(ownerIdInput ?? get().activeOwnerId)
        const trimmed = title.trim()
        if (!trimmed) {
          return
        }

        set((state) => {
          const ownerState = getOwnerState(state, ownerId)
          return applyOwnerState(state, ownerId, {
            ...ownerState,
            tabs: ownerState.tabs.map(tab =>
              tab.id === id && tab.kind === 'tui' && tab.title !== trimmed
                ? { ...tab, title: trimmed }
                : tab),
          })
        })
      },

      openPlanDocumentTab: ({ sessionId, toolCallId, title, text, ownerId: ownerIdInput }) => {
        const ownerId = normalizeBrowserPanelOwnerId(ownerIdInput ?? get().activeOwnerId)
        const tab: BrowserPlanDocumentTab = {
          kind: 'plan-document',
          id: `plan-document:${toolCallId}`,
          sessionId: sessionId ?? null,
          toolCallId,
          title: title ?? 'Plan document',
          text,
          loading: false,
          favicon: null,
        }
        return commitOpenTab(set, ownerId, tab)
      },

      openPlanRefineTab: ({ sessionId, requestId, title, text, ownerId: ownerIdInput }) => {
        const ownerId = normalizeBrowserPanelOwnerId(ownerIdInput ?? get().activeOwnerId)
        const tab: BrowserPlanRefineTab = {
          kind: 'plan-refine',
          id: `plan-refine:${requestId}`,
          sessionId: sessionId ?? null,
          requestId,
          title: title ?? 'Refine plan',
          text,
          loading: false,
          favicon: null,
        }
        return commitOpenTab(set, ownerId, tab)
      },

      openWorkflowTab: ({ sessionId, toolCallId, title, surface, ownerId: ownerIdInput }) => {
        const ownerId = normalizeBrowserPanelOwnerId(ownerIdInput ?? get().activeOwnerId)
        const tab: BrowserWorkflowTab = {
          kind: 'workflow',
          id: `workflow:${toolCallId}`,
          sessionId,
          toolCallId,
          title,
          surface,
          loading: false,
          favicon: null,
        }
        return commitOpenTab(set, ownerId, tab)
      },

      updateWorkflowTab: ({ sessionId, toolCallId, surface, ownerId: ownerIdInput }) => {
        const ownerId = normalizeBrowserPanelOwnerId(ownerIdInput ?? get().activeOwnerId)
        set((state) => {
          const ownerState = getOwnerState(state, ownerId)
          const tabId = `workflow:${toolCallId}`
          let found = false
          const tabs = ownerState.tabs.map((tab) => {
            if (tab.kind !== 'workflow' || tab.id !== tabId) {
              return tab
            }
            found = true
            return {
              ...tab,
              sessionId,
              surface,
            }
          })
          if (!found) {
            return state
          }
          return applyOwnerState(state, ownerId, {
            ...ownerState,
            tabs,
          })
        })
      },

      requestScrollToFilePath: ({ path, tabId }) => {
        set((state) => {
          const ownerEntry = Object.entries(state.owners).find(([, ownerState]) =>
            ownerState?.tabs.some(tab => tab.id === tabId))
          const ownerId = ownerEntry?.[0] ?? state.activeOwnerId
          const ownerState = ownerEntry?.[1] ?? getOwnerState(state, ownerId)
          return applyOwnerState(state, ownerId, {
            ...ownerState,
            scrollToFilePath: { path, tabId, nonce: Date.now() },
          })
        })
      },
      clearScrollToFilePath: (ownerIdInput) => {
        const ownerId = normalizeBrowserPanelOwnerId(ownerIdInput ?? get().activeOwnerId)
        set((state) => {
          const ownerState = getOwnerState(state, ownerId)
          return applyOwnerState(state, ownerId, {
            ...ownerState,
            scrollToFilePath: null,
          })
        })
      },
      saveAnnotation: (input, ownerIdInput) => {
        const ownerId = normalizeBrowserPanelOwnerId(ownerIdInput ?? input.ownerId ?? get().activeOwnerId)
        const id = input.id ?? `browser-annotation-${++annotationCounter}`
        const now = Date.now()
        set((state) => {
          const ownerState = getOwnerState(state, ownerId)
          const previous = ownerState.annotations.find(annotation => annotation.id === id)
          const nextAnnotation: BrowserAnnotationRecord = {
            ...input,
            id,
            ownerId,
            createdAt: previous?.createdAt ?? now,
            updatedAt: now,
            status: input.status ?? 'saved',
          }
          return applyOwnerState(state, ownerId, {
            ...ownerState,
            annotations: [
              nextAnnotation,
              ...ownerState.annotations.filter(annotation => annotation.id !== id),
            ],
          })
        })
        return id
      },
      markAnnotationSent: (id, ownerIdInput) => {
        const ownerId = normalizeBrowserPanelOwnerId(ownerIdInput ?? get().activeOwnerId)
        set((state) => {
          const ownerState = getOwnerState(state, ownerId)
          return applyOwnerState(state, ownerId, {
            ...ownerState,
            annotations: ownerState.annotations.map(annotation =>
              annotation.id === id
                ? { ...annotation, status: 'sent', updatedAt: Date.now() }
                : annotation),
          })
        })
      },
      deleteAnnotation: (id, ownerIdInput) => {
        const ownerId = normalizeBrowserPanelOwnerId(ownerIdInput ?? get().activeOwnerId)
        set((state) => {
          const ownerState = getOwnerState(state, ownerId)
          return applyOwnerState(state, ownerId, {
            ...ownerState,
            annotations: ownerState.annotations.filter(annotation => annotation.id !== id),
          })
        })
      },
      clearAnnotations: (input) => {
        const ownerId = normalizeBrowserPanelOwnerId(input?.ownerId ?? get().activeOwnerId)
        const tabId = input?.tabId ?? null
        set((state) => {
          const ownerState = getOwnerState(state, ownerId)
          const annotations = tabId
            ? ownerState.annotations.filter(annotation => annotation.tabId !== tabId)
            : []
          const annotationLayoutHintsByTabId = tabId
            ? {
                ...ownerState.annotationLayoutHintsByTabId,
                [tabId]: [],
              }
            : {}
          return applyOwnerState(state, ownerId, {
            ...ownerState,
            annotations,
            annotationLayoutHintsByTabId,
          })
        })
      },
      syncAnnotationLayoutHints: (input, ownerIdInput) => {
        const ownerId = normalizeBrowserPanelOwnerId(ownerIdInput ?? get().activeOwnerId)
        set((state) => {
          const ownerState = getOwnerState(state, ownerId)
          return applyOwnerState(state, ownerId, {
            ...ownerState,
            annotationLayoutHintsByTabId: {
              ...ownerState.annotationLayoutHintsByTabId,
              [input.tabId]: input.hints,
            },
          })
        })
      },
      setAnnotationInteractionMode: (mode, ownerIdInput) => {
        const ownerId = normalizeBrowserPanelOwnerId(ownerIdInput ?? get().activeOwnerId)
        set(state => ({
          annotationInteractionModeByOwnerId: {
            ...state.annotationInteractionModeByOwnerId,
            [ownerId]: mode,
          },
        }))
      },
      setAnnotationTrayCollapsed: (collapsed, ownerIdInput) => {
        const ownerId = normalizeBrowserPanelOwnerId(ownerIdInput ?? get().activeOwnerId)
        set(state => ({
          annotationTrayCollapsedByOwnerId: {
            ...state.annotationTrayCollapsedByOwnerId,
            [ownerId]: collapsed,
          },
        }))
      },
      setAnnotationAdjustmentSession: (session) => {
        set((state) => {
          if (state.annotationAdjustmentSession === session) {
            return state
          }
          return { annotationAdjustmentSession: session }
        })
      },
      updateAnnotationAdjustmentDesignChanges: (changes) => {
        set((state) => {
          if (!state.annotationAdjustmentSession) {
            return state
          }
          return {
            annotationAdjustmentSession: {
              ...state.annotationAdjustmentSession,
              designChanges: {
                ...state.annotationAdjustmentSession.designChanges,
                ...changes,
              },
            },
          }
        })
      },
    }),
    {
      name: BROWSER_PANEL_STORAGE_KEY,
      storage: persistStorage,
      version: BROWSER_PANEL_PERSIST_VERSION,
      migrate: persistedState => readBrowserPanelPersistedState(persistedState),
      partialize: state => ({
        recentHistoryByOwnerId: state.recentHistoryByOwnerId,
        annotationTrayCollapsedByOwnerId: state.annotationTrayCollapsedByOwnerId,
        dockStateByOwnerId: buildPersistedDockStateByOwnerId(state.owners),
      }),
      merge: (persisted, current) => {
        const restored = readBrowserPanelPersistedState(persisted)
        const owners = Object.fromEntries(
          Object.entries(restored.dockStateByOwnerId ?? {}).map(([ownerId, dockState]) => [
            ownerId,
            createOwnerStateFromPersisted(ownerId, dockState),
          ]),
        )
        const activeOwnerState = owners[current.activeOwnerId]
          ?? createEmptyOwnerState(current.activeOwnerId)
        return {
          ...current,
          recentHistoryByOwnerId: restored.recentHistoryByOwnerId ?? {},
          annotationTrayCollapsedByOwnerId: restored.annotationTrayCollapsedByOwnerId ?? {},
          owners,
          ...projectActiveOwner(activeOwnerState),
        }
      },
    },
    ),
  )
}

type BrowserPanelStore = ReturnType<typeof createBrowserPanelStore>

interface BrowserPanelStoreGlobal {
  __CRADLE_BROWSER_PANEL_STORE__?: BrowserPanelStore
}

function getBrowserPanelStore(): BrowserPanelStore {
  if (!import.meta.env.DEV) {
    return createBrowserPanelStore()
  }
  const globalStore = globalThis as typeof globalThis & BrowserPanelStoreGlobal
  globalStore.__CRADLE_BROWSER_PANEL_STORE__ ??= createBrowserPanelStore()
  return globalStore.__CRADLE_BROWSER_PANEL_STORE__
}

export const useBrowserPanelStore = getBrowserPanelStore()

function isBrowserPanelTabShortcutPayload(
  payload: unknown,
): payload is BrowserPanelTabShortcutInput {
  if (!payload || typeof payload !== 'object') {
    return false
  }

  const candidate = payload as Partial<BrowserPanelTabShortcutInput>
  return (
    typeof candidate.key === 'string'
    && typeof candidate.metaKey === 'boolean'
    && typeof candidate.altKey === 'boolean'
    && typeof candidate.ctrlKey === 'boolean'
    && typeof candidate.shiftKey === 'boolean'
  )
}

export function selectOwnerBrowserState(ownerId: string) {
  return (store: BrowserPanelState): ThreadBrowserState | null =>
    store.owners[normalizeBrowserPanelOwnerId(ownerId)]?.threadState ?? null
}

export function selectOwnerDockOpen(ownerId: string) {
  return (store: BrowserPanelState): boolean =>
    store.owners[normalizeBrowserPanelOwnerId(ownerId)]?.open ?? false
}

export function selectOwnerBrowserHistory(ownerId: string) {
  return (store: BrowserPanelState): BrowserHistoryEntry[] =>
    store.recentHistoryByOwnerId[normalizeBrowserPanelOwnerId(ownerId)] ?? EMPTY_BROWSER_HISTORY
}

export function selectOwnerBrowserAnnotations(ownerId: string) {
  return (store: BrowserPanelState): BrowserAnnotationRecord[] =>
    store.owners[normalizeBrowserPanelOwnerId(ownerId)]?.annotations ?? EMPTY_BROWSER_ANNOTATIONS
}

export function closeActiveBrowserPanelTab(options: {
  panelOpen: boolean
  ownerId?: string | null
  onCloseLastTab?: (ownerId: string) => void
}): boolean {
  if (!options.panelOpen) {
    return false
  }

  const state = useBrowserPanelStore.getState()
  const ownerId = normalizeBrowserPanelOwnerId(options.ownerId ?? state.activeOwnerId)
  const ownerState = getOwnerState(state, ownerId)
  const currentTab = ownerState.tabs.find(tab => tab.id === ownerState.activeTabId)
  if (!currentTab) {
    return false
  }

  const closeResult = state.closeTab(currentTab.id, ownerId)
  if (closeResult.closedLastTab) {
    options.onCloseLastTab?.(ownerId)
  }
  return true
}

export function handleBrowserPanelTabShortcutInput(
  input: BrowserPanelTabShortcutInput,
  options: {
    panelOpen: boolean
    ownerId?: string | null
    onCloseLastTab?: (ownerId: string) => void
  },
): boolean {
  if (!options.panelOpen) {
    return false
  }

  const isCommandOnly = input.metaKey && !input.altKey && !input.ctrlKey && !input.shiftKey
  if (!isCommandOnly) {
    return false
  }

  const key = input.key.toLowerCase()
  if (key === 'w') {
    return closeActiveBrowserPanelTab(options)
  }

  const state = useBrowserPanelStore.getState()
  const ownerId = normalizeBrowserPanelOwnerId(options.ownerId ?? state.activeOwnerId)
  const ownerState = getOwnerState(state, ownerId)
  const currentTab = ownerState.tabs.find(tab => tab.id === ownerState.activeTabId)
  if (!currentTab) {
    return false
  }

  if (!BROWSER_PANEL_TAB_SHORTCUT_KEYS.has(key)) {
    return false
  }

  const targetIndex = key === '0' ? 9 : Number.parseInt(key, 10) - 1
  const targetTab = ownerState.tabs[targetIndex]
  if (targetTab) {
    state.setActiveTab(targetTab.id, ownerId)
  }
  return true
}

export function handleBrowserPanelTabShortcutPayload(
  payload: unknown,
  options: {
    panelOpen: boolean
    ownerId?: string | null
    onCloseLastTab?: (ownerId: string) => void
  },
): boolean {
  if (!isBrowserPanelTabShortcutPayload(payload)) {
    return false
  }

  return handleBrowserPanelTabShortcutInput(payload, options)
}

export function handleBrowserPanelTabShortcut(
  event: KeyboardEvent,
  options: {
    panelOpen: boolean
    ownerId?: string | null
    onCloseLastTab?: (ownerId: string) => void
  },
): boolean {
  const handled = handleBrowserPanelTabShortcutInput(event, options)
  if (!handled) {
    return false
  }

  event.preventDefault()
  event.stopPropagation()
  event.stopImmediatePropagation()
  return true
}
