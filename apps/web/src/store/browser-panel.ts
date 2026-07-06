// FILE: browser-panel.ts
// Purpose: Caches owner-scoped native BrowserPanel metadata and browser history for renderer chrome.
// Layer: Renderer Zustand store
// Depends on: Zustand persistence, browser IPC state snapshots

import type { FileUIPart } from 'ai'
import { z } from 'zod'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import { persistStorage } from './persist-storage'

export const DEFAULT_BROWSER_PANEL_OWNER_ID = 'global'
export const BROWSER_PANEL_WEBVIEW_TAB_SHORTCUT_CHANNEL = 'browser-panel:webview-tab-shortcut'

const BROWSER_HISTORY_LIMIT = 12
const EMPTY_BROWSER_HISTORY: BrowserHistoryEntry[] = []
const EMPTY_BROWSER_ANNOTATIONS: BrowserAnnotationRecord[] = []
const BROWSER_PANEL_STORAGE_KEY = 'cradle:browser-panel:v2'
const BROWSER_PANEL_PERSIST_VERSION = 2
const BROWSER_PANEL_TAB_SHORTCUT_KEYS = new Set(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'])

interface BrowserPanelPersistedState {
  recentHistoryByOwnerId?: Record<string, BrowserHistoryEntry[]>
  annotationTrayCollapsedByOwnerId?: Record<string, boolean>
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
})

