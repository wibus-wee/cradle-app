// FILE: browser-panel.tsx
// Purpose: Renders Cradle's BrowserPanel chrome and anchors the native Electron WebContentsView.
// Layer: Browser feature UI
// Depends on: BrowserPanel Zustand metadata cache, Electron browser preload bridge

import {
  ArrowLeftLine as ArrowLeftIcon,
  ArrowRightLine as ArrowRightIcon,
  CameraLine as CameraIcon,
  Chat1Line as MessageSquarePlusIcon,
  CloseLine as XIcon,
  Dashboard2Line as GaugeIcon,
  DeleteLine as Trash2Icon,
  ExternalLinkLine as ExternalLinkIcon,
  FileLine as FileTextIcon,
  GitCompareLine as FileDiffIcon,
  GitPullRequestLine as PullRequestIcon,
  GlobeLine as GlobeIcon,
  LayoutTopLine as PanelTopIcon,
  PencilLine as PencilIcon,
  PlusLine as PlusIcon,
  Refresh1Line as RefreshCwIcon,
  RobotLine as BotIcon,
  SendLine as SendIcon,
  ServerLine as ServerIcon,
  TerminalBoxLine as SquareTerminalIcon,
} from '@mingcute/react'
import type { FileUIPart } from 'ai'
import type { CSSProperties, FormEvent, KeyboardEvent as ReactKeyboardEvent } from 'react'
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '~/components/ui/button'
import { Empty, EmptyContent, EmptyHeader, EmptyMedia, EmptyTitle } from '~/components/ui/empty'
import { Input } from '~/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '~/components/ui/popover'
import { Spinner } from '~/components/ui/spinner'
import {
submitChatComposerContextIngress,
  submitChatComposerFileIngress,
  submitChatPromptIngress,
} from '~/features/chat/prompt-ingress'
import { PullRequestDetailPanel } from '~/features/pull-requests/pull-request-detail-panel'
import type { TerminalMetadata } from '~/features/tui/terminal-metadata'
import { WorkspaceFileEditor } from '~/features/workspace/workspace-file-editor'
import { WorkspaceFilePreview } from '~/features/workspace/workspace-file-preview'
import { cn } from '~/lib/cn'
import type {
  BrowserAnnotationAnchor,
  BrowserAnnotationDesignChange,
  BrowserAnnotationElement,
  BrowserAnnotationLayoutHint,
  BrowserAnnotationRecord,
  BrowserPanelTab,
  BrowserTabState,
  BrowserWebTab,
  ThreadBrowserState,
} from '~/store/browser-panel'
import {
  DEFAULT_BROWSER_PANEL_OWNER_ID,
  selectOwnerBrowserAnnotations,
  selectOwnerBrowserHistory,
  selectOwnerBrowserState,
  useBrowserPanelStore,
} from '~/store/browser-panel'
import { useLayoutStore } from '~/store/layout'

import { releaseSideConversation } from '../chat/commands/chat-response-command'
import type { BrowserAnnotationAdjustmentApplyDetail } from './browser-annotation-adjustment-panel'
import { BROWSER_ANNOTATION_ADJUSTMENT_APPLY_EVENT } from './browser-annotation-adjustment-panel'
import type { BrowserAddressSuggestion } from './browser-panel.logic'
import {
  browserAddressDisplayValue,
  buildBrowserAddressSuggestions,
  normalizeBrowserAddressInput,
  resolveBrowserAddressSync,
  resolveBrowserChromeStatus,
} from './browser-panel.logic'
import { ContextUsageReport } from './context-usage-report'
import {
  BROWSER_NATIVE_SURFACE_OCCLUSION_ATTRIBUTE,
  BROWSER_NATIVE_SURFACE_OCCLUSION_PROPS,
  BROWSER_NATIVE_SURFACE_OCCLUSION_SELECTOR,
} from './native-surface-occlusion'
import { useNativeBrowserSurfaceSuppressionStore } from './native-surface-suppression'
import { PlanDocumentViewer } from './plan-document-viewer'
import type { PlanRefineEditorDirtyDetail, PlanRefineEditorSaveDetail } from './plan-refine-editor'
import {
  PLAN_REFINE_EDITOR_DIRTY_EVENT,
  PLAN_REFINE_EDITOR_SAVE_EVENT,
  PlanRefineEditor,
} from './plan-refine-editor'
import { SideConversationPanel } from './side-conversation-panel'
import { SubagentOutputPanel } from './subagent-output-panel'
import type { BrowserLocalServer } from './use-local-servers'
import { useLocalServers } from './use-local-servers'
import { WorkflowOutputPanel } from './workflow-output-panel'
import { WorkspaceDiffViewer } from './workspace-diff-viewer'

interface BrowserPanelProps {
  ownerId?: string | null
  activeSessionId?: string | null
  activeSessionTitle?: string | null
  terminalCwd?: string | null
  nativeBoundsPaused?: boolean
  nativeSurfaceVisible?: boolean
  onCloseLastTab?: (ownerId: string) => void
}

type ChromeKey = keyof typeof import('~/locales/default').default.chrome

interface BrowserPromptAttachment {
  filename?: string
  mediaType?: string
  url: string
}

interface BrowserPromptRequest {
  threadId: string
  tabId: string
  text: string
  attachments: BrowserPromptAttachment[]
  sourceUrl: string | null
  sourceTitle: string | null
}

interface BrowserAnnotationRuntimeEvent {
  threadId: string
  tabId: string
  type:
    | 'ready'
    | 'selected-element'
    | 'save'
    | 'submit'
    | 'cancel'
    | 'closed'
    | 'toggle'
    | 'copy'
    | 'clear'
    | 'delete'
    | 'edit'
    | 'layout-sync'
  anchor?: BrowserAnnotationAnchor
  annotationId?: string
  runtimeAnnotationId?: string
  selectedElement?: BrowserAnnotationElement | null
  body?: string
  output?: string
  annotations?: Array<{
    id: string
    anchor: BrowserAnnotationAnchor
    body: string
    designChange?: BrowserAnnotationDesignChange | null
    status?: 'saved' | 'sent'
  }>
  layoutHints?: BrowserAnnotationLayoutHint[]
  attachedImages?: BrowserPromptAttachment[]
  designChange?: BrowserAnnotationDesignChange | null
  elements?: BrowserAnnotationElement[]
  surfaceSize?: {
    width: number
    height: number
  }
  sourceUrl: string | null
  sourceTitle: string | null
}

const BROWSER_BOUNDS_SYNC_STABLE_FRAME_TARGET = 1
const BROWSER_SCREENSHOT_CHUNK_SIZE = 0x8000
const BROWSER_NATIVE_OCCLUSION_MARGIN = 6
const BROWSER_NATIVE_OCCLUSION_MIN_SIZE = 32
const EMPTY_BROWSER_PANEL_TABS: BrowserPanelTab[] = []
const EMPTY_BROWSER_ANNOTATION_LAYOUT_HINTS: BrowserAnnotationLayoutHint[] = []
const EMPTY_BROWSER_ANNOTATION_LAYOUT_HINTS_BY_TAB_ID: Record<
  string,
  BrowserAnnotationLayoutHint[] | undefined
> = {}

function loadBrowserTuiShellView() {
  return import('~/features/tui/shell-view').then(module => ({ default: module.ShellView }))
}

const BrowserTuiShellView = lazy(loadBrowserTuiShellView)

interface BrowserAnnotationRuntimeSession {
  tabId: string
  editingAnnotationId: string | null
}

interface BrowserAnnotationCropRect {
  x: number
  y: number
  width: number
  height: number
}

interface BrowserNativeBounds {
  x: number
  y: number
  width: number
  height: number
}

interface BrowserWebviewElement extends HTMLElement {
  getWebContentsId?: () => number
}

const BROWSER_RENDERER_OBSCURING_OVERLAY_SELECTOR = [
  '[data-slot="popover-content"]',
  '[data-slot="dropdown-menu-content"]',
  '[data-slot="context-menu-content"]',
  '[data-slot="hover-card-content"]',
  '[data-slot="select-content"]',
  '[data-slot="command-dialog-content"]',
  '[data-slot="dialog-content"]',
  '[data-slot="alert-dialog-content"]',
  '[role="dialog"][aria-modal="true"]',
].join(', ')

function readBrowserBridge() {
  return window.cradle?.browser ?? null
}

function normalizeBrowserNativeBounds(rect: DOMRect): BrowserNativeBounds | null {
  const width = Math.max(0, Math.floor(rect.width))
  const height = Math.max(0, Math.floor(rect.height))
  if (width === 0 || height === 0) {
    return null
  }

  return {
    x: Math.max(0, Math.floor(rect.x)),
    y: Math.max(0, Math.floor(rect.y)),
    width,
    height,
  }
}

function browserNativeBoundsFromEdges(input: {
  left: number
  top: number
  right: number
  bottom: number
}): BrowserNativeBounds | null {
  const x = Math.max(0, Math.floor(input.left))
  const y = Math.max(0, Math.floor(input.top))
  const right = Math.max(x, Math.ceil(input.right))
  const bottom = Math.max(y, Math.ceil(input.bottom))
  const width = right - x
  const height = bottom - y

  if (width < BROWSER_NATIVE_OCCLUSION_MIN_SIZE || height < BROWSER_NATIVE_OCCLUSION_MIN_SIZE) {
    return null
  }

  return { x, y, width, height }
}

function browserNativeBoundsSignature(bounds: BrowserNativeBounds | null): string {
  if (!bounds) {
    return 'hidden'
  }
  return `${bounds.x}:${bounds.y}:${bounds.width}:${bounds.height}`
}

function rectsIntersect(
  a: { left: number, top: number, right: number, bottom: number },
  b: { left: number, top: number, right: number, bottom: number },
): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
}

function setBrowserWebviewOccluded(webview: BrowserWebviewElement | null, occluded: boolean): void {
  if (!webview) {
    return
  }
  webview.style.visibility = occluded ? 'hidden' : 'visible'
  webview.style.pointerEvents = occluded ? 'none' : 'auto'
}

function hasRendererBrowserObscuringOverlay(viewportRect: DOMRect): boolean {
  if (typeof document === 'undefined') {
    return false
  }
  const overlays = document.querySelectorAll<HTMLElement>(
    BROWSER_RENDERER_OBSCURING_OVERLAY_SELECTOR,
  )
  for (const overlay of overlays) {
    const styles = window.getComputedStyle(overlay)
    if (styles.display === 'none' || styles.visibility === 'hidden' || styles.opacity === '0') {
      continue
    }
    for (const overlayRect of overlay.getClientRects()) {
      if (rectsIntersect(viewportRect, overlayRect)) {
        return true
      }
    }
  }
  return false
}

function applyBrowserNativeSurfaceOcclusions(
  bounds: BrowserNativeBounds,
  viewportRect: DOMRect,
): BrowserNativeBounds | null {
  if (typeof document === 'undefined') {
    return bounds
  }

  const left = bounds.x
  let top = bounds.y
  const right = bounds.x + bounds.width
  let bottom = bounds.y + bounds.height
  const viewportCenterY = bounds.y + bounds.height / 2
  const occluders = document.querySelectorAll<HTMLElement>(
    BROWSER_NATIVE_SURFACE_OCCLUSION_SELECTOR,
  )

  for (const occluder of occluders) {
    const rect = occluder.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) {
      continue
    }

    const expandedRect = {
      left: rect.left - BROWSER_NATIVE_OCCLUSION_MARGIN,
      top: rect.top - BROWSER_NATIVE_OCCLUSION_MARGIN,
      right: rect.right + BROWSER_NATIVE_OCCLUSION_MARGIN,
      bottom: rect.bottom + BROWSER_NATIVE_OCCLUSION_MARGIN,
    }

    if (!rectsIntersect(viewportRect, expandedRect)) {
      continue
    }

    if ((expandedRect.top + expandedRect.bottom) / 2 >= viewportCenterY) {
      bottom = Math.min(bottom, expandedRect.top)
      continue
    }

    top = Math.max(top, expandedRect.bottom)
  }

  return browserNativeBoundsFromEdges({ left, top, right, bottom })
}

function formatBrowserActionError(error: unknown): string | null {
  if (!(error instanceof Error)) {
    return 'Browser action failed.'
  }
  if (/ERR_ABORTED|\(-3\)/i.test(error.message)) {
    return null
  }
  return error.message || 'Browser action failed.'
}

function getTabTitle(tab: BrowserTabState): string {
  if (tab.title && tab.title !== 'about:blank') {
    return tab.title
  }
  if (tab.url === 'about:blank') {
    return 'New tab'
  }
  return tab.url
}

function getPanelTabTitle(tab: BrowserPanelTab): string {
  if (tab.kind === 'browser') {
    return getTabTitle(tab)
  }
  return tab.title
}

function isBrowserPanelTab(tab: BrowserPanelTab): tab is BrowserWebTab {
  return tab.kind === 'browser'
}

function isPlanRefineEditorDirtyEvent(
  event: Event,
): event is CustomEvent<PlanRefineEditorDirtyDetail> {
  return (
    event instanceof CustomEvent
    && typeof event.detail === 'object'
    && event.detail !== null
    && typeof (event.detail as Partial<PlanRefineEditorDirtyDetail>).tabId === 'string'
    && typeof (event.detail as Partial<PlanRefineEditorDirtyDetail>).dirty === 'boolean'
  )
}

function isPlanRefineEditorSaveEvent(
  event: Event,
): event is CustomEvent<PlanRefineEditorSaveDetail> {
  return (
    event instanceof CustomEvent
    && typeof event.detail === 'object'
    && event.detail !== null
    && typeof (event.detail as Partial<PlanRefineEditorSaveDetail>).tabId === 'string'
    && typeof (event.detail as Partial<PlanRefineEditorSaveDetail>).markdown === 'string'
  )
}

function isBrowserBlankTab(tab: BrowserWebTab | null): boolean {
  return (tab?.url.trim() ?? '') === 'about:blank'
}

function localServerStatusLabel(statusCode: number | null): string {
  if (statusCode === null) {
    return 'HTTP'
  }
  if (statusCode >= 200 && statusCode < 300) {
    return 'Ready'
  }
  if (statusCode >= 300 && statusCode < 400) {
    return `${statusCode} redirect`
  }
  return `${statusCode}`
}

interface BrowserNewTabSurfaceProps {
  localServers: BrowserLocalServer[]
  localServersLoading: boolean
  localServersError: string | null
  onOpenUrl: (url: string) => void
  onRefreshLocalServers: () => void
}

const BrowserNewTabSurface = ({
  localServers,
  localServersLoading,
  localServersError,
  onOpenUrl,
  onRefreshLocalServers,
}: BrowserNewTabSurfaceProps) => {
  const localServerCountLabel = localServersLoading
    ? 'Scanning'
    : `${localServers.length} local ${localServers.length === 1 ? 'server' : 'servers'}`

  return (
    <div className="absolute inset-0 overflow-auto bg-background text-foreground">
      <div className="mx-auto flex min-h-full w-full max-w-2xl flex-col px-5 py-10">
        <div className="mb-6 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-medium text-foreground">New tab</h2>
            <p className="mt-1 truncate text-xs text-muted-foreground">{localServerCountLabel}</p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 shrink-0 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
            onClick={onRefreshLocalServers}
            disabled={localServersLoading}
            aria-label="Refresh local servers"
          >
            <RefreshCwIcon className={cn('size-3.5', localServersLoading && 'animate-spin')} />
          </Button>
        </div>

        <div className="grid overflow-hidden rounded-lg border border-border/60 bg-muted/20">
          {localServers.map(server => (
            <Button
              key={server.url}
              type="button"
              variant="ghost"
              className="group h-auto min-h-14 w-full min-w-0 justify-start gap-3 rounded-none border-b border-border/50 px-3 py-2 text-left font-normal whitespace-normal last:border-b-0 hover:bg-muted/50"
              onClick={() => onOpenUrl(server.url)}
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-background text-muted-foreground ring-1 ring-border/60">
                <ServerIcon className="size-4" aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium text-foreground">
                  {server.title}
                </span>
                <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                  {`localhost:${server.port}`}
                </span>
              </span>
              <span className="shrink-0 rounded-md bg-background px-2 py-1 text-[10px] font-medium text-muted-foreground tabular-nums ring-1 ring-border/60">
                {localServerStatusLabel(server.statusCode)}
              </span>
              <ExternalLinkIcon className="size-3.5 shrink-0 !text-muted-foreground transition-colors group-hover:!text-foreground" />
            </Button>
          ))}
        </div>

        {!localServersLoading && localServers.length === 0 && (
          <div className="rounded-lg border border-dashed border-border/70 bg-muted/20 px-4 py-8 text-center text-xs text-muted-foreground">
            {localServersError ?? 'No local servers found.'}
          </div>
        )}

        {localServersLoading && localServers.length === 0 && (
          <div className="rounded-lg border border-border/60 bg-muted/20 px-4 py-8 text-center text-xs text-muted-foreground">
            Scanning localhost.
          </div>
        )}
      </div>
    </div>
  )
}

interface BrowserPanelCreateSurfaceProps {
  canCreateTui: boolean
  browserPending: boolean
  onCreateBrowser: () => void
  onCreateTui: () => void
}

function BrowserPanelCreateSurface({
  canCreateTui,
  browserPending,
  onCreateBrowser,
  onCreateTui,
}: BrowserPanelCreateSurfaceProps) {
  return (
    <Empty className="absolute inset-0 rounded-none border-0 bg-background">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <PanelTopIcon className="size-4" aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle>New Tab</EmptyTitle>
      </EmptyHeader>
      <EmptyContent className="grid max-w-xs grid-cols-2 gap-2">
        <Button
          type="button"
          variant="outline"
          className="h-20 flex-col gap-2 whitespace-normal px-3 py-3 text-xs"
          onClick={onCreateBrowser}
          disabled={browserPending}
          aria-label="Create browser tab"
        >
          {browserPending ? <Spinner className="size-4" /> : <GlobeIcon className="size-4" />}
          <span>Browser</span>
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-20 flex-col gap-2 whitespace-normal px-3 py-3 text-xs"
          onClick={onCreateTui}
          disabled={!canCreateTui}
          aria-label="Create terminal tab"
          title={canCreateTui ? 'Terminal' : 'Open a workspace to create a terminal.'}
        >
          <SquareTerminalIcon className="size-4" />
          <span>Terminal</span>
        </Button>
      </EmptyContent>
    </Empty>
  )
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += BROWSER_SCREENSHOT_CHUNK_SIZE) {
    const chunk = bytes.subarray(offset, offset + BROWSER_SCREENSHOT_CHUNK_SIZE)
    binary += String.fromCharCode(...chunk)
  }
  return window.btoa(binary)
}

function createBrowserScreenshotFilePart(input: {
  name: string
  mimeType: 'image/png'
  bytes: Uint8Array
}): FileUIPart {
  return {
    type: 'file',
    filename: input.name,
    mediaType: input.mimeType,
    url: `data:${input.mimeType};base64,${bytesToBase64(input.bytes)}`,
  }
}

function createBrowserDataUrlFilePart(input: {
  name: string
  mimeType: 'image/png'
  dataUrl: string
}): FileUIPart {
  return {
    type: 'file',
    filename: input.name,
    mediaType: input.mimeType,
    url: input.dataUrl,
  }
}

function createBrowserBase64FilePart(input: {
  name: string
  mimeType: 'image/png'
  base64: string
}): FileUIPart {
  return createBrowserDataUrlFilePart({
    name: input.name,
    mimeType: input.mimeType,
    dataUrl: `data:${input.mimeType};base64,${input.base64}`,
  })
}