export function readBrowserPanelPersistedState(raw: unknown): BrowserPanelPersistedState {
  const parsedState = browserPanelPersistedStateSchema.safeParse(raw)
  if (!parsedState.success) {
    return {
      recentHistoryByOwnerId: {},
      annotationTrayCollapsedByOwnerId: {},
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

export type BrowserPanelTab
  = | BrowserWebTab
    | BrowserWorkspaceFileTab
    | BrowserWorkspaceDiffTab
    | BrowserSubagentTab
    | BrowserSideConversationTab
    | BrowserContextUsageReportTab
    | BrowserPanelLauncherTab
    | BrowserTuiTab
    | BrowserPlanDocumentTab
    | BrowserPlanRefineTab

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
  tabs: BrowserPanelTab[]
  activeTabId: string | null
  requestedTab: BrowserPanelOwnerState['requestedTab']
  scrollToFilePath: BrowserPanelOwnerState['scrollToFilePath']
  recentHistoryByOwnerId: Record<string, BrowserHistoryEntry[] | undefined>
  annotationInteractionModeByOwnerId: Record<string, BrowserAnnotationInteractionMode | undefined>
  annotationTrayCollapsedByOwnerId: Record<string, boolean | undefined>
  annotationAdjustmentSession: BrowserAnnotationAdjustmentSession | null
  setActiveOwner: (ownerId: string | null | undefined) => void
  upsertOwnerState: (state: ThreadBrowserState) => void
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
  openSubagentTab: (input: {
    sessionId: string
    threadId: string
    agentName: string
    agentRole?: string | null
    ownerId?: string | null
  }) => string
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

function arePathListsEqual(a: string[] | undefined, b: string[] | undefined): boolean {
  if (a === b) {
    return true
  }
  if (!a || !b || a.length !== b.length) {
    return false
  }
  return a.every((path, index) => path === b[index])
}

function createBrowserPanelStore() {
  return create<BrowserPanelState>()(
    persist(
    (set, get) => ({
      activeOwnerId: DEFAULT_BROWSER_PANEL_OWNER_ID,
      owners: {},
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

      requestTab: (url, source, ownerIdInput) => {
        const ownerId = normalizeBrowserPanelOwnerId(ownerIdInput ?? get().activeOwnerId)
        set((state) => {
          const ownerState = getOwnerState(state, ownerId)
          return applyOwnerState(state, ownerId, {
            ...ownerState,
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
        set((state) => {
          const ownerState = getOwnerState(state, ownerId)
          return applyOwnerState(state, ownerId, {
            ...ownerState,
            tabs: [...ownerState.tabs, tab],
            activeTabId: tab.id,
          })
        })
        return tab.id
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
          const tabs = ownerState.tabs.filter(tab => tab.id !== id)
          result = { closed: true, closedLastTab: tabs.length === 0 }
          const nextActiveTabId = ownerState.activeTabId === id
            ? (tabs[Math.max(0, closedIndex - 1)]?.id ?? null)
            : ownerState.activeTabId
          return applyOwnerState(state, ownerId, {
            ...ownerState,
            tabs,
            annotations: ownerState.annotations.filter(annotation => annotation.tabId !== id),
            activeTabId: nextActiveTabId && tabs.some(tab => tab.id === nextActiveTabId)
              ? nextActiveTabId
              : (tabs.at(-1)?.id ?? null),
          })
        })
        return result
      },

      setActiveTab: (id, ownerIdInput) => {
        const ownerId = normalizeBrowserPanelOwnerId(ownerIdInput ?? get().activeOwnerId)
        set((state) => {
          const ownerState = getOwnerState(state, ownerId)
          if (!ownerState.tabs.some(tab => tab.id === id)) {
            return state
          }
          return applyOwnerState(state, ownerId, { ...ownerState, activeTabId: id })
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
        const existing = getOwnerState(get(), ownerId).tabs.find(
          tab =>
            tab.kind === 'workspace-file'
            && tab.workspaceId === workspaceId
            && tab.path === path
            && tab.view === view,
        )
        if (existing) {
          get().setActiveTab(existing.id, ownerId)
          return existing.id
        }
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
        set((state) => {
          const ownerState = getOwnerState(state, ownerId)
          return applyOwnerState(state, ownerId, {
            ...ownerState,
            tabs: [...ownerState.tabs, tab],
            activeTabId: tab.id,
          })
        })
        return tab.id
      },

      openWorkspaceDiffTab: ({ workspaceId, repositoryPath, paths, title, ownerId: ownerIdInput }) => {
        const ownerId = normalizeBrowserPanelOwnerId(ownerIdInput ?? get().activeOwnerId)
        const ownerState = getOwnerState(get(), ownerId)
        const existing = ownerState.tabs.find(
          tab =>
            tab.kind === 'workspace-diff'
            && tab.workspaceId === workspaceId
            && tab.repositoryPath === (repositoryPath ?? undefined)
            && arePathListsEqual(tab.paths, paths),
        )
        if (existing) {
          if (ownerState.activeTabId !== existing.id) {
            get().setActiveTab(existing.id, ownerId)
          }
          return existing.id
        }
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
        set((state) => {
          const ownerState = getOwnerState(state, ownerId)
          return applyOwnerState(state, ownerId, {
            ...ownerState,
            tabs: [...ownerState.tabs, tab],
            activeTabId: tab.id,
          })
        })
        return tab.id
      },

      openSubagentTab: ({ sessionId, threadId, agentName, agentRole, ownerId: ownerIdInput }) => {
        const ownerId = normalizeBrowserPanelOwnerId(ownerIdInput ?? get().activeOwnerId)
        const existing = getOwnerState(get(), ownerId).tabs.find(
          tab => tab.kind === 'subagent' && tab.threadId === threadId && tab.sessionId === sessionId,
        )
        if (existing) {
          get().setActiveTab(existing.id, ownerId)
          return existing.id
        }
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
        set((state) => {
          const ownerState = getOwnerState(state, ownerId)
          return applyOwnerState(state, ownerId, {
            ...ownerState,
            tabs: [...ownerState.tabs, tab],
            activeTabId: tab.id,
          })
        })
        return tab.id
      },

      openSideConversationTab: ({
        parentSessionId,
        sideConversationId,
        providerSessionId,
        title,
        ownerId: ownerIdInput,
      }) => {
        const ownerId = normalizeBrowserPanelOwnerId(ownerIdInput ?? get().activeOwnerId)
        const ownerState = getOwnerState(get(), ownerId)
        const existing = ownerState.tabs.find(
          tab => tab.kind === 'side-conversation' && tab.sideConversationId === sideConversationId,
        )
        if (existing) {
          get().setActiveTab(existing.id, ownerId)
          return existing.id
        }
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
        set((state) => {
          const ownerState = getOwnerState(state, ownerId)
          return applyOwnerState(state, ownerId, {
            ...ownerState,
            tabs: [...ownerState.tabs, tab],
            activeTabId: tab.id,
          })
        })
        return tab.id
      },

      openContextUsageReportTab: ({ sessionId, sessionTitle, ownerId: ownerIdInput }) => {
        const ownerId = normalizeBrowserPanelOwnerId(ownerIdInput ?? get().activeOwnerId)
        const ownerState = getOwnerState(get(), ownerId)
        const existing = ownerState.tabs.find(
          tab => tab.kind === 'context-usage-report' && tab.sessionId === sessionId,
        )
        if (existing) {
          get().setActiveTab(existing.id, ownerId)
          return existing.id
        }
        const tab: BrowserContextUsageReportTab = {
          kind: 'context-usage-report',
          id: `context-usage-report:${sessionId}`,
          sessionId,
          sessionTitle: sessionTitle ?? null,
          title: 'Context Usage Report',
          loading: false,
          favicon: null,
        }
        set((state) => {
          const ownerState = getOwnerState(state, ownerId)
          return applyOwnerState(state, ownerId, {
            ...ownerState,
            tabs: [...ownerState.tabs, tab],
            activeTabId: tab.id,
          })
        })
        return tab.id
      },

      openLauncherTab: (ownerIdInput) => {
        const ownerId = normalizeBrowserPanelOwnerId(ownerIdInput ?? get().activeOwnerId)
        const tab = createLauncherTab()
        set((state) => {
          const ownerState = getOwnerState(state, ownerId)
          return applyOwnerState(state, ownerId, {
            ...ownerState,
            tabs: [...ownerState.tabs, tab],
            activeTabId: tab.id,
          })
        })
        return tab.id
      },

      openTuiTab: ({ cwd, title, ownerId: ownerIdInput }) => {
        const ownerId = normalizeBrowserPanelOwnerId(ownerIdInput ?? get().activeOwnerId)
        const tab = createTuiTab(ownerId, { cwd, title })
        set((state) => {
          const ownerState = getOwnerState(state, ownerId)
          return applyOwnerState(state, ownerId, {
            ...ownerState,
            tabs: [...ownerState.tabs, tab],
            activeTabId: tab.id,
          })
        })
        return tab.id
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
        const ownerState = getOwnerState(get(), ownerId)
        const existing = ownerState.tabs.find(
          tab => tab.kind === 'plan-document' && tab.toolCallId === toolCallId,
        )
        if (existing) {
          get().setActiveTab(existing.id, ownerId)
          return existing.id
        }
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
        set((state) => {
          const ownerState = getOwnerState(state, ownerId)
          return applyOwnerState(state, ownerId, {
            ...ownerState,
            tabs: [...ownerState.tabs, tab],
            activeTabId: tab.id,
          })
        })
        return tab.id
      },

      openPlanRefineTab: ({ sessionId, requestId, title, text, ownerId: ownerIdInput }) => {
        const ownerId = normalizeBrowserPanelOwnerId(ownerIdInput ?? get().activeOwnerId)
        const ownerState = getOwnerState(get(), ownerId)
        const existing = ownerState.tabs.find(
          tab => tab.kind === 'plan-refine' && tab.requestId === requestId,
        )
        if (existing) {
          get().setActiveTab(existing.id, ownerId)
          return existing.id
        }
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
        set((state) => {
          const ownerState = getOwnerState(state, ownerId)
          return applyOwnerState(state, ownerId, {
            ...ownerState,
            tabs: [...ownerState.tabs, tab],
            activeTabId: tab.id,
          })
        })
        return tab.id
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
      }),
      merge: (persisted, current) => ({
        ...current,
        ...readBrowserPanelPersistedState(persisted),
      }),
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

export function selectOwnerBrowserHistory(ownerId: string) {
  return (store: BrowserPanelState): BrowserHistoryEntry[] =>
    store.recentHistoryByOwnerId[normalizeBrowserPanelOwnerId(ownerId)] ?? EMPTY_BROWSER_HISTORY
}

export function selectOwnerBrowserAnnotations(ownerId: string) {
  return (store: BrowserPanelState): BrowserAnnotationRecord[] =>
    store.owners[normalizeBrowserPanelOwnerId(ownerId)]?.annotations ?? EMPTY_BROWSER_ANNOTATIONS
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

  const state = useBrowserPanelStore.getState()
  const ownerId = normalizeBrowserPanelOwnerId(options.ownerId ?? state.activeOwnerId)
  const ownerState = getOwnerState(state, ownerId)
  const currentTab = ownerState.tabs.find(tab => tab.id === ownerState.activeTabId)
  if (!currentTab) {
    return false
  }

  const key = input.key.toLowerCase()
  if (key === 'w') {
    const closeResult = state.closeTab(currentTab.id, ownerId)
    if (closeResult.closedLastTab) {
      options.onCloseLastTab?.(ownerId)
    }
    return true
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