function inferBrowserPromptMediaType(url: string): string {
  const dataUrlMatch = /^data:([^;,]+)[;,]/i.exec(url)
  if (dataUrlMatch?.[1]) {
    return dataUrlMatch[1]
  }

  const normalizedUrl = url.toLowerCase()
  if (/\.(png)(?:[?#].*)?$/.test(normalizedUrl)) {
    return 'image/png'
  }
  if (/\.(jpe?g)(?:[?#].*)?$/.test(normalizedUrl)) {
    return 'image/jpeg'
  }
  if (/\.(webp)(?:[?#].*)?$/.test(normalizedUrl)) {
    return 'image/webp'
  }
  if (/\.(gif)(?:[?#].*)?$/.test(normalizedUrl)) {
    return 'image/gif'
  }
  if (/\.(pdf)(?:[?#].*)?$/.test(normalizedUrl)) {
    return 'application/pdf'
  }
  return 'application/octet-stream'
}

function createBrowserPromptFilePart(
  attachment: BrowserPromptAttachment,
  index: number,
): FileUIPart | null {
  const url = attachment.url.trim()
  if (!url) {
    return null
  }

  const filename = attachment.filename?.trim() || `browser-prompt-attachment-${index + 1}`
  const mediaType = attachment.mediaType?.trim() || inferBrowserPromptMediaType(url)
  return {
    type: 'file',
    filename,
    mediaType,
    url,
  }
}

function isBrowserPromptAttachment(value: unknown): value is BrowserPromptAttachment {
  return Boolean(
    value
    && typeof value === 'object'
    && typeof (value as BrowserPromptAttachment).url === 'string'
    && ((value as BrowserPromptAttachment).filename === undefined
      || typeof (value as BrowserPromptAttachment).filename === 'string')
    && ((value as BrowserPromptAttachment).mediaType === undefined
      || typeof (value as BrowserPromptAttachment).mediaType === 'string'),
  )
}

function isBrowserPromptRequest(value: unknown): value is BrowserPromptRequest {
  if (!value || typeof value !== 'object') {
    return false
  }
  const candidate = value as BrowserPromptRequest
  return (
    typeof candidate.threadId === 'string'
    && typeof candidate.tabId === 'string'
    && typeof candidate.text === 'string'
    && Array.isArray(candidate.attachments)
    && candidate.attachments.every(isBrowserPromptAttachment)
  )
}

function isBrowserAnnotationRuntimeEvent(value: unknown): value is BrowserAnnotationRuntimeEvent {
  if (!value || typeof value !== 'object') {
    return false
  }
  const candidate = value as BrowserAnnotationRuntimeEvent
  return (
    typeof candidate.threadId === 'string'
    && typeof candidate.tabId === 'string'
    && (candidate.type === 'ready'
      || candidate.type === 'selected-element'
      || candidate.type === 'save'
      || candidate.type === 'submit'
      || candidate.type === 'cancel'
      || candidate.type === 'closed'
      || candidate.type === 'toggle'
      || candidate.type === 'copy'
      || candidate.type === 'clear'
      || candidate.type === 'delete'
      || candidate.type === 'edit'
      || candidate.type === 'layout-sync')
  )
}

function isBrowserAnnotationAdjustmentApplyEvent(
  event: Event,
): event is CustomEvent<BrowserAnnotationAdjustmentApplyDetail> {
  if (!(event instanceof CustomEvent)) {
    return false
  }
  const detail = event.detail
  return Boolean(
    detail
    && typeof detail === 'object'
    && typeof (detail as BrowserAnnotationAdjustmentApplyDetail).ownerId === 'string'
    && typeof (detail as BrowserAnnotationAdjustmentApplyDetail).tabId === 'string',
  )
}

function toBrowserAnnotationRuntimeAnnotation(annotation: BrowserAnnotationRecord) {
  return {
    id: annotation.id,
    anchor: annotation.anchor,
    body: annotation.body,
    designChange: annotation.designChange,
    status: annotation.status,
  }
}

function screenshotFileNameForBrowserAnnotationUrl(url: string): string {
  try {
    const parsed = new URL(url)
    const host = parsed.hostname.replace(/[^a-z0-9.-]+/gi, '-').replace(/^-+|-+$/g, '')
    return `${host || 'browser'}-annotation.png`
  }
 catch {
    return 'browser-annotation.png'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object'
}

function readCdpScreenshotData(result: unknown): string | null {
  if (!isRecord(result) || typeof result.data !== 'string' || result.data.length === 0) {
    return null
  }
  return result.data
}

async function captureBrowserAnnotationScreenshot(input: {
  bridge: NonNullable<ReturnType<typeof readBrowserBridge>>
  threadId: string
  tabId: string
  url: string
}): Promise<FileUIPart> {
  try {
    const screenshot = await input.bridge.captureScreenshot({
      threadId: input.threadId,
      tabId: input.tabId,
    })
    return createBrowserScreenshotFilePart({
      name: screenshot.name,
      mimeType: screenshot.mimeType,
      bytes: screenshot.bytes,
    })
  }
 catch {
    const result = await input.bridge.executeCdp({
      threadId: input.threadId,
      tabId: input.tabId,
      method: 'Page.captureScreenshot',
      params: {
        format: 'png',
        captureBeyondViewport: false,
        fromSurface: true,
      },
    })
    const data = readCdpScreenshotData(result)
    if (!data) {
      throw new Error('Couldn\'t capture a browser screenshot.')
    }
    return createBrowserBase64FilePart({
      name: screenshotFileNameForBrowserAnnotationUrl(input.url),
      mimeType: 'image/png',
      base64: data,
    })
  }
}

function formatBrowserAnnotationAnchor(anchor: BrowserAnnotationAnchor): string {
  if (anchor.kind === 'point') {
    return `point (${Math.round(anchor.x)}, ${Math.round(anchor.y)})`
  }
  if (anchor.kind === 'element') {
    const rect = anchor.element.rect
    return `element <${anchor.element.tagName.toLowerCase()}> (${Math.round(rect.x)}, ${Math.round(rect.y)}, ${Math.round(rect.width)} x ${Math.round(rect.height)})`
  }
  if (anchor.kind === 'text') {
    return `text "${anchor.text.slice(0, 96)}${anchor.text.length > 96 ? '...' : ''}" (${Math.round(anchor.x)}, ${Math.round(anchor.y)}, ${Math.round(anchor.width)} x ${Math.round(anchor.height)})`
  }
  return `region (${Math.round(anchor.x)}, ${Math.round(anchor.y)}, ${Math.round(anchor.width)} x ${Math.round(anchor.height)})`
}

function getBrowserAnnotationCropRect(
  anchor: BrowserAnnotationAnchor,
): BrowserAnnotationCropRect | null {
  if (anchor.kind === 'point') {
    return null
  }
  if (anchor.kind === 'element') {
    return anchor.element.rect
  }
  if (anchor.kind === 'text') {
    return {
      x: anchor.x,
      y: anchor.y,
      width: anchor.width,
      height: anchor.height,
    }
  }
  return {
    x: anchor.x,
    y: anchor.y,
    width: anchor.width,
    height: anchor.height,
  }
}

async function createBrowserAnnotationCropFilePart(input: {
  imageDataUrl: string
  cropRect: BrowserAnnotationCropRect
  surfaceSize: { width: number, height: number }
}): Promise<FileUIPart | null> {
  if (
    input.cropRect.width <= 0
    || input.cropRect.height <= 0
    || input.surfaceSize.width <= 0
    || input.surfaceSize.height <= 0
  ) {
    return null
  }

  const image = new Image()
  const loaded = new Promise<void>((resolve, reject) => {
    image.onload = () => resolve()
    image.onerror = () => reject(new Error('Browser annotation crop image failed to load.'))
  })
  image.src = input.imageDataUrl
  await loaded

  const scaleX = image.naturalWidth / input.surfaceSize.width
  const scaleY = image.naturalHeight / input.surfaceSize.height
  const sourceX = Math.max(0, Math.floor(input.cropRect.x * scaleX))
  const sourceY = Math.max(0, Math.floor(input.cropRect.y * scaleY))
  const sourceWidth = Math.min(
    image.naturalWidth - sourceX,
    Math.max(1, Math.ceil(input.cropRect.width * scaleX)),
  )
  const sourceHeight = Math.min(
    image.naturalHeight - sourceY,
    Math.max(1, Math.ceil(input.cropRect.height * scaleY)),
  )

  const canvas = document.createElement('canvas')
  canvas.width = sourceWidth
  canvas.height = sourceHeight
  const context = canvas.getContext('2d')
  if (!context) {
    return null
  }
  context.drawImage(
    image,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    0,
    0,
    sourceWidth,
    sourceHeight,
  )

  return createBrowserDataUrlFilePart({
    name: 'browser-annotation-target.png',
    mimeType: 'image/png',
    dataUrl: canvas.toDataURL('image/png'),
  })
}

function formatBrowserAnnotationElementDetails(anchor: BrowserAnnotationAnchor): string[] {
  if (anchor.kind === 'text') {
    return [`Selected text: "${anchor.text}"`]
  }
  if (anchor.kind !== 'element') {
    return []
  }
  const element = anchor.element
  return [
    `Element selector: ${element.selector}`,
    element.reactComponents ? `React components: ${element.reactComponents}` : null,
    element.label ? `Element text: ${element.label}` : null,
    element.description ? `Element description: ${element.description}` : null,
    element.role ? `Element role: ${element.role}` : null,
    element.attributes?.testId ? `Element test id: ${element.attributes.testId}` : null,
    element.attributes?.href ? `Element href: ${element.attributes.href}` : null,
    element.attributes?.placeholder
      ? `Element placeholder: ${element.attributes.placeholder}`
      : null,
    'Element styles:',
    `- color: ${element.styles.color}`,
    `- background: ${element.styles.backgroundColor}`,
    `- opacity: ${element.styles.opacity}`,
    `- font: ${element.styles.fontFamily}`,
    `- font-size: ${element.styles.fontSize}`,
    `- font-weight: ${element.styles.fontWeight}`,
    `- line-height: ${element.styles.lineHeight}`,
    `- border-radius: ${element.styles.borderRadius}`,
    element.styles.borderColor ? `- border-color: ${element.styles.borderColor}` : null,
    element.styles.borderWidth ? `- border-width: ${element.styles.borderWidth}` : null,
    element.styles.display ? `- display: ${element.styles.display}` : null,
    element.styles.alignItems ? `- align-items: ${element.styles.alignItems}` : null,
    element.styles.justifyContent ? `- justify-content: ${element.styles.justifyContent}` : null,
    element.styles.flexDirection ? `- flex-direction: ${element.styles.flexDirection}` : null,
    element.styles.width ? `- width: ${element.styles.width}` : null,
    element.styles.height ? `- height: ${element.styles.height}` : null,
    element.styles.marginTop ? `- margin-top: ${element.styles.marginTop}` : null,
    element.styles.marginRight ? `- margin-right: ${element.styles.marginRight}` : null,
    element.styles.marginBottom ? `- margin-bottom: ${element.styles.marginBottom}` : null,
    element.styles.marginLeft ? `- margin-left: ${element.styles.marginLeft}` : null,
    element.styles.paddingTop ? `- padding-top: ${element.styles.paddingTop}` : null,
    element.styles.paddingRight ? `- padding-right: ${element.styles.paddingRight}` : null,
    element.styles.paddingBottom ? `- padding-bottom: ${element.styles.paddingBottom}` : null,
    element.styles.paddingLeft ? `- padding-left: ${element.styles.paddingLeft}` : null,
    element.styles.rowGap ? `- row-gap: ${element.styles.rowGap}` : null,
    element.styles.columnGap ? `- column-gap: ${element.styles.columnGap}` : null,
  ].filter(line => line !== null)
}

function formatBrowserAnnotationDesignChange(
  designChange: BrowserAnnotationDesignChange | null,
): string[] {
  if (!designChange) {
    return []
  }

  const rows = [
    ['color', designChange.color],
    ['background', designChange.backgroundColor],
    ['opacity', designChange.opacity],
    ['font', designChange.fontFamily],
    ['font-size', designChange.fontSize],
    ['font-weight', designChange.fontWeight],
    ['border-radius', designChange.borderRadius],
    ['border-color', designChange.borderColor],
    ['border-width', designChange.borderWidth],
    ['display', designChange.display],
    ['align-items', designChange.alignItems],
    ['justify-content', designChange.justifyContent],
    ['flex-direction', designChange.flexDirection],
    ['width', designChange.width],
    ['height', designChange.height],
    ['margin-top', designChange.marginTop],
    ['margin-right', designChange.marginRight],
    ['margin-bottom', designChange.marginBottom],
    ['margin-left', designChange.marginLeft],
    ['padding-top', designChange.paddingTop],
    ['padding-right', designChange.paddingRight],
    ['padding-bottom', designChange.paddingBottom],
    ['padding-left', designChange.paddingLeft],
    ['row-gap', designChange.rowGap],
    ['column-gap', designChange.columnGap],
    ['comment', designChange.comment],
  ]
    .filter(([, value]) => Boolean(value))
    .map(([label, value]) => `- ${label}: ${value}`)

  return rows.length > 0 ? ['Requested design changes:', ...rows] : []
}

function formatBrowserAnnotationSummary(annotation: BrowserAnnotationRecord): string {
  if (annotation.body) {
    return annotation.body
  }
  if (annotation.designChange) {
    return 'Design change'
  }
  if (annotation.attachedImages.length > 0) {
    return `${annotation.attachedImages.length} attached image${annotation.attachedImages.length === 1 ? '' : 's'}`
  }
  return formatBrowserAnnotationAnchor(annotation.anchor)
}

function countBrowserAnnotationDesignChanges(
  designChange: BrowserAnnotationDesignChange | null,
): number {
  if (!designChange) {
    return 0
  }
  return Object.values(designChange).filter(value => Boolean(value?.trim())).length
}

function hasBrowserAnnotationDesignChanges(
  designChange: BrowserAnnotationDesignChange | null | undefined,
): boolean {
  return countBrowserAnnotationDesignChanges(designChange ?? null) > 0
}

function getBrowserAnnotationPreviewTarget(
  annotation: BrowserAnnotationRecord,
): { style: CSSProperties, mode: 'point' | 'rect' } | null {
  const { width, height } = annotation.surfaceSize
  if (width <= 0 || height <= 0) {
    return null
  }
  if (annotation.anchor.kind === 'point') {
    return {
      mode: 'point',
      style: {
        left: `${(annotation.anchor.x / width) * 100}%`,
        top: `${(annotation.anchor.y / height) * 100}%`,
      },
    }
  }

  const rect
    = annotation.anchor.kind === 'element' ? annotation.anchor.element.rect : annotation.anchor
  return {
    mode: 'rect',
    style: {
      left: `${(rect.x / width) * 100}%`,
      top: `${(rect.y / height) * 100}%`,
      width: `${(rect.width / width) * 100}%`,
      height: `${(rect.height / height) * 100}%`,
    },
  }
}

function createBrowserAnnotationPrompt(input: {
  body: string
  anchor: BrowserAnnotationAnchor
  attachedImageCount: number
  designChange: BrowserAnnotationDesignChange | null
  includesTargetCrop: boolean
  title: string
  url: string
  surfaceSize: { width: number, height: number }
}): string {
  return [
    `Browser annotation on "${input.title}".`,
    `URL: ${input.url}`,
    `Viewport: ${Math.round(input.surfaceSize.width)} x ${Math.round(input.surfaceSize.height)} px`,
    `Target: ${formatBrowserAnnotationAnchor(input.anchor)}`,
    input.includesTargetCrop
      ? 'Attached screenshots: full viewport and target crop'
      : 'Attached screenshots: full viewport',
    input.attachedImageCount > 0 ? `Additional attached images: ${input.attachedImageCount}` : null,
    ...formatBrowserAnnotationElementDetails(input.anchor),
    ...formatBrowserAnnotationDesignChange(input.designChange),
    '',
    input.body,
  ]
    .filter(line => line !== null)
    .join('\n')
}

interface BrowserAnnotationRailProps {
  annotations: BrowserAnnotationRecord[]
  collapsed: boolean
  onCollapsedChange: (collapsed: boolean) => void
  onClear: () => void
  onEdit: (annotation: BrowserAnnotationRecord) => void
  onDelete: (annotationId: string) => void
  onSend: (annotation: BrowserAnnotationRecord) => void
}

function BrowserAnnotationRail({
  annotations,
  collapsed,
  onCollapsedChange,
  onClear,
  onEdit,
  onDelete,
  onSend,
}: BrowserAnnotationRailProps) {
  if (annotations.length === 0) {
    return null
  }

  if (collapsed) {
    return (
      <div
        {...BROWSER_NATIVE_SURFACE_OCCLUSION_PROPS}
        className="absolute right-3 top-3 z-20 flex max-h-[calc(100%-1.5rem)] items-start justify-end"
      >
        <Button
          type="button"
          size="icon"
          className="relative size-10 animate-[browser-annotation-popup-enter_200ms_cubic-bezier(0.34,1.56,0.64,1)_both] rounded-full bg-primary text-primary-foreground shadow-[0_10px_34px_rgba(0,0,0,0.16),inset_0_0_0_1px_rgba(0,0,0,0.04)] backdrop-blur-md hover:scale-105 hover:bg-primary/90 active:scale-[0.96] motion-reduce:animate-none dark:shadow-[0_12px_40px_rgba(0,0,0,0.45),inset_0_0_0_1px_rgba(255,255,255,0.12)]"
          onClick={() => onCollapsedChange(false)}
          aria-label={`Show ${annotations.length} browser annotations`}
          aria-expanded="false"
        >
          <MessageSquarePlusIcon className="size-4" />
          <span className="absolute -right-1 -top-1 flex min-w-5 items-center justify-center rounded-full bg-background px-1.5 text-[10px] font-medium text-primary tabular-nums shadow-sm ring-2 ring-primary">
            {annotations.length}
          </span>
        </Button>
      </div>
    )
  }

  return (
    <div
      {...BROWSER_NATIVE_SURFACE_OCCLUSION_PROPS}
      className="absolute right-3 top-3 z-20 flex max-h-[calc(100%-1.5rem)] items-start justify-end"
    >
      <div className="flex max-h-full w-72 origin-top-right animate-[browser-annotation-popup-enter_200ms_cubic-bezier(0.34,1.56,0.64,1)_both] flex-col overflow-hidden rounded-2xl bg-popover/95 text-popover-foreground shadow-[0_4px_24px_rgba(0,0,0,0.18),0_0_0_1px_rgba(0,0,0,0.06)] backdrop-blur-md motion-reduce:animate-none dark:bg-[#1a1a1a]/95 dark:shadow-[0_4px_24px_rgba(0,0,0,0.34),0_0_0_1px_rgba(255,255,255,0.08)]">
        <div className="flex h-10 shrink-0 items-center justify-between gap-2 px-2">
          <Button
            type="button"
            variant="ghost"
            className="h-auto min-w-0 justify-start gap-2 rounded-md px-2 py-1 text-left text-xs text-popover-foreground hover:bg-foreground/5"
            onClick={() => onCollapsedChange(true)}
            aria-label="Collapse browser annotations"
            aria-expanded="true"
          >
            <MessageSquarePlusIcon className="size-3.5 shrink-0 !text-primary" />
            <span className="truncate">Annotations</span>
            <span className="rounded bg-foreground/7 px-1.5 py-0.5 text-[10px] text-muted-foreground tabular-nums">
              {annotations.length}
            </span>
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground"
            onClick={onClear}
            title="Clear all browser annotations"
            aria-label="Clear all browser annotations"
          >
            <Trash2Icon className="size-3.5" />
          </Button>
        </div>
        <div className="min-h-0 overflow-y-auto px-1.5 pb-1.5">
          {annotations.map((annotation, index) => {
            const previewTarget = getBrowserAnnotationPreviewTarget(annotation)
            const designChangeCount = countBrowserAnnotationDesignChanges(annotation.designChange)
            return (
              <div
                key={annotation.id}
                className="group mb-1.5 grid grid-cols-[44px_minmax(0,1fr)] gap-2 rounded-lg p-1.5 transition-[background-color,scale] duration-150 ease-out last:mb-0 hover:bg-foreground/5 active:scale-[0.99]"
              >
                <div className="relative h-11 overflow-hidden rounded-md bg-muted ring-1 ring-border/60">
                  <img
                    src={annotation.screenshot.url}
                    alt=""
                    className="size-full object-cover"
                    draggable={false}
                  />
                  <div className="absolute inset-0 bg-black/5" aria-hidden="true" />
                  {previewTarget?.mode === 'rect' && (
                    <span
                      className="absolute rounded-[2px] border border-primary bg-primary/15 shadow-[0_0_0_1px_rgba(255,255,255,0.45)]"
                      style={previewTarget.style}
                      aria-hidden="true"
                    />
                  )}
                  {previewTarget?.mode === 'point' && (
                    <span
                      className="absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary shadow-[0_0_0_2px_rgba(255,255,255,0.7)]"
                      style={previewTarget.style}
                      aria-hidden="true"
                    />
                  )}
                  <span
                    className="absolute left-3 top-3 flex size-5 -translate-x-1/2 -translate-y-1/2 animate-[browser-annotation-marker-in_250ms_cubic-bezier(0.22,1,0.36,1)_both] items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground shadow-[0_2px_6px_rgba(0,0,0,0.20),inset_0_0_0_1px_rgba(0,0,0,0.04)] motion-reduce:animate-none"
                    style={{ animationDelay: `${index * 20}ms` }}
                    aria-hidden="true"
                  >
                    {index + 1}
                  </span>
                </div>
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-popover-foreground">
                      {formatBrowserAnnotationAnchor(annotation.anchor)}
                    </span>
                    <span
                      className={cn(
                        'shrink-0 rounded px-1.5 py-0.5 text-[10px] tabular-nums',
                        annotation.status === 'sent'
                          ? 'bg-primary/10 text-primary'
                          : 'bg-foreground/7 text-muted-foreground',
                      )}
                    >
                      {annotation.status}
                    </span>
                  </div>
                  <div className="mt-0.5 line-clamp-2 text-[11px] leading-4 text-muted-foreground">
                    {formatBrowserAnnotationSummary(annotation)}
                  </div>
                  <div className="mt-1.5 flex items-center justify-between gap-1">
                    <span className="truncate text-[10px] text-muted-foreground/80">
                      {designChangeCount > 0
                        ? `${designChangeCount} ${designChangeCount === 1 ? 'adjustment' : 'adjustments'}`
                        : 'Browser note'}
                    </span>
                    <span className="flex shrink-0 items-center gap-0.5">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="size-6 rounded-md text-muted-foreground hover:text-foreground"
                        onClick={() => onEdit(annotation)}
                        title="Edit browser annotation"
                        aria-label="Edit browser annotation"
                      >
                        <PencilIcon className="size-3" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="size-6 rounded-md text-muted-foreground hover:text-foreground"
                        onClick={() => onDelete(annotation.id)}
                        title="Delete browser annotation"
                        aria-label="Delete browser annotation"
                      >
                        <Trash2Icon className="size-3" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="size-6 rounded-md text-muted-foreground hover:text-foreground"
                        onClick={() => onSend(annotation)}
                        title={
                          annotation.status === 'sent'
                            ? 'Resend browser annotation'
                            : 'Send browser annotation'
                        }
                        aria-label={
                          annotation.status === 'sent'
                            ? 'Resend browser annotation'
                            : 'Send browser annotation'
                        }
                      >
                        <SendIcon className="size-3" />
                      </Button>
                    </span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export function BrowserPanel({
  ownerId = null,
  activeSessionId = null,
  activeSessionTitle = null,
  terminalCwd = null,
  nativeBoundsPaused = false,
  nativeSurfaceVisible = true,
  onCloseLastTab,
}: BrowserPanelProps) {
  const { t } = useTranslation('chrome')
  const resolvedOwnerId = ownerId ?? DEFAULT_BROWSER_PANEL_OWNER_ID
  const selectBrowserState = selectOwnerBrowserState(resolvedOwnerId)
  const selectBrowserHistory = selectOwnerBrowserHistory(resolvedOwnerId)
  const selectBrowserAnnotations = selectOwnerBrowserAnnotations(resolvedOwnerId)
  const browserState = useBrowserPanelStore(selectBrowserState)
  const nativeSurfaceSuppressCount = useNativeBrowserSurfaceSuppressionStore(
    state => state.suppressCount,
  )
  const recentHistory = useBrowserPanelStore(selectBrowserHistory)
  const requestedTab = useBrowserPanelStore(
    state => state.owners[resolvedOwnerId]?.requestedTab ?? null,
  )
  const setActiveOwner = useBrowserPanelStore(state => state.setActiveOwner)
  const upsertOwnerState = useBrowserPanelStore(state => state.upsertOwnerState)
  const fulfillRequestedTab = useBrowserPanelStore(state => state.fulfillRequestedTab)
  const createBrowserTab = useBrowserPanelStore(state => state.createTab)
  const removeOwnerState = useBrowserPanelStore(state => state.removeOwnerState)
  const setActiveTab = useBrowserPanelStore(state => state.setActiveTab)
  const closePanelTab = useBrowserPanelStore(state => state.closeTab)
  const openWorkspaceFileTab = useBrowserPanelStore(state => state.openWorkspaceFileTab)
  const openLauncherTab = useBrowserPanelStore(state => state.openLauncherTab)
  const openTuiTab = useBrowserPanelStore(state => state.openTuiTab)
  const updateTuiTabTitle = useBrowserPanelStore(state => state.updateTuiTabTitle)
  const openContextUsageReportTab = useBrowserPanelStore(state => state.openContextUsageReportTab)
  const saveAnnotation = useBrowserPanelStore(state => state.saveAnnotation)
  const markAnnotationSent = useBrowserPanelStore(state => state.markAnnotationSent)
  const deleteAnnotation = useBrowserPanelStore(state => state.deleteAnnotation)
  const clearAnnotations = useBrowserPanelStore(state => state.clearAnnotations)
  const syncAnnotationLayoutHints = useBrowserPanelStore(state => state.syncAnnotationLayoutHints)
  const annotationAdjustmentSession = useBrowserPanelStore(
    state => state.annotationAdjustmentSession,
  )
  const setAnnotationAdjustmentSession = useBrowserPanelStore(
    state => state.setAnnotationAdjustmentSession,
  )
  const openAsideTab = useLayoutStore(state => state.openAsideTab)
  const setAnnotationTrayCollapsed = useBrowserPanelStore(
    state => state.setAnnotationTrayCollapsed,
  )
  const ownerAnnotations = useBrowserPanelStore(selectBrowserAnnotations)
  const ownerAnnotationLayoutHintsByTabId = useBrowserPanelStore(
    state =>
      state.owners[resolvedOwnerId]?.annotationLayoutHintsByTabId
      ?? EMPTY_BROWSER_ANNOTATION_LAYOUT_HINTS_BY_TAB_ID,
  )
  const annotationTrayCollapsed = useBrowserPanelStore(
    state => state.annotationTrayCollapsedByOwnerId[resolvedOwnerId] ?? true,
  )

  const viewportRef = useRef<HTMLDivElement | null>(null)
  const browserWebviewHostRef = useRef<HTMLDivElement | null>(null)
  const browserWebviewRef = useRef<BrowserWebviewElement | null>(null)
  const browserWebviewTabIdRef = useRef<string | null>(null)
  const browserWebviewAttachKeyRef = useRef<string | null>(null)
  const previousActiveTabIdRef = useRef<string | null>(null)
  const addressDraftByTabIdRef = useRef<Map<string, string>>(new Map())
  const lastSyncedAddressValueRef = useRef<string | undefined>(undefined)
  const previousAnnotationRuntimeTabIdRef = useRef<string | null>(null)
  const stableBoundsFrameCountRef = useRef(0)
  const animationFrameRef = useRef<number | null>(null)
  const lastNativeBoundsSignatureRef = useRef<string | null>(null)
  const newTabRequestInFlightRef = useRef(false)
  const pendingBrowserTabSelectionRef = useRef<string | null>(null)
  const [addressValue, setAddressValue] = useState('')
  const [isEditingAddress, setIsEditingAddress] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const [suggestionsOpen, setSuggestionsOpen] = useState(false)
  const [annotationSession, setAnnotationSession]
    = useState<BrowserAnnotationRuntimeSession | null>(null)
  const [, setAnnotationSubmitting] = useState(false)
  const [newTabRequestPending, setNewTabRequestPending] = useState(false)
  const [dirtyPlanRefineTabIds, setDirtyPlanRefineTabIds] = useState<Set<string>>(() => new Set())
  const [discardPromptTabId, setDiscardPromptTabId] = useState<string | null>(null)
  const nativeBrowserAvailable = Boolean(readBrowserBridge())

  const tabs = useBrowserPanelStore(
    state => state.owners[resolvedOwnerId]?.tabs ?? EMPTY_BROWSER_PANEL_TABS,
  )
  const activePanelTabId = useBrowserPanelStore(
    state => state.owners[resolvedOwnerId]?.activeTabId ?? null,
  )
  const browserTabs = tabs.filter(isBrowserPanelTab)
  const activePanelTab = tabs.find(tab => tab.id === activePanelTabId) ?? tabs[0] ?? null
  const resolvedActivePanelTabId = activePanelTab?.id ?? null
  const activeBrowserTab = activePanelTab?.kind === 'browser' ? activePanelTab : null
  const activeBrowserTabId = activeBrowserTab?.id ?? null
  const activeBrowserTabUrl = activeBrowserTab?.lastCommittedUrl ?? activeBrowserTab?.url ?? null
  const activeBrowserTabIsBlank = isBrowserBlankTab(activeBrowserTab)
  const {
    servers: localServers,
    loading: localServersLoading,
    error: localServersError,
    refresh: refreshLocalServers,
  } = useLocalServers(activeBrowserTabIsBlank)
  const canCreateTuiTab = Boolean(terminalCwd)
  const activeBrowserAnnotations = ownerAnnotations.filter(
    annotation => annotation.tabId === activeBrowserTabId,
  )
  const activeBrowserAnnotationLayoutHints = activeBrowserTabId
    ? (ownerAnnotationLayoutHintsByTabId[activeBrowserTabId]
      ?? EMPTY_BROWSER_ANNOTATION_LAYOUT_HINTS)
    : EMPTY_BROWSER_ANNOTATION_LAYOUT_HINTS
  const activeAnnotationSession
    = annotationSession?.tabId === activeBrowserTabId ? annotationSession : null
  const hasActiveAnnotationSession = activeAnnotationSession !== null
  const suggestions = buildBrowserAddressSuggestions({
    query: addressValue,
    activeTabId: activeBrowserTabId,
    tabs: browserTabs,
    recentHistory,
  })
  const chromeStatus
    = activePanelTab?.kind === 'browser' || localError || browserState?.lastError
      ? resolveBrowserChromeStatus({
          localError,
          threadLastError: browserState?.lastError,
          activeTabStatus: activeBrowserTab?.status ?? 'suspended',
          hasActiveTab: Boolean(activeBrowserTab),
          workspaceReady: Boolean(browserState),
        })
      : null
  const chromeStatusLabel = chromeStatus?.label ?? null
  const chromeStatusTone = chromeStatus?.tone ?? null

  const applyBrowserState = useCallback(
    (state: ThreadBrowserState) => {
      const pendingTabId = pendingBrowserTabSelectionRef.current
      if (pendingTabId && state.activeTabId !== pendingTabId) {
        return
      }
      if (pendingTabId === state.activeTabId) {
        pendingBrowserTabSelectionRef.current = null
      }
      upsertOwnerState(state)
    },
    [upsertOwnerState],
  )

  useEffect(() => {
    if (resolvedActivePanelTabId && resolvedActivePanelTabId !== activePanelTabId) {
      setActiveTab(resolvedActivePanelTabId, resolvedOwnerId)
    }
  }, [activePanelTabId, resolvedActivePanelTabId, resolvedOwnerId, setActiveTab])

  useEffect(() => {
    if (!nativeSurfaceVisible) {
      return
    }
    setActiveOwner(resolvedOwnerId)
  }, [nativeSurfaceVisible, resolvedOwnerId, setActiveOwner])

  useEffect(() => {
    const bridge = readBrowserBridge()
    if (!bridge) {
      return
    }

    const unsubscribe = bridge.onState(applyBrowserState)

    void bridge
      .getState({ threadId: resolvedOwnerId })
      .then(applyBrowserState)
      .catch((error) => {
        setLocalError(formatBrowserActionError(error))
      })

    return () => {
      setAnnotationSession(null)
      setAnnotationSubmitting(false)
      unsubscribe()
      void bridge.hide({ threadId: resolvedOwnerId }).catch(() => {})
    }
  }, [applyBrowserState, resolvedOwnerId])

  useEffect(() => {
    if (!requestedTab) {
      return
    }

    const bridge = readBrowserBridge()
    if (!bridge) {
      createBrowserTab(
        requestedTab.url ?? 'about:blank',
        {
          sessionId: requestedTab.sessionId,
          sessionTitle: requestedTab.sessionTitle,
        },
        resolvedOwnerId,
      )
      fulfillRequestedTab(requestedTab.id, resolvedOwnerId)
      return
    }

    const url = requestedTab.url ?? 'about:blank'
    const action = browserState?.open
      ? bridge.newTab({ threadId: resolvedOwnerId, url, activate: true })
      : bridge.open({ threadId: resolvedOwnerId, initialUrl: url })

    void action
      .then((nextState) => {
        upsertOwnerState(nextState)
        if (nextState.activeTabId) {
          setActiveTab(nextState.activeTabId, resolvedOwnerId)
        }
      })
      .catch((error) => {
        setLocalError(formatBrowserActionError(error))
      })
      .finally(() => {
        fulfillRequestedTab(requestedTab.id, resolvedOwnerId)
      })
  }, [
    browserState?.open,
    createBrowserTab,
    fulfillRequestedTab,
    requestedTab,
    resolvedOwnerId,
    setActiveTab,
    upsertOwnerState,
  ])

  const detachRendererBrowserWebview = useCallback(
    (removeElement: boolean) => {
      const webview = browserWebviewRef.current
      const tabId = browserWebviewTabIdRef.current
      let webContentsId: number | undefined
      try {
        webContentsId = webview?.getWebContentsId?.()
      }
 catch {
        webContentsId = undefined
      }

      if (tabId && webContentsId && webContentsId > 0) {
        void readBrowserBridge()
          ?.detachWebview({
            threadId: resolvedOwnerId,
            tabId,
            webContentsId,
          })
          .catch(() => {})
      }

      browserWebviewAttachKeyRef.current = null
      browserWebviewTabIdRef.current = null
      if (!removeElement) {
        return
      }
      webview?.remove()
      browserWebviewRef.current = null
    },
    [resolvedOwnerId],
  )

  const hideNativeBrowserSurface = useCallback(() => {
    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = null
      stableBoundsFrameCountRef.current = 0
    }
    const webview = browserWebviewRef.current
    setBrowserWebviewOccluded(webview, true)
    const surface = webview ? 'renderer' : 'native'
    const nextSignature = `${resolvedOwnerId}:${surface}:${browserNativeBoundsSignature(null)}`
    if (lastNativeBoundsSignatureRef.current === nextSignature) {
      return
    }
    lastNativeBoundsSignatureRef.current = nextSignature
    readBrowserBridge()?.setBounds({ threadId: resolvedOwnerId, bounds: null, surface })
  }, [resolvedOwnerId])

  const shouldShowNativeBrowserSurface = useCallback(
    () =>
      Boolean(
        nativeSurfaceVisible
        && browserState?.open
        && activePanelTab?.kind === 'browser'
        && !activeBrowserTabIsBlank
        && nativeSurfaceSuppressCount === 0,
      ),
    [
      activeBrowserTabIsBlank,
      activePanelTab?.kind,
      browserState?.open,
      nativeSurfaceVisible,
      nativeSurfaceSuppressCount,
    ],
  )

  useEffect(() => {
    if (shouldShowNativeBrowserSurface()) {
      return
    }
    hideNativeBrowserSurface()
  }, [hideNativeBrowserSurface, shouldShowNativeBrowserSurface])

  useEffect(() => {
    return () => {
      hideNativeBrowserSurface()
    }
  }, [hideNativeBrowserSurface])

  const syncBounds = useCallback(() => {
    if (!shouldShowNativeBrowserSurface()) {
      hideNativeBrowserSurface()
      return
    }
    if (nativeBoundsPaused) {
      return
    }

    const bridge = readBrowserBridge()
    const element = viewportRef.current
    if (!bridge || !element) {
      return
    }

    const viewportRect = element.getBoundingClientRect()
    const rawBounds = normalizeBrowserNativeBounds(viewportRect)
    if (!rawBounds) {
      hideNativeBrowserSurface()
      return
    }
    const webview = browserWebviewRef.current
    const rendererOccluded = Boolean(
      webview
      && (nativeSurfaceSuppressCount > 0 || hasRendererBrowserObscuringOverlay(viewportRect)),
    )
    setBrowserWebviewOccluded(webview, rendererOccluded)
    const surface = webview ? 'renderer' : 'native'
    const bounds = rendererOccluded
      ? null
      : webview
        ? rawBounds
        : applyBrowserNativeSurfaceOcclusions(rawBounds, viewportRect)
    if (!bounds) {
      if (!webview) {
        hideNativeBrowserSurface()
        return
      }
      const nextSignature = `${resolvedOwnerId}:${surface}:${browserNativeBoundsSignature(null)}`
      if (lastNativeBoundsSignatureRef.current === nextSignature) {
        return
      }
      lastNativeBoundsSignatureRef.current = nextSignature
      bridge.setBounds({ threadId: resolvedOwnerId, surface, bounds: null })
      return
    }

    const nextSignature = `${resolvedOwnerId}:${surface}:${activeBrowserTabId ?? 'none'}:${browserNativeBoundsSignature(bounds)}`
    if (lastNativeBoundsSignatureRef.current === nextSignature) {
      return
    }
    lastNativeBoundsSignatureRef.current = nextSignature
    bridge.setBounds({
      threadId: resolvedOwnerId,
      surface,
      bounds,
    })
  }, [
    hideNativeBrowserSurface,
    activeBrowserTabId,
    nativeBoundsPaused,
    nativeSurfaceSuppressCount,
    resolvedOwnerId,
    shouldShowNativeBrowserSurface,
  ])

  const scheduleStableBoundsSync = useCallback(() => {
    if (typeof window === 'undefined') {
      return
    }
    if (!shouldShowNativeBrowserSurface()) {
      hideNativeBrowserSurface()
      return
    }
    if (nativeBoundsPaused) {
      return
    }
    if (animationFrameRef.current !== null) {
      return
    }

    const tick = () => {
      if (typeof window === 'undefined') {
        animationFrameRef.current = null
        stableBoundsFrameCountRef.current = 0
        return
      }
      syncBounds()
      stableBoundsFrameCountRef.current += 1
      if (stableBoundsFrameCountRef.current < BROWSER_BOUNDS_SYNC_STABLE_FRAME_TARGET) {
        animationFrameRef.current = window.requestAnimationFrame(tick)
        return
      }
      animationFrameRef.current = null
      stableBoundsFrameCountRef.current = 0
    }

    animationFrameRef.current = window.requestAnimationFrame(tick)
  }, [hideNativeBrowserSurface, nativeBoundsPaused, shouldShowNativeBrowserSurface, syncBounds])

  useLayoutEffect(() => {
    const bridge = readBrowserBridge()
    const host = browserWebviewHostRef.current
    const canUseRendererWebview = Boolean(
      bridge
      && typeof bridge.getWebviewConfig === 'function'
      && typeof bridge.attachWebview === 'function'
      && typeof bridge.detachWebview === 'function',
    )
    if (
      !bridge
      || !host
      || !canUseRendererWebview
      || !nativeSurfaceVisible
      || !browserState?.open
      || activePanelTab?.kind !== 'browser'
      || !activeBrowserTabId
      || activeBrowserTabIsBlank
    ) {
      detachRendererBrowserWebview(true)
      return
    }

    let webview = browserWebviewRef.current
    if (!webview) {
      const config = bridge.getWebviewConfig({ threadId: resolvedOwnerId })
      webview = document.createElement('webview') as BrowserWebviewElement
      webview.className = 'size-full'
      webview.style.display = 'flex'
      webview.style.width = '100%'
      webview.style.height = '100%'
      webview.style.backgroundColor = 'var(--background)'
      webview.setAttribute('partition', config.partition)
      webview.setAttribute('preload', config.preloadUrl)
      webview.setAttribute('webpreferences', 'contextIsolation=yes,nodeIntegration=no,sandbox=yes')
      webview.setAttribute('allowpopups', 'true')
      browserWebviewRef.current = webview
      host.append(webview)
    }
 else if (webview.parentElement !== host) {
      host.append(webview)
    }

    if (browserWebviewTabIdRef.current !== activeBrowserTabId) {
      detachRendererBrowserWebview(false)
      browserWebviewTabIdRef.current = activeBrowserTabId
      browserWebviewAttachKeyRef.current = null
      webview.setAttribute('src', activeBrowserTabUrl || 'about:blank')
    }

    const attachVisibleWebview = () => {
      let webContentsId: number | undefined
      try {
        webContentsId = webview.getWebContentsId?.()
      }
 catch {
        return
      }
      if (!webContentsId || webContentsId <= 0) {
        return
      }

      const attachKey = `${activeBrowserTabId}:${webContentsId}`
      if (browserWebviewAttachKeyRef.current === attachKey) {
        return
      }
      browserWebviewAttachKeyRef.current = attachKey
      void bridge
        .attachWebview({
          threadId: resolvedOwnerId,
          tabId: activeBrowserTabId,
          webContentsId,
        })
        .then((nextState) => {
          if (browserWebviewAttachKeyRef.current === attachKey) {
            applyBrowserState(nextState)
          }
        })
        .catch((error) => {
          if (browserWebviewAttachKeyRef.current === attachKey) {
            browserWebviewAttachKeyRef.current = null
          }
          setLocalError(formatBrowserActionError(error))
        })
    }

    webview.addEventListener('dom-ready', attachVisibleWebview)
    webview.addEventListener('did-start-loading', attachVisibleWebview)
    const frameId = window.requestAnimationFrame(() => {
      attachVisibleWebview()
      scheduleStableBoundsSync()
    })

    return () => {
      window.cancelAnimationFrame(frameId)
      webview.removeEventListener('dom-ready', attachVisibleWebview)
      webview.removeEventListener('did-start-loading', attachVisibleWebview)
    }
  }, [
    activeBrowserTabId,
    activeBrowserTabIsBlank,
    activeBrowserTabUrl,
    activePanelTab?.kind,
    applyBrowserState,
    browserState?.open,
    detachRendererBrowserWebview,
    nativeSurfaceVisible,
    resolvedOwnerId,
    scheduleStableBoundsSync,
  ])

  useEffect(() => {
    return () => {
      detachRendererBrowserWebview(true)
    }
  }, [detachRendererBrowserWebview])

  const scheduleStableBoundsSyncFromObserver = useEffectEvent(() => {
    scheduleStableBoundsSync()
  })

  const hideNativeBrowserSurfaceFromObserver = useEffectEvent(() => {
    hideNativeBrowserSurface()
  })

  const scheduleStableBoundsSyncFromOcclusionObserver = useEffectEvent(() => {
    scheduleStableBoundsSync()
  })

  useLayoutEffect(() => {
    const element = viewportRef.current
    if (!element || !shouldShowNativeBrowserSurface()) {
      hideNativeBrowserSurfaceFromObserver()
      return
    }
    if (nativeBoundsPaused) {
      return
    }

    scheduleStableBoundsSyncFromObserver()
    const resizeObserver = new ResizeObserver(scheduleStableBoundsSyncFromObserver)
    resizeObserver.observe(element)
    window.addEventListener('resize', scheduleStableBoundsSyncFromObserver)
    window.addEventListener('scroll', scheduleStableBoundsSyncFromObserver, true)

    return () => {
      resizeObserver.disconnect()
      window.removeEventListener('resize', scheduleStableBoundsSyncFromObserver)
      window.removeEventListener('scroll', scheduleStableBoundsSyncFromObserver, true)
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current)
        animationFrameRef.current = null
      }
    }
  }, [activePanelTab?.kind, nativeBoundsPaused, shouldShowNativeBrowserSurface])

  useEffect(() => {
    if (
      nativeBoundsPaused
      || !shouldShowNativeBrowserSurface()
      || typeof document === 'undefined'
      || typeof MutationObserver === 'undefined'
    ) {
      return
    }

    const observedOccluders = new Set<HTMLElement>()
    const resizeObserver
      = typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(scheduleStableBoundsSyncFromOcclusionObserver)

    const syncObservedOccluders = () => {
      if (typeof document === 'undefined' || !document.body) {
        return
      }
      const nextOccluders = new Set(
        document.querySelectorAll<HTMLElement>(
          `${BROWSER_NATIVE_SURFACE_OCCLUSION_SELECTOR}, ${BROWSER_RENDERER_OBSCURING_OVERLAY_SELECTOR}`,
        ),
      )

      for (const occluder of observedOccluders) {
        if (nextOccluders.has(occluder)) {
          continue
        }
        resizeObserver?.unobserve(occluder)
        observedOccluders.delete(occluder)
      }

      for (const occluder of nextOccluders) {
        if (observedOccluders.has(occluder)) {
          continue
        }
        resizeObserver?.observe(occluder)
        observedOccluders.add(occluder)
      }

      scheduleStableBoundsSyncFromOcclusionObserver()
    }

    const mutationObserver = new MutationObserver(syncObservedOccluders)
    mutationObserver.observe(document.body, {
      attributes: true,
      attributeFilter: [BROWSER_NATIVE_SURFACE_OCCLUSION_ATTRIBUTE, 'aria-hidden', 'data-state'],
      childList: true,
      subtree: true,
    })
    syncObservedOccluders()

    return () => {
      mutationObserver.disconnect()
      resizeObserver?.disconnect()
      scheduleStableBoundsSyncFromOcclusionObserver()
    }
  }, [nativeBoundsPaused, shouldShowNativeBrowserSurface])

  useEffect(() => {
    const bridge = readBrowserBridge()
    const selectedElement = annotationAdjustmentSession?.selectedElement
    if (
      !bridge
      || activeAnnotationSession === null
      || !activeBrowserTab
      || !activeBrowserTabId
      || !selectedElement
      || annotationAdjustmentSession.ownerId !== resolvedOwnerId
      || annotationAdjustmentSession.tabId !== activeBrowserTabId
    ) {
      return
    }

    const designChange = annotationAdjustmentSession.designChanges

    void (async () => {
      if (hasBrowserAnnotationDesignChanges(designChange)) {
        await bridge.applyAnnotationDesign({
          threadId: resolvedOwnerId,
          tabId: activeBrowserTabId,
          selector: selectedElement.selector,
          designChange,
        })
      }
 else {
        await bridge.applyAnnotationDesign({
          threadId: resolvedOwnerId,
          tabId: activeBrowserTabId,
          selector: selectedElement.selector,
          designChange: {},
        })
      }
    })().catch((error) => {
      setLocalError(formatBrowserActionError(error))
    })
  }, [
    activeBrowserTab,
    activeBrowserTabId,
    annotationAdjustmentSession,
    activeAnnotationSession,
    resolvedOwnerId,
  ])

  useEffect(() => {
    scheduleStableBoundsSync()
  }, [
    activeBrowserTabIsBlank,
    activePanelTab?.id,
    hasActiveAnnotationSession,
    chromeStatusLabel,
    chromeStatusTone,
    scheduleStableBoundsSync,
    suggestionsOpen,
  ])

  useEffect(() => {
    const previousAnnotationRuntimeTabId = previousAnnotationRuntimeTabIdRef.current
    if (previousAnnotationRuntimeTabId) {
      void readBrowserBridge()
        ?.clearAnnotationDesign({
          threadId: resolvedOwnerId,
          tabId: previousAnnotationRuntimeTabId,
        })
        .catch(() => {})
    }
    previousAnnotationRuntimeTabIdRef.current = activeBrowserTabId
    setAnnotationAdjustmentSession(null)
  }, [activeBrowserTabId, resolvedOwnerId, setAnnotationAdjustmentSession])

  useEffect(() => {
    const nextDisplayValue = browserAddressDisplayValue(activeBrowserTab)
    const decision = resolveBrowserAddressSync({
      activeTabId: activeBrowserTabId,
      previousActiveTabId: previousActiveTabIdRef.current,
      savedDraft: activeBrowserTabId
        ? addressDraftByTabIdRef.current.get(activeBrowserTabId)
        : undefined,
      nextDisplayValue,
      lastSyncedValue: lastSyncedAddressValueRef.current,
      isEditing: isEditingAddress,
    })
    previousActiveTabIdRef.current = activeBrowserTabId

    if (decision.type === 'replace') {
      setAddressValue(decision.value)
      lastSyncedAddressValueRef.current = decision.syncedValue
    }
  }, [activeBrowserTab, activeBrowserTabId, isEditingAddress])

  const runBrowserAction = useCallback(async (action: () => Promise<unknown>) => {
    setLocalError(null)
    try {
      await action()
    }
 catch (error) {
      const message = formatBrowserActionError(error)
      if (message) {
        setLocalError(message)
      }
    }
  }, [])

  useEffect(() => {
    const bridge = readBrowserBridge()
    if (!bridge?.onPromptRequested) {
      return undefined
    }

    return bridge.onPromptRequested((request) => {
      if (!isBrowserPromptRequest(request) || request.threadId !== resolvedOwnerId) {
        return
      }

      const ownerState = useBrowserPanelStore.getState().owners[resolvedOwnerId]
      const sourceTab
        = ownerState?.tabs.find(
          (tab): tab is BrowserWebTab => tab.id === request.tabId && tab.kind === 'browser',
        ) ?? null
      const targetSessionId = sourceTab?.sessionId ?? activeSessionId
      if (!targetSessionId) {
        setLocalError('Open a chat session to receive browser page prompts.')
        return
      }

      const files = request.attachments
        .map(createBrowserPromptFilePart)
        .filter(file => file !== null)
      const sent = submitChatPromptIngress(targetSessionId, {
        text: request.text,
        files,
      })
      if (!sent) {
        setLocalError('The target composer is not ready for browser page prompts.')
      }
    })
  }, [activeSessionId, resolvedOwnerId])

  const handleNewTab = () => {
    openLauncherTab(resolvedOwnerId)
  }

  const closeLocalPanelTab = useCallback(
    (tabId: string) => {
      const tab = useBrowserPanelStore
        .getState()
        .owners[resolvedOwnerId]
?.tabs
.find(item => item.id === tabId)

      if (tab?.kind === 'side-conversation') {
        void releaseSideConversation(tab.sideConversationId)
      }

      const result = closePanelTab(tabId, resolvedOwnerId)
      setDirtyPlanRefineTabIds((previous) => {
        if (!previous.has(tabId)) {
          return previous
        }
        const next = new Set(previous)
        next.delete(tabId)
        return next
      })
      setDiscardPromptTabId(current => (current === tabId ? null : current))

      if (result.closedLastTab) {
        removeOwnerState(resolvedOwnerId)
        onCloseLastTab?.(resolvedOwnerId)
        return
      }
      const nextOwnerState = useBrowserPanelStore.getState().owners[resolvedOwnerId]
      const nextActiveBrowserTab = nextOwnerState?.tabs.find(
        item => item.id === nextOwnerState.activeTabId && item.kind === 'browser',
      )
      const bridge = readBrowserBridge()
      if (nextActiveBrowserTab && bridge) {
        void runBrowserAction(async () => {
          upsertOwnerState(
            await bridge.selectTab({
              threadId: resolvedOwnerId,
              tabId: nextActiveBrowserTab.id,
            }),
          )
        })
      }
    },
    [
      closePanelTab,
      onCloseLastTab,
      removeOwnerState,
      resolvedOwnerId,
      runBrowserAction,
      upsertOwnerState,
    ],
  )

  const handleCreateBrowserTab = (sourceTabId?: string) => {
    const bridge = readBrowserBridge()
    if (newTabRequestInFlightRef.current) {
      return
    }
    if (!bridge) {
      createBrowserTab(
        'about:blank',
        {
          sessionId: activeSessionId,
          sessionTitle: activeSessionTitle,
        },
        resolvedOwnerId,
      )
      if (sourceTabId) {
        closeLocalPanelTab(sourceTabId)
      }
      return
    }
    newTabRequestInFlightRef.current = true
    setNewTabRequestPending(true)
    void runBrowserAction(async () => {
      const nextState = browserState?.open
        ? await bridge.newTab({
            threadId: resolvedOwnerId,
            url: 'about:blank',
            activate: true,
          })
        : await bridge.open({ threadId: resolvedOwnerId, initialUrl: 'about:blank' })
      upsertOwnerState(nextState)
      if (nextState.activeTabId) {
        setActiveTab(nextState.activeTabId, resolvedOwnerId)
      }
      if (sourceTabId) {
        closeLocalPanelTab(sourceTabId)
      }
    }).finally(() => {
      newTabRequestInFlightRef.current = false
      setNewTabRequestPending(false)
    })
  }

  const handleCreateTuiTab = (sourceTabId?: string) => {
    if (!terminalCwd) {
      setLocalError('Open a workspace to create a terminal tab.')
      return
    }

    void loadBrowserTuiShellView()
    openTuiTab({
      cwd: terminalCwd,
      ownerId: resolvedOwnerId,
    })
    if (sourceTabId) {
      closeLocalPanelTab(sourceTabId)
    }
  }

  const handleTuiMetadata = (tabId: string, metadata: TerminalMetadata) => {
    if (metadata.title) {
      updateTuiTabTitle(tabId, metadata.title, resolvedOwnerId)
    }
  }

  const handleTuiExited = (tabId: string) => {
    closeLocalPanelTab(tabId)
  }

  const handleCloseTab = (tabId: string) => {
    const tab = tabs.find(item => item.id === tabId)
    if (!tab) {
      return
    }

    if (tab.kind === 'plan-refine' && dirtyPlanRefineTabIds.has(tabId)) {
      setDiscardPromptTabId(tabId)
      return
    }

    if (tab.kind !== 'browser') {
      closeLocalPanelTab(tabId)
      return
    }

    const bridge = readBrowserBridge()
    if (!bridge) {
      const result = closePanelTab(tabId, resolvedOwnerId)
      if (result.closedLastTab) {
        removeOwnerState(resolvedOwnerId)
        onCloseLastTab?.(resolvedOwnerId)
      }
      return
    }

    void runBrowserAction(async () => {
      const nextState = await bridge.closeTab({ threadId: resolvedOwnerId, tabId })
      upsertOwnerState(nextState)
      const remainingTabs
        = useBrowserPanelStore.getState().owners[resolvedOwnerId]?.tabs ?? EMPTY_BROWSER_PANEL_TABS
      if (remainingTabs.length === 0) {
        removeOwnerState(resolvedOwnerId)
        onCloseLastTab?.(resolvedOwnerId)
      }
    })
  }

  const handleSelectTab = (tabId: string) => {
    const tab = tabs.find(item => item.id === tabId)
    if (!tab) {
      return
    }
    if (tab.kind !== 'browser') {
      pendingBrowserTabSelectionRef.current = null
      hideNativeBrowserSurface()
      setActiveTab(tabId, resolvedOwnerId)
      return
    }

    const bridge = readBrowserBridge()
    if (!bridge) {
      setActiveTab(tabId, resolvedOwnerId)
      return
    }
    pendingBrowserTabSelectionRef.current = tabId
    setActiveTab(tabId, resolvedOwnerId)
    void runBrowserAction(async () => {
      applyBrowserState(await bridge.selectTab({ threadId: resolvedOwnerId, tabId }))
    }).finally(() => {
      if (pendingBrowserTabSelectionRef.current !== tabId) {
        return
      }
      pendingBrowserTabSelectionRef.current = null
      void bridge
        .getState({ threadId: resolvedOwnerId })
        .then(applyBrowserState)
        .catch(() => {})
    })
  }

  const navigateActiveTab = (url: string) => {
    if (!activeBrowserTabId) {
      return
    }
    const bridge = readBrowserBridge()
    if (!bridge) {
      return
    }
    void runBrowserAction(async () => {
      const normalizedUrl = normalizeBrowserAddressInput(url)
      upsertOwnerState(
        await bridge.navigate({
          threadId: resolvedOwnerId,
          tabId: activeBrowserTabId,
          url: normalizedUrl,
        }),
      )
      lastSyncedAddressValueRef.current = browserAddressDisplayValue({ url: normalizedUrl })
      addressDraftByTabIdRef.current.delete(activeBrowserTabId)
      setSuggestionsOpen(false)
    })
  }

  const handleSuggestion = (suggestion: BrowserAddressSuggestion) => {
    if (suggestion.kind === 'tab' && suggestion.tabId) {
      handleSelectTab(suggestion.tabId)
      setSuggestionsOpen(false)
      return
    }
    navigateActiveTab(suggestion.url)
  }

  const handleAddressSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    navigateActiveTab(addressValue)
  }

  const handleCaptureScreenshot = () => {
    if (!activeBrowserTabId) {
      return
    }
    const bridge = readBrowserBridge()
    if (!bridge) {
      return
    }
    void runBrowserAction(async () => {
      if (!activeSessionId) {
        throw new Error('Open a chat session to attach browser screenshots.')
      }
      const screenshot = await bridge.captureScreenshot({
        threadId: resolvedOwnerId,
        tabId: activeBrowserTabId,
      })
      const attached = submitChatComposerFileIngress(activeSessionId, [
        createBrowserScreenshotFilePart({
          name: screenshot.name,
          mimeType: screenshot.mimeType,
          bytes: screenshot.bytes,
        }),
      ])
      if (!attached) {
        throw new Error('The active composer is not ready for browser screenshots.')
      }
    })
  }

  const handleStartAnnotation = () => {
    if (!activeBrowserTabId) {
      return
    }
    const bridge = readBrowserBridge()
    const viewport = viewportRef.current
    if (!bridge || !viewport) {
      return
    }
    void runBrowserAction(async () => {
      await bridge
        .clearAnnotationDesign({
          threadId: resolvedOwnerId,
          tabId: activeBrowserTabId,
        })
        .catch(() => {})
      const rect = viewport.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) {
        throw new Error('The browser viewport isn\'t ready for annotation.')
      }
      await bridge.startAnnotationRuntime({
        threadId: resolvedOwnerId,
        tabId: activeBrowserTabId,
        annotations: activeBrowserAnnotations.map(toBrowserAnnotationRuntimeAnnotation),
        layoutHints: activeBrowserAnnotationLayoutHints,
      })
      setAnnotationAdjustmentSession(null)
      setAnnotationSession({
        tabId: activeBrowserTabId,
        editingAnnotationId: null,
      })
    })
  }

  const buildBrowserAnnotationRecordInput = async (
    input: BrowserAnnotationRuntimeEvent,
  ): Promise<Omit<BrowserAnnotationRecord, 'id' | 'createdAt' | 'updatedAt' | 'status'> | null> => {
    if (!input.anchor) {
      return null
    }
    const bridge = readBrowserBridge()
    if (!bridge) {
      throw new Error('Browser annotations are available in the desktop app.')
    }
    const ownerState = useBrowserPanelStore.getState().owners[resolvedOwnerId]
    const sourceTab
      = ownerState?.tabs.find(
        (tab): tab is BrowserWebTab => tab.id === input.tabId && tab.kind === 'browser',
      ) ?? null
    const sourceUrl = input.sourceUrl ?? sourceTab?.lastCommittedUrl ?? sourceTab?.url ?? ''
    const screenshot = await captureBrowserAnnotationScreenshot({
      bridge,
      threadId: resolvedOwnerId,
      tabId: input.tabId,
      url: sourceUrl,
    })
    const attachedImages = (input.attachedImages ?? [])
      .map(createBrowserPromptFilePart)
      .filter(file => file !== null)
    const fallbackSurfaceRect = viewportRef.current?.getBoundingClientRect()
    const designChange = input.designChange ?? null
    return {
      ownerId: resolvedOwnerId,
      tabId: input.tabId,
      title: input.sourceTitle ?? (sourceTab ? getTabTitle(sourceTab) : sourceUrl),
      url: sourceUrl,
      body: input.body ?? '',
      anchor: input.anchor,
      designChange: hasBrowserAnnotationDesignChanges(designChange) ? designChange : null,
      attachedImages,
      screenshot,
      elements: input.elements ?? [],
      surfaceSize: input.surfaceSize ?? {
        width: fallbackSurfaceRect?.width ?? 0,
        height: fallbackSurfaceRect?.height ?? 0,
      },
    }
  }

  const sendBrowserAnnotationRecord = async (record: BrowserAnnotationRecord) => {
    if (!activeSessionId) {
      setLocalError('Open a chat session to send browser annotations.')
      return false
    }

    const cropRect = getBrowserAnnotationCropRect(record.anchor)
    const cropPart = cropRect
      ? await createBrowserAnnotationCropFilePart({
          imageDataUrl: record.screenshot.url,
          cropRect,
          surfaceSize: record.surfaceSize,
        }).catch(() => null)
      : null
    const files = cropPart
      ? [record.screenshot, cropPart, ...record.attachedImages]
      : [record.screenshot, ...record.attachedImages]
    const sent = submitChatPromptIngress(activeSessionId, {
      text: createBrowserAnnotationPrompt({
        body: record.body,
        anchor: record.anchor,
        attachedImageCount: record.attachedImages.length,
        designChange: record.designChange,
        includesTargetCrop: Boolean(cropPart),
        title: record.title,
        url: record.url,
        surfaceSize: record.surfaceSize,
      }),
      files,
    })
    if (!sent) {
      setLocalError('The active composer is not ready for browser annotations.')
    }
    return sent
  }

  const clearAnnotationRuntimeDraft = useCallback(() => {
    if (!activeBrowserTabId) {
      return
    }
    void readBrowserBridge()
      ?.clearAnnotationDesign({
        threadId: resolvedOwnerId,
        tabId: activeBrowserTabId,
      })
      .catch(() => {})
  }, [activeBrowserTabId, resolvedOwnerId])

  const stopAnnotationRuntime = useCallback(
    (tabId: string | null = activeBrowserTabId) => {
      if (!tabId) {
        return
      }
      void readBrowserBridge()
        ?.stopAnnotationRuntime({
          threadId: resolvedOwnerId,
          tabId,
        })
        .catch(() => {})
    },
    [activeBrowserTabId, resolvedOwnerId],
  )

  const closeAnnotationSession = useCallback(() => {
    clearAnnotationRuntimeDraft()
    setAnnotationAdjustmentSession(null)
    setAnnotationSession(null)
    setAnnotationSubmitting(false)
    scheduleStableBoundsSync()
  }, [clearAnnotationRuntimeDraft, scheduleStableBoundsSync, setAnnotationAdjustmentSession])

  const handleCancelAnnotation = useCallback(() => {
    stopAnnotationRuntime(activeAnnotationSession?.tabId ?? activeBrowserTabId)
    closeAnnotationSession()
  }, [
    activeAnnotationSession?.tabId,
    activeBrowserTabId,
    closeAnnotationSession,
    stopAnnotationRuntime,
  ])

  const handleRuntimeAnnotationCommit = (event: BrowserAnnotationRuntimeEvent) => {
    void (async () => {
      if (event.type === 'submit') {
        setAnnotationSubmitting(true)
      }
      const recordInput = await buildBrowserAnnotationRecordInput(event)
      if (!recordInput) {
        setAnnotationSubmitting(false)
        return
      }
      const annotationId = saveAnnotation(
        {
          ...recordInput,
          id: annotationSession?.editingAnnotationId ?? event.runtimeAnnotationId ?? undefined,
          status: 'saved',
        },
        resolvedOwnerId,
      )
      const nextAnnotations
        = useBrowserPanelStore
          .getState()
          .owners[resolvedOwnerId]
?.annotations
.filter(
            annotation => annotation.tabId === event.tabId,
          )
          .map(annotation => ({
            id: annotation.id,
            anchor: annotation.anchor,
            body: annotation.body,
            designChange: annotation.designChange,
            status: annotation.status,
          })) ?? []
      void readBrowserBridge()
        ?.startAnnotationRuntime({
          threadId: resolvedOwnerId,
          tabId: event.tabId,
          annotations: nextAnnotations,
          layoutHints: activeBrowserAnnotationLayoutHints,
        })
        .catch(() => {})
      if (event.type === 'save') {
        setAnnotationSubmitting(false)
        setAnnotationAdjustmentSession(null)
        return
      }
      const now = Date.now()
      const record: BrowserAnnotationRecord = {
        ...recordInput,
        id: annotationId,
        createdAt: now,
        updatedAt: now,
        status: 'saved',
      }
      const sent = await sendBrowserAnnotationRecord(record)
      if (!sent) {
        setAnnotationSubmitting(false)
        return
      }
      markAnnotationSent(annotationId, resolvedOwnerId)
      setAnnotationSubmitting(false)
      setAnnotationAdjustmentSession(null)
    })()
  }

  const handleApplyAnnotationAdjustment = (detail: BrowserAnnotationAdjustmentApplyDetail) => {
    if (detail.ownerId !== resolvedOwnerId || detail.tabId !== activeBrowserTabId) {
      return
    }
    if (
      !annotationAdjustmentSession
      || annotationAdjustmentSession.ownerId !== resolvedOwnerId
      || annotationAdjustmentSession.tabId !== activeBrowserTabId
      || !annotationAdjustmentSession.selectedElement
      || !hasBrowserAnnotationDesignChanges(annotationAdjustmentSession.designChanges)
    ) {
      return
    }

    const element = annotationAdjustmentSession.selectedElement
    const surfaceRect = viewportRef.current?.getBoundingClientRect()
    handleRuntimeAnnotationCommit({
      threadId: resolvedOwnerId,
      tabId: activeBrowserTabId,
      type: 'submit',
      anchor: { kind: 'element', element },
      selectedElement: element,
      body: '',
      attachedImages: [],
      designChange: annotationAdjustmentSession.designChanges,
      elements: [element],
      surfaceSize: {
        width: surfaceRect?.width ?? 0,
        height: surfaceRect?.height ?? 0,
      },
      sourceUrl: activeBrowserTabUrl,
      sourceTitle: activeBrowserTab ? getTabTitle(activeBrowserTab) : activeBrowserTabUrl,
    })
  }

  const handleToggleAnnotation = () => {
    if (hasActiveAnnotationSession) {
      handleCancelAnnotation()
      return
    }
    handleStartAnnotation()
  }

  const handleAnnotationAdjustmentApplyEvent = useEffectEvent((event: Event) => {
    if (!isBrowserAnnotationAdjustmentApplyEvent(event)) {
      return
    }
    handleApplyAnnotationAdjustment(event.detail)
  })

  useEffect(() => {
    const handleEvent = (event: Event) => {
      handleAnnotationAdjustmentApplyEvent(event)
    }
    window.addEventListener(BROWSER_ANNOTATION_ADJUSTMENT_APPLY_EVENT, handleEvent)
    return () => {
      window.removeEventListener(BROWSER_ANNOTATION_ADJUSTMENT_APPLY_EVENT, handleEvent)
    }
  }, [])

  const handleEditSavedAnnotation = useCallback(
    (annotation: BrowserAnnotationRecord) => {
      if (activeBrowserTabId !== annotation.tabId) {
        return
      }
      const bridge = readBrowserBridge()
      if (!bridge) {
        return
      }
      void runBrowserAction(async () => {
        await bridge.startAnnotationRuntime({
          threadId: resolvedOwnerId,
          tabId: annotation.tabId,
          annotations: activeBrowserAnnotations.map(toBrowserAnnotationRuntimeAnnotation),
          editAnnotationId: annotation.id,
          layoutHints: activeBrowserAnnotationLayoutHints,
        })
      })
      if (annotation.anchor.kind === 'element') {
        setAnnotationAdjustmentSession({
          ownerId: resolvedOwnerId,
          tabId: annotation.tabId,
          annotationId: annotation.id,
          selectedElement: annotation.anchor.element,
          designChanges: annotation.designChange ?? {},
        })
        openAsideTab('adjustment')
      }
 else {
        setAnnotationAdjustmentSession(null)
      }
      setAnnotationSession({
        tabId: annotation.tabId,
        editingAnnotationId: annotation.id,
      })
    },
    [
      activeBrowserAnnotations,
      activeBrowserAnnotationLayoutHints,
      activeBrowserTabId,
      resolvedOwnerId,
      runBrowserAction,
      openAsideTab,
      setAnnotationAdjustmentSession,
    ],
  )

  const handleAnnotationRuntimeBridgeEvent = useEffectEvent((event: unknown) => {
    if (!isBrowserAnnotationRuntimeEvent(event) || event.threadId !== resolvedOwnerId) {
      return
    }
    if (event.type === 'ready') {
      setAnnotationSession(
        previous =>
          previous ?? {
            tabId: event.tabId,
            editingAnnotationId: null,
          },
      )
      return
    }
    if (event.type === 'toggle') {
      if (event.tabId !== activeBrowserTabId) {
        return
      }
      handleToggleAnnotation()
      return
    }
    if (event.type === 'selected-element') {
      if (event.selectedElement) {
        setAnnotationAdjustmentSession({
          ownerId: resolvedOwnerId,
          tabId: event.tabId,
          annotationId: event.runtimeAnnotationId ?? annotationSession?.editingAnnotationId ?? null,
          selectedElement: event.selectedElement,
          designChanges: event.designChange ?? {},
        })
        openAsideTab('adjustment')
      }
 else {
        setAnnotationAdjustmentSession(null)
      }
      return
    }
    if (event.type === 'copy') {
      if (event.layoutHints) {
        syncAnnotationLayoutHints(
          {
            tabId: event.tabId,
            hints: event.layoutHints,
          },
          resolvedOwnerId,
        )
      }
      return
    }
    if (event.type === 'clear') {
      clearAnnotations({ ownerId: resolvedOwnerId, tabId: event.tabId })
      setAnnotationAdjustmentSession(null)
      return
    }
    if (event.type === 'layout-sync') {
      syncAnnotationLayoutHints(
        {
          tabId: event.tabId,
          hints: event.layoutHints ?? [],
        },
        resolvedOwnerId,
      )
      return
    }
    if (event.type === 'delete') {
      if (event.annotationId) {
        deleteAnnotation(event.annotationId, resolvedOwnerId)
      }
      return
    }
    if (event.type === 'edit') {
      const annotation = useBrowserPanelStore
        .getState()
        .owners[
          resolvedOwnerId
        ]
?.annotations
.find(candidate => candidate.id === event.annotationId && candidate.tabId === event.tabId)
      if (annotation && event.annotationId && event.anchor && typeof event.body === 'string') {
        saveAnnotation(
          {
            ...annotation,
            anchor: event.anchor,
            body: event.body,
            designChange: event.designChange ?? annotation.designChange,
            elements: event.elements ?? annotation.elements,
            surfaceSize: event.surfaceSize ?? annotation.surfaceSize,
          },
          resolvedOwnerId,
        )
        setAnnotationAdjustmentSession(null)
        return
      }
      if (annotation) {
        handleEditSavedAnnotation(annotation)
      }
      return
    }
    if (event.type === 'save' || event.type === 'submit') {
      handleRuntimeAnnotationCommit(event)
      return
    }
    if (event.type === 'cancel' || event.type === 'closed') {
      closeAnnotationSession()
    }
  })

  useEffect(() => {
    const bridge = readBrowserBridge()
    if (!bridge?.onAnnotationRuntimeEvent) {
      return undefined
    }

    return bridge.onAnnotationRuntimeEvent((event) => {
      handleAnnotationRuntimeBridgeEvent(event)
    })
  }, [])

  const handleSendSavedAnnotation = (annotation: BrowserAnnotationRecord) => {
    void (async () => {
      const sent = await sendBrowserAnnotationRecord(annotation)
      if (sent) {
        markAnnotationSent(annotation.id, resolvedOwnerId)
      }
    })()
  }

  const handlePanelKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const isAnnotationToggle
      = (event.nativeEvent.metaKey || event.nativeEvent.ctrlKey)
        && event.nativeEvent.shiftKey
        && !event.nativeEvent.altKey
        && event.nativeEvent.key.toLowerCase() === 'f'
    if (isAnnotationToggle) {
      event.preventDefault()
      event.stopPropagation()
      event.nativeEvent.stopImmediatePropagation()
      handleToggleAnnotation()
      return
    }

    const isCommandOnly
      = event.nativeEvent.metaKey
        && !event.nativeEvent.altKey
        && !event.nativeEvent.ctrlKey
        && !event.nativeEvent.shiftKey
    if (!isCommandOnly) {
      return
    }

    const key = event.nativeEvent.key.toLowerCase()
    if (key === 'w' && activePanelTab) {
      event.preventDefault()
      event.stopPropagation()
      event.nativeEvent.stopImmediatePropagation()
      handleCloseTab(activePanelTab.id)
      return
    }

    if (!/^\d$/.test(key)) {
      return
    }

    const targetIndex = key === '0' ? 9 : Number.parseInt(key, 10) - 1
    const targetTab = tabs[targetIndex]
    if (!targetTab) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    event.nativeEvent.stopImmediatePropagation()
    handleSelectTab(targetTab.id)
  }

  const handleOpenContextUsageReport = () => {
    if (!activeSessionId) {
      return
    }
    openContextUsageReportTab({
      sessionId: activeSessionId,
      sessionTitle: activeSessionTitle,
      ownerId: resolvedOwnerId,
    })
  }

  useEffect(() => {
    const handleDirtyEvent = (event: Event) => {
      if (!isPlanRefineEditorDirtyEvent(event)) {
        return
      }
      const tabExists = useBrowserPanelStore
        .getState()
        .owners[
          resolvedOwnerId
        ]
?.tabs
.some(tab => tab.id === event.detail.tabId && tab.kind === 'plan-refine')
      if (!tabExists) {
        return
      }
      setDirtyPlanRefineTabIds((previous) => {
        const hasTab = previous.has(event.detail.tabId)
        if (event.detail.dirty === hasTab) {
          return previous
        }
        const next = new Set(previous)
        if (event.detail.dirty) {
          next.add(event.detail.tabId)
        }
 else {
          next.delete(event.detail.tabId)
        }
        return next
      })
      if (!event.detail.dirty && discardPromptTabId === event.detail.tabId) {
        setDiscardPromptTabId(null)
      }
    }

    window.addEventListener(PLAN_REFINE_EDITOR_DIRTY_EVENT, handleDirtyEvent)
    return () => {
      window.removeEventListener(PLAN_REFINE_EDITOR_DIRTY_EVENT, handleDirtyEvent)
    }
  }, [discardPromptTabId, resolvedOwnerId])

  useEffect(() => {
    const handleSaveEvent = (event: Event) => {
      if (!isPlanRefineEditorSaveEvent(event)) {
        return
      }
      const tab = useBrowserPanelStore
        .getState()
        .owners[
          resolvedOwnerId
        ]
?.tabs
.find(item => item.id === event.detail.tabId && item.kind === 'plan-refine')
      if (!tab) {
        return
      }
      queueMicrotask(() => {
        if (event.defaultPrevented) {
          closeLocalPanelTab(tab.id)
        }
      })
    }

    window.addEventListener(PLAN_REFINE_EDITOR_SAVE_EVENT, handleSaveEvent)
    return () => {
      window.removeEventListener(PLAN_REFINE_EDITOR_SAVE_EVENT, handleSaveEvent)
    }
  }, [closeLocalPanelTab, resolvedOwnerId])

  const handleDiscardPlanRefineTab = useCallback(
    (tabId: string) => {
      closeLocalPanelTab(tabId)
    },
    [closeLocalPanelTab],
  )

  return (
    <div
      className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background"
      data-testid="browser-panel"
      data-browser-panel-ready="true"
      onKeyDownCapture={handlePanelKeyDown}
    >
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border/50 bg-card px-2">
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {tabs.map(tab => (
            <div
              key={tab.id}
              className={cn(
                'group flex h-7 max-w-44 shrink-0 items-center rounded-md text-[11px] transition-colors',
                tab.id === resolvedActivePanelTabId
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground/70 hover:bg-foreground/5 hover:text-foreground',
              )}
            >
              <Button
                type="button"
                variant="ghost"
                className="h-full min-w-0 flex-1 justify-start gap-1.5 rounded-l-md rounded-r-none py-1 pl-2 pr-1 text-left text-[11px] font-normal hover:bg-transparent"
                onClick={() => handleSelectTab(tab.id)}
                aria-current={tab.id === resolvedActivePanelTabId ? 'page' : undefined}
              >
                {tab.kind === 'browser' && tab.isLoading && (
                  <Spinner
                    className="size-3 shrink-0 animate-spin !text-primary"
                    aria-hidden="true"
                  />
                )}
                {tab.kind === 'browser' && !tab.isLoading && tab.faviconUrl && (
                  <img src={tab.faviconUrl} alt="" className="size-3 shrink-0 rounded-sm" />
                )}
                {tab.kind === 'browser' && !tab.isLoading && !tab.faviconUrl && (
                  <GlobeIcon
                    className="size-3 shrink-0 !text-muted-foreground/60"
                    aria-hidden="true"
                  />
                )}
                {tab.kind === 'workspace-file' && (
                  <FileTextIcon className="size-3 shrink-0 !text-muted-foreground/60" />
                )}
                {tab.kind === 'workspace-diff' && (
                  <FileDiffIcon className="size-3 shrink-0 !text-muted-foreground/60" />
                )}
                {tab.kind === 'pull-request' && (
                  <PullRequestIcon className="size-3 shrink-0 !text-muted-foreground/60" />
                )}
                {tab.kind === 'subagent' && (
                  <BotIcon className="size-3 shrink-0 !text-muted-foreground/60" />
                )}
                {tab.kind === 'workflow' && (
                  <BotIcon className="size-3 shrink-0 !text-muted-foreground/60" />
                )}
                {tab.kind === 'side-conversation' && (
                  <MessageSquarePlusIcon className="size-3 shrink-0 !text-muted-foreground/60" />
                )}
                {tab.kind === 'context-usage-report' && (
                  <GaugeIcon className="size-3 shrink-0 !text-muted-foreground/60" />
                )}
                {tab.kind === 'launcher' && (
                  <PlusIcon className="size-3 shrink-0 !text-muted-foreground/60" />
                )}
                {tab.kind === 'tui' && (
                  <SquareTerminalIcon className="size-3 shrink-0 !text-muted-foreground/60" />
                )}
                {tab.kind === 'plan-document' && (
                  <PanelTopIcon className="size-3 shrink-0 !text-muted-foreground/60" />
                )}
                {tab.kind === 'plan-refine' && (
                  <PencilIcon className="size-3 shrink-0 !text-muted-foreground/60" />
                )}
                <span className="truncate">{getPanelTabTitle(tab)}</span>
                {tab.kind === 'browser'
                  && tab.sessionId
                  && tab.sessionId !== activeSessionId
                  && tab.sessionTitle && (
                    <span
                      className="ml-0.5 shrink-0 rounded-sm bg-foreground/7 px-1 text-[9px] text-muted-foreground"
                      aria-label={`From ${tab.sessionTitle}`}
                    >
                      {tab.sessionTitle}
                    </span>
                  )}
              </Button>
              <Popover
                open={discardPromptTabId === tab.id}
                onOpenChange={(open) => {
                  if (!open && discardPromptTabId === tab.id) {
                    setDiscardPromptTabId(null)
                  }
                }}
              >
                <PopoverTrigger
                  render={(
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      className="mr-0.5 size-5 shrink-0 rounded-sm text-muted-foreground/60 opacity-0 hover:bg-foreground/8 hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
                      onClick={() => handleCloseTab(tab.id)}
                      aria-label={`Close ${getPanelTabTitle(tab)}`}
                      aria-haspopup={tab.kind === 'plan-refine' ? 'dialog' : undefined}
                    >
                      <XIcon className="size-3" />
                    </Button>
                  )}
                />
                {tab.kind === 'plan-refine' && (
                  <PopoverContent side="bottom" align="end" className="w-64 gap-2 p-3">
                    <div className="space-y-1">
                      <div className="text-xs font-medium text-foreground">Discard changes?</div>
                      <div className="text-[11px] leading-4 text-muted-foreground">
                        This plan has unsaved edits.
                      </div>
                    </div>
                    <div className="flex justify-end gap-1.5">
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        onClick={() => setDiscardPromptTabId(null)}
                      >
                        Cancel
                      </Button>
                      <Button
                        type="button"
                        variant="destructive"
                        size="xs"
                        onClick={() => handleDiscardPlanRefineTab(tab.id)}
                      >
                        Discard
                      </Button>
                    </div>
                  </PopoverContent>
                )}
              </Popover>
            </div>
          ))}
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="size-7 shrink-0 rounded-md text-muted-foreground/70 hover:bg-foreground/5 hover:text-foreground disabled:opacity-40"
            onClick={handleNewTab}
            aria-label="New panel tab"
            title="New panel tab"
          >
            <PlusIcon className="size-3.5" />
          </Button>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="size-7 shrink-0 rounded-md text-muted-foreground/70 hover:bg-foreground/5 hover:text-foreground disabled:opacity-30"
          onClick={handleOpenContextUsageReport}
          disabled={!activeSessionId}
          aria-label="Open context usage report"
          title="Context Usage Report"
        >
          <GaugeIcon className="size-3.5" />
        </Button>
      </div>

      {activeBrowserTab && (
        <div className="relative flex h-10 shrink-0 items-center gap-2 border-b border-border/50 bg-card px-2">
          <div className="flex shrink-0 items-center gap-0.5">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="size-7 rounded-md text-muted-foreground/70 hover:bg-foreground/5 hover:text-foreground disabled:opacity-30"
              disabled={!activeBrowserTab?.canGoBack}
              onClick={() => {
                const bridge = readBrowserBridge()
                if (bridge && activeBrowserTabId) {
                  void runBrowserAction(async () => {
                    upsertOwnerState(
                      await bridge.goBack({ threadId: resolvedOwnerId, tabId: activeBrowserTabId }),
                    )
                  })
                }
              }}
              aria-label="Go back"
            >
              <ArrowLeftIcon className="size-3.5" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="size-7 rounded-md text-muted-foreground/70 hover:bg-foreground/5 hover:text-foreground disabled:opacity-30"
              disabled={!activeBrowserTab?.canGoForward}
              onClick={() => {
                const bridge = readBrowserBridge()
                if (bridge && activeBrowserTabId) {
                  void runBrowserAction(async () => {
                    upsertOwnerState(
                      await bridge.goForward({
                        threadId: resolvedOwnerId,
                        tabId: activeBrowserTabId,
                      }),
                    )
                  })
                }
              }}
              aria-label="Go forward"
            >
              <ArrowRightIcon className="size-3.5" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="size-7 rounded-md text-muted-foreground/70 hover:bg-foreground/5 hover:text-foreground"
              disabled={!nativeBrowserAvailable || !activeBrowserTabId}
              onClick={() => {
                const bridge = readBrowserBridge()
                if (bridge && activeBrowserTabId) {
                  void runBrowserAction(async () => {
                    upsertOwnerState(
                      await bridge.reload({
                        threadId: resolvedOwnerId,
                        tabId: activeBrowserTabId,
                      }),
                    )
                  })
                }
              }}
              aria-label="Reload"
            >
              <RefreshCwIcon
                className={cn('size-3.5', activeBrowserTab?.isLoading && 'animate-spin')}
              />
            </Button>
          </div>

          <form className="relative min-w-0 flex-1" onSubmit={handleAddressSubmit}>
            <Input
              type="text"
              value={addressValue}
              placeholder="Search or enter address"
              aria-label="Search or enter address"
              disabled={!nativeBrowserAvailable || !activeBrowserTab}
              className="h-7 w-full rounded-md border-0 bg-foreground/5 px-3 text-xs shadow-none placeholder:text-muted-foreground/50 focus:bg-foreground/8 focus-visible:ring-0 md:text-xs"
              onFocus={() => {
                setIsEditingAddress(true)
                setSuggestionsOpen(true)
              }}
              onBlur={() => {
                window.setTimeout(() => {
                  setIsEditingAddress(false)
                  setSuggestionsOpen(false)
                }, 120)
              }}
              onChange={(event) => {
                const nextValue = event.target.value
                setAddressValue(nextValue)
                if (activeBrowserTabId) {
                  addressDraftByTabIdRef.current.set(activeBrowserTabId, nextValue)
                }
                setSuggestionsOpen(true)
              }}
            />
            {suggestionsOpen && suggestions.length > 0 && (
              <div
                className="absolute left-0 right-0 top-8 z-20 overflow-hidden rounded-md border border-border bg-popover py-1 shadow-lg"
                {...BROWSER_NATIVE_SURFACE_OCCLUSION_PROPS}
              >
                {suggestions.map(suggestion => (
                  <Button
                    key={suggestion.id}
                    type="button"
                    variant="ghost"
                    className="h-auto w-full min-w-0 justify-start gap-2 rounded-none px-2 py-1.5 text-left text-xs font-normal hover:bg-foreground/5"
                    onMouseDown={event => event.preventDefault()}
                    onClick={() => handleSuggestion(suggestion)}
                  >
                    {suggestion.faviconUrl && (
                      <img
                        src={suggestion.faviconUrl}
                        alt=""
                        className="size-3.5 shrink-0 rounded-sm"
                      />
                    )}
                    {!suggestion.faviconUrl && (
                      <GlobeIcon
                        className="size-3.5 shrink-0 !text-muted-foreground/60"
                        aria-hidden="true"
                      />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-foreground">{suggestion.title}</span>
                      <span className="block truncate text-[10px] text-muted-foreground">
                        {suggestion.detail}
                      </span>
                    </span>
                  </Button>
                ))}
              </div>
            )}
          </form>

          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="size-7 shrink-0 rounded-md text-muted-foreground/70 hover:bg-foreground/5 hover:text-foreground disabled:opacity-30"
            disabled={!nativeBrowserAvailable || !activeBrowserTabId}
            onClick={handleCaptureScreenshot}
            aria-label="Attach screenshot to composer"
          >
            <CameraIcon className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={cn(
              'h-7 shrink-0 gap-1 rounded-md px-2 text-xs disabled:opacity-30',
              hasActiveAnnotationSession
                ? 'bg-primary/12 text-primary hover:bg-primary/16'
                : 'text-muted-foreground/70 hover:bg-foreground/5 hover:text-foreground',
            )}
            disabled={!nativeBrowserAvailable || !activeBrowserTabId}
            onClick={hasActiveAnnotationSession ? handleCancelAnnotation : handleStartAnnotation}
            aria-label={
              hasActiveAnnotationSession
                ? t('browser.annotation.cancel' as ChromeKey)
                : t('browser.annotation.comment' as ChromeKey)
            }
            title={t('browser.annotation.toggleTitle' as ChromeKey)}
          >
            <MessageSquarePlusIcon className="size-3.5" />
            <span>{t('browser.annotation.comment' as ChromeKey)}</span>
          </Button>
        </div>
      )}

      {chromeStatus && (
        <div
          className={cn(
            'flex h-7 shrink-0 items-center border-b px-3 text-[11px]',
            chromeStatus.tone === 'error'
              ? 'border-destructive/20 bg-destructive/8 text-destructive'
              : 'border-border/40 bg-muted/40 text-muted-foreground',
          )}
        >
          {chromeStatus.label}
        </div>
      )}

      <div className="relative min-h-0 flex-1 overflow-hidden bg-background">
        {activePanelTab?.kind === 'browser' && (
          <div className="absolute inset-0 flex min-h-0 flex-col bg-background">
            <div ref={viewportRef} className="relative min-h-0 flex-1 bg-background">
              <div ref={browserWebviewHostRef} className="absolute inset-0" />
              {!nativeBrowserAvailable && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background px-6 text-center text-xs text-muted-foreground">
                  <GlobeIcon className="size-9 opacity-40" />
                  <p>Native browser pages are available in the desktop app.</p>
                </div>
              )}
              {nativeBrowserAvailable && activeBrowserTabIsBlank && (
                <BrowserNewTabSurface
                  localServers={localServers}
                  localServersLoading={localServersLoading}
                  localServersError={localServersError}
                  onOpenUrl={navigateActiveTab}
                  onRefreshLocalServers={refreshLocalServers}
                />
              )}
              {!hasActiveAnnotationSession && (
                <BrowserAnnotationRail
                  annotations={activeBrowserAnnotations}
                  collapsed={annotationTrayCollapsed}
                  onCollapsedChange={collapsed =>
                    setAnnotationTrayCollapsed(collapsed, resolvedOwnerId)}
                  onClear={() =>
                    clearAnnotations({ ownerId: resolvedOwnerId, tabId: activeBrowserTabId })}
                  onEdit={handleEditSavedAnnotation}
                  onDelete={annotationId => deleteAnnotation(annotationId, resolvedOwnerId)}
                  onSend={handleSendSavedAnnotation}
                />
              )}
            </div>
          </div>
        )}

        {activePanelTab?.kind === 'workspace-file' && activePanelTab.view === 'preview' && (
          <WorkspaceFilePreview
            workspaceId={activePanelTab.workspaceId}
            path={activePanelTab.path}
            onOpenEditor={(path) => {
              openWorkspaceFileTab({
                workspaceId: activePanelTab.workspaceId,
                path,
                view: 'editor',
                ownerId: resolvedOwnerId,
              })
            }}
            onAddLineComment={
              activeSessionId
                ? ({ workspaceId, path, lineNumber, comment }) => {
                    submitChatComposerContextIngress(activeSessionId, [
                      {
                        type: 'data-cradle-file-line-comment',
                        workspaceId,
                        path,
                        lineStart: lineNumber,
                        lineEnd: lineNumber,
                        comment,
                      },
                    ])
                  }
                : undefined
            }
          />
        )}

        {activePanelTab?.kind === 'workspace-file' && activePanelTab.view === 'editor' && (
          <WorkspaceFileEditor
            workspaceId={activePanelTab.workspaceId}
            path={activePanelTab.path}
          />
        )}

        {activePanelTab?.kind === 'workspace-diff' && (
          <WorkspaceDiffViewer
            ownerId={resolvedOwnerId}
            tabId={activePanelTab.id}
            workspaceId={activePanelTab.workspaceId}
            repositoryPath={activePanelTab.repositoryPath}
            paths={activePanelTab.paths}
          />
        )}

        {activePanelTab?.kind === 'pull-request' && (
          <PullRequestDetailPanel
            owner={activePanelTab.owner}
            repo={activePanelTab.repo}
            number={activePanelTab.number}
            workId={activePanelTab.workId}
          />
        )}

        {activePanelTab?.kind === 'subagent' && (
          <SubagentOutputPanel
            sessionId={activePanelTab.sessionId}
            threadId={activePanelTab.threadId}
            agentName={activePanelTab.agentName}
            agentRole={activePanelTab.agentRole}
          />
        )}

        {activePanelTab?.kind === 'workflow' && (
          <WorkflowOutputPanel tab={activePanelTab} />
        )}

        {activePanelTab?.kind === 'side-conversation' && (
          <SideConversationPanel
            sideConversationId={activePanelTab.sideConversationId}
            parentSessionId={activePanelTab.parentSessionId}
            title={activePanelTab.title}
          />
        )}

        {activePanelTab?.kind === 'context-usage-report' && (
          <ContextUsageReport
            sessionId={activePanelTab.sessionId}
            sessionTitle={activePanelTab.sessionTitle}
          />
        )}

        {activePanelTab?.kind === 'launcher' && (
          <BrowserPanelCreateSurface
            canCreateTui={canCreateTuiTab}
            browserPending={newTabRequestPending}
            onCreateBrowser={() => handleCreateBrowserTab(activePanelTab.id)}
            onCreateTui={() => handleCreateTuiTab(activePanelTab.id)}
          />
        )}

        {activePanelTab?.kind === 'tui' && (
          <div className="absolute inset-0 bg-background">
            <Suspense
              fallback={(
                <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                  Preparing terminal
                </div>
              )}
            >
              <BrowserTuiShellView
                ptyId={activePanelTab.ptyId}
                cwd={activePanelTab.cwd}
                visible={activePanelTab.id === resolvedActivePanelTabId}
                stopOnUnmount={false}
                onMetadata={metadata => handleTuiMetadata(activePanelTab.id, metadata)}
                onExited={() => handleTuiExited(activePanelTab.id)}
              />
            </Suspense>
          </div>
        )}

        {activePanelTab?.kind === 'plan-document' && (
          <PlanDocumentViewer title={activePanelTab.title} text={activePanelTab.text} />
        )}

        {activePanelTab?.kind === 'plan-refine' && (
          <PlanRefineEditor
            tabId={activePanelTab.id}
            title={activePanelTab.title}
            text={activePanelTab.text}
          />
        )}

        {!activePanelTab && (
          <BrowserPanelCreateSurface
            canCreateTui={canCreateTuiTab}
            browserPending={newTabRequestPending}
            onCreateBrowser={() => handleCreateBrowserTab()}
            onCreateTui={() => handleCreateTuiTab()}
          />
        )}
      </div>
    </div>
  )
}
