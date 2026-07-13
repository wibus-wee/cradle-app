// FILE: browser-manager.ts
// Purpose: Owns Cradle's desktop in-app browser runtime and maps owner/tab state onto Electron WebContentsView.
// Layer: Desktop runtime manager
// Depends on: Electron BrowserWindow/WebContentsView, browser IPC contracts

import * as Crypto from 'node:crypto'

import type { BrowserWindow, WebContents } from 'electron'
import {
  clipboard,
  nativeImage,
  shell,
  webContents as electronWebContents,
  WebContentsView,
} from 'electron'

import { browserSessionPartition } from '../shared/browser-session'
import { resolveDesktopBrowserPanelPreloadPath } from './desktop-assets'

export type ThreadId = string

export interface BrowserPanelBounds {
  x: number
  y: number
  width: number
  height: number
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
  threadId: ThreadId
  version: number
  open: boolean
  activeTabId: string | null
  tabs: BrowserTabState[]
  lastError: string | null
}

export interface BrowserOpenInput {
  threadId: ThreadId
  initialUrl?: string
}

export interface BrowserThreadInput {
  threadId: ThreadId
}

export interface BrowserSetPanelBoundsInput {
  threadId: ThreadId
  bounds: BrowserPanelBounds | null
  surface?: 'native' | 'renderer'
}

export interface BrowserTabInput {
  threadId: ThreadId
  tabId?: string
}

export interface BrowserAttachWebviewInput extends BrowserTabInput {
  tabId: string
  webContentsId: number
}

export interface BrowserDetachWebviewInput extends BrowserTabInput {
  tabId: string
  webContentsId: number
}

export interface BrowserNavigateInput extends BrowserTabInput {
  url: string
}

export interface BrowserNewTabInput extends BrowserThreadInput {
  url?: string
  activate?: boolean
}

export interface BrowserCaptureScreenshotResult {
  name: string
  mimeType: 'image/png'
  sizeBytes: number
  bytes: Uint8Array
}

export interface BrowserExecuteCdpInput extends BrowserTabInput {
  method: string
  params?: Record<string, unknown>
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

export interface BrowserAnnotationDesignInput extends BrowserTabInput {
  selector: string
  designChange: BrowserAnnotationDesignChange
}

export type BrowserAnnotationAnchor
  = | { kind: 'point', x: number, y: number, scrollY?: number }
    | { kind: 'region', x: number, y: number, width: number, height: number, scrollY?: number }
    | { kind: 'text', text: string, x: number, y: number, width: number, height: number, scrollY?: number }
    | { kind: 'element', element: BrowserAnnotationElement }

export interface BrowserAnnotationRuntimeAnnotation {
  id: string
  anchor: BrowserAnnotationAnchor
  body: string
  designChange?: BrowserAnnotationDesignChange | null
  status?: 'saved' | 'sent'
}

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

export interface BrowserAnnotationRuntimeInput extends BrowserTabInput {
  annotations?: BrowserAnnotationRuntimeAnnotation[]
  editAnnotationId?: string | null
  layoutHints?: BrowserAnnotationLayoutHint[]
}

export interface BrowserAnnotationRuntimeNotificationInput extends BrowserTabInput {
  message: string
  tone?: 'neutral' | 'success' | 'error'
}

export interface BrowserAnnotationRuntimeEvent {
  threadId: ThreadId
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
  annotations?: BrowserAnnotationRuntimeAnnotation[]
  layoutHints?: BrowserAnnotationLayoutHint[]
  attachedImages?: BrowserPromptAttachmentInput[]
  designChange?: BrowserAnnotationDesignChange | null
  elements?: BrowserAnnotationElement[]
  surfaceSize?: {
    width: number
    height: number
  }
  sourceUrl: string | null
  sourceTitle: string | null
}

export interface BrowserPromptAttachmentInput {
  filename?: string
  mediaType?: string
  url: string
}

export interface BrowserPromptRequest {
  threadId: ThreadId
  tabId: string
  text: string
  attachments: BrowserPromptAttachmentInput[]
  sourceUrl: string | null
  sourceTitle: string | null
}

export interface BrowserLocalServer {
  port: number
  url: string
  title: string
  statusCode: number | null
}

const ABOUT_BLANK_URL = 'about:blank'
const BROWSER_INACTIVE_TAB_SUSPEND_DELAY_MS = 1_500
const BROWSER_INACTIVE_TAB_SUSPEND_DELAY_PRESSURED_MS = 400
const BROWSER_MAX_WARM_INACTIVE_RUNTIMES_PER_THREAD = 1
const BROWSER_THREAD_SUSPEND_DELAY_MS = 30_000
const BROWSER_ERROR_ABORTED = -3
const SEARCH_URL_PREFIX = 'https://www.google.com/search?q='
const HIDDEN_BROWSER_BOUNDS: BrowserPanelBounds = { x: -10000, y: -10000, width: 1, height: 1 }
const LOCAL_SERVER_DISCOVERY_TIMEOUT_MS = 650
const LOCAL_SERVER_DISCOVERY_LIMIT = 12
const LOCAL_SERVER_CANDIDATE_PORTS = [
  3000,
  3001,
  3002,
  3003,
  3333,
  4000,
  4173,
  5000,
  5173,
  5174,
  5175,
  5176,
  6006,
  7000,
  7331,
  8000,
  8080,
  8787,
  9000,
  10000,
  21423,
  21424,
] as const
const BROWSER_ANNOTATION_RUNTIME_GLOBAL = '__CRADLE_BROWSER_ANNOTATION_RUNTIME__'
const BROWSER_ANNOTATION_RUNTIME_COMMAND_CHANNEL = 'desktop:browser-annotation-runtime-command'
const _BROWSER_ANNOTATION_RUNTIME_INSTALL_EXPRESSION = `(() => {
  const runtimeKey = ${JSON.stringify(BROWSER_ANNOTATION_RUNTIME_GLOBAL)};
  if (window[runtimeKey]) {
    return true;
  }

  const MAX_ELEMENTS = 250;
  const MIN_AREA = 16;
  const DESIGN_GROUP_ATTRIBUTE = 'data-cradle-browser-design-group';
  const DESIGN_GROUP_NAME = 'active';
  const DRAFT_STYLE_ID = 'cradle-browser-design-draft-style';
  const interactiveTags = new Set(['A', 'BUTTON', 'INPUT', 'TEXTAREA', 'SELECT', 'SUMMARY']);
  let selectedElement = null;

  function cssPath(element) {
    const parts = [];
    let current = element;
    while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.body) {
      const tag = current.tagName.toLowerCase();
      if (current.id) {
        parts.unshift(tag + '#' + CSS.escape(current.id));
        break;
      }
      const classes = Array.from(current.classList || [])
        .slice(0, 2)
        .map((name) => '.' + CSS.escape(name))
        .join('');
      let index = 1;
      let sibling = current.previousElementSibling;
      while (sibling) {
        if (sibling.tagName === current.tagName) {
          index += 1;
        }
        sibling = sibling.previousElementSibling;
      }
      parts.unshift(tag + classes + ':nth-of-type(' + index + ')');
      current = current.parentElement;
    }
    return parts.join(' > ');
  }

  function labelFor(element) {
    const aria = element.getAttribute('aria-label')
      || element.getAttribute('alt')
      || element.getAttribute('title')
      || element.getAttribute('placeholder')
      || '';
    const value = typeof element.value === 'string' ? element.value : '';
    const text = aria || value || element.innerText || element.textContent || '';
    return text.replace(/\\s+/g, ' ').trim().slice(0, 140);
  }

  function nearbyTextFor(element) {
    const text = element.innerText || element.textContent || '';
    return text.replace(/\\s+/g, ' ').trim().slice(0, 400);
  }

  function implicitRole(element) {
    const explicit = element.getAttribute('role');
    if (explicit) {
      return explicit;
    }
    switch (element.tagName) {
      case 'A':
        return element.hasAttribute('href') ? 'link' : '';
      case 'BUTTON':
        return 'button';
      case 'IMG':
        return 'img';
      case 'INPUT': {
        const type = (element.getAttribute('type') || 'text').toLowerCase();
        if (type === 'checkbox') return 'checkbox';
        if (type === 'radio') return 'radio';
        if (type === 'range') return 'slider';
        if (type === 'submit' || type === 'button' || type === 'reset') return 'button';
        return 'textbox';
      }
      case 'TEXTAREA':
        return 'textbox';
      case 'SELECT':
        return 'combobox';
      case 'H1':
      case 'H2':
      case 'H3':
      case 'H4':
      case 'H5':
      case 'H6':
        return 'heading';
      case 'NAV':
        return 'navigation';
      case 'MAIN':
        return 'main';
      case 'FORM':
        return 'form';
      case 'TABLE':
        return 'table';
      case 'VIDEO':
        return 'video';
      default:
        return '';
    }
  }

  function attributesFor(element) {
    const href = element instanceof HTMLAnchorElement ? element.href : element.getAttribute('href');
    const value = typeof element.value === 'string' ? element.value : '';
    return {
      id: element.id || undefined,
      className: element.className && typeof element.className === 'string'
        ? element.className.slice(0, 160)
        : undefined,
      ariaLabel: element.getAttribute('aria-label') || undefined,
      title: element.getAttribute('title') || undefined,
      alt: element.getAttribute('alt') || undefined,
      href: href || undefined,
      type: element.getAttribute('type') || undefined,
      name: element.getAttribute('name') || undefined,
      placeholder: element.getAttribute('placeholder') || undefined,
      value: value ? value.slice(0, 120) : undefined,
      testId: element.getAttribute('data-testid') || element.getAttribute('data-test-id') || undefined,
    };
  }

  function descriptionFor(attributes) {
    const parts = [];
    if (attributes.href) parts.push('href=' + attributes.href);
    if (attributes.placeholder) parts.push('placeholder=' + attributes.placeholder);
    if (attributes.name) parts.push('name=' + attributes.name);
    if (attributes.type) parts.push('type=' + attributes.type);
    if (attributes.testId) parts.push('testid=' + attributes.testId);
    return parts.join(' · ').slice(0, 220);
  }

  function semanticScore(element, label, role) {
    let score = 0;
    if (interactiveTags.has(element.tagName)) score += 80;
    if (role) score += 40;
    if (label) score += 30;
    if (element.getAttribute('data-testid') || element.getAttribute('data-test-id')) score += 20;
    if (['H1', 'H2', 'H3', 'H4', 'H5', 'H6'].includes(element.tagName)) score += 18;
    if (['IMG', 'SVG', 'VIDEO', 'CANVAS'].includes(element.tagName)) score += 14;
    return score;
  }

  function isCandidate(element, rect, style, label, role, viewportWidth, viewportHeight) {
    if (rect.width <= 0 || rect.height <= 0 || rect.width * rect.height < MIN_AREA) {
      return false;
    }
    if (rect.right < 0 || rect.bottom < 0 || rect.left > viewportWidth || rect.top > viewportHeight) {
      return false;
    }
    if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) {
      return false;
    }
    if (element.closest('[aria-hidden="true"], script, style, meta, link, noscript')) {
      return false;
    }
    const hasSemanticSignal = label
      || interactiveTags.has(element.tagName)
      || role
      || ['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'IMG', 'SVG', 'VIDEO', 'CANVAS'].includes(element.tagName);
    return Boolean(hasSemanticSignal);
  }

  function readElement(element, index) {
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    const label = labelFor(element);
    const role = implicitRole(element);
    if (!isCandidate(element, rect, style, label, role, viewportWidth, viewportHeight)) {
      return null;
    }
    const attributes = attributesFor(element);
    return {
      id: 'element-' + index,
      tagName: element.tagName,
      label,
      description: descriptionFor(attributes),
      role,
      selector: cssPath(element),
      attributes,
      pageUrl: window.location.href,
      nearbyText: nearbyTextFor(element),
      score: semanticScore(element, label, role),
      area: Math.max(1, rect.width * rect.height),
      rect: {
        x: Math.max(0, Math.min(viewportWidth, rect.left)),
        y: Math.max(0, Math.min(viewportHeight, rect.top)),
        width: Math.max(1, Math.min(viewportWidth, rect.right) - Math.max(0, rect.left)),
        height: Math.max(1, Math.min(viewportHeight, rect.bottom) - Math.max(0, rect.top)),
      },
      styles: {
        color: style.color,
        backgroundColor: style.backgroundColor,
        opacity: style.opacity,
        fontFamily: style.fontFamily,
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        lineHeight: style.lineHeight,
        borderRadius: style.borderRadius,
        borderColor: style.borderColor,
        borderWidth: style.borderWidth,
        display: style.display,
        alignItems: style.alignItems,
        justifyContent: style.justifyContent,
        flexDirection: style.flexDirection,
        width: style.width,
        height: style.height,
        marginTop: style.marginTop,
        marginRight: style.marginRight,
        marginBottom: style.marginBottom,
        marginLeft: style.marginLeft,
        paddingTop: style.paddingTop,
        paddingRight: style.paddingRight,
        paddingBottom: style.paddingBottom,
        paddingLeft: style.paddingLeft,
        rowGap: style.rowGap,
        columnGap: style.columnGap,
      },
    };
  }

  function scanElements() {
    return Array.from(document.querySelectorAll('body *'))
      .map(readElement)
      .filter(Boolean)
      .sort((a, b) => (b.score - a.score) || (b.area - a.area))
      .map(({ score, area, ...element }) => element)
      .slice(0, MAX_ELEMENTS);
  }

  function clearSelection() {
    if (selectedElement) {
      selectedElement.removeAttribute(DESIGN_GROUP_ATTRIBUTE);
      selectedElement = null;
    }
  }

  function selectElement(selector) {
    clearSelection();
    const element = typeof selector === 'string' ? document.querySelector(selector) : null;
    if (!element) {
      return null;
    }
    selectedElement = element;
    element.setAttribute(DESIGN_GROUP_ATTRIBUTE, DESIGN_GROUP_NAME);
    const rect = element.getBoundingClientRect();
    if (rect.top < 0 || rect.bottom > window.innerHeight) {
      element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
    }
    return readElement(element, 0);
  }

  function draftStyleElement() {
    let style = document.getElementById(DRAFT_STYLE_ID);
    if (!style) {
      style = document.createElement('style');
      style.id = DRAFT_STYLE_ID;
      style.setAttribute('data-cradle-browser-runtime', 'annotation-design');
      document.head.appendChild(style);
    }
    return style;
  }

  function cssDeclaration(property, value) {
    if (typeof value !== 'string' || !value.trim()) {
      return null;
    }
    return property + ': ' + value.trim().replace(/[;{}]/g, '') + ' !important;';
  }

  function applyDesign(selector, designChange) {
    const element = selectElement(selector);
    if (!element) {
      clearDesign();
      return null;
    }
    const rows = [
      cssDeclaration('color', designChange && designChange.color),
      cssDeclaration('background-color', designChange && designChange.backgroundColor),
      cssDeclaration('opacity', designChange && designChange.opacity),
      cssDeclaration('font-family', designChange && designChange.fontFamily),
      cssDeclaration('font-size', designChange && designChange.fontSize),
      cssDeclaration('font-weight', designChange && designChange.fontWeight),
      cssDeclaration('border-radius', designChange && designChange.borderRadius),
      cssDeclaration('border-color', designChange && designChange.borderColor),
      cssDeclaration('border-width', designChange && designChange.borderWidth),
      cssDeclaration('display', designChange && designChange.display),
      cssDeclaration('align-items', designChange && designChange.alignItems),
      cssDeclaration('justify-content', designChange && designChange.justifyContent),
      cssDeclaration('flex-direction', designChange && designChange.flexDirection),
      cssDeclaration('width', designChange && designChange.width),
      cssDeclaration('height', designChange && designChange.height),
      cssDeclaration('margin-top', designChange && designChange.marginTop),
      cssDeclaration('margin-right', designChange && designChange.marginRight),
      cssDeclaration('margin-bottom', designChange && designChange.marginBottom),
      cssDeclaration('margin-left', designChange && designChange.marginLeft),
      cssDeclaration('padding-top', designChange && designChange.paddingTop),
      cssDeclaration('padding-right', designChange && designChange.paddingRight),
      cssDeclaration('padding-bottom', designChange && designChange.paddingBottom),
      cssDeclaration('padding-left', designChange && designChange.paddingLeft),
      cssDeclaration('row-gap', designChange && designChange.rowGap),
      cssDeclaration('column-gap', designChange && designChange.columnGap),
    ].filter(Boolean);
    draftStyleElement().textContent = rows.length > 0
      ? '[' + DESIGN_GROUP_ATTRIBUTE + '="' + DESIGN_GROUP_NAME + '"] { ' + rows.join(' ') + ' }'
      : '';
    return readElement(selectedElement, 0);
  }

  function clearDesign() {
    clearSelection();
    const style = document.getElementById(DRAFT_STYLE_ID);
    if (style) {
      style.remove();
    }
    return true;
  }

  window[runtimeKey] = {
    scanElements,
    selectElement,
    applyDesign,
    clearDesign,
  };
  return true;
})()`

type BrowserStateListener = (state: ThreadBrowserState) => void
type BrowserWebContentsListener = (webContents: WebContents, tabId: string) => void
type BrowserPromptRequestListener = (request: BrowserPromptRequest) => void
type BrowserAnnotationRuntimeEventListener = (event: BrowserAnnotationRuntimeEvent) => void

interface LiveTabRuntime {
  key: string
  threadId: ThreadId
  tabId: string
  webContents: WebContents
  view: WebContentsView | null
  ownsWebContents: boolean
  listenerDisposers: Array<() => void>
}

interface NativeBrowserViewVisibility {
  setVisible?: (visible: boolean) => void
}

interface PendingRuntimeSync {
  threadId: ThreadId
  tabId: string
  faviconUrls?: string[]
}

const LIVE_TAB_STATUS: BrowserTabState['status'] = 'live'
const SUSPENDED_TAB_STATUS: BrowserTabState['status'] = 'suspended'
const BROWSER_PROMPT_ATTACHMENT_LIMIT = 16
const BROWSER_PERFORMANCE_THREAD_LIMIT = 32
const BROWSER_PERFORMANCE_TAB_LIMIT = 64
const BROWSER_PERFORMANCE_RUNTIME_LIMIT = 64
const BROWSER_DIAGNOSTIC_TEXT_LIMIT = 512

interface BrowserPerformanceTabSnapshot {
  id: string
  status: BrowserTabState['status']
  active: boolean
  loading: boolean
  hasRuntime: boolean
  webContentsId: number | null
  chromiumProcessId: number | null
  osProcessId: number | null
  url: string | null
  title: string | null
  lastCommittedUrl: string | null
  lastError: string | null
}

interface BrowserPerformanceThreadSnapshot {
  threadId: ThreadId
  open: boolean
  active: boolean
  activeTabId: string | null
  tabCount: number
  liveTabCount: number
  suspendedTabCount: number
  runtimeCount: number
  activeBounds: BrowserPanelBounds | null
  lastError: string | null
  tabs: BrowserPerformanceTabSnapshot[]
}

interface BrowserPerformanceRuntimeSnapshot {
  key: string
  threadId: ThreadId
  tabId: string
  attached: boolean
  webContentsId: number
  chromiumProcessId: number | null
  osProcessId: number | null
  destroyed: boolean
  loading: boolean
  debuggerAttached: boolean
  url: string | null
  title: string | null
}

interface BrowserPerformanceSnapshot {
  counters: {
    setPanelBoundsCalls: number
    setPanelBoundsNoopSkips: number
    setPanelBoundsViewportUpdates: number
    stateEmitCalls: number
    stateEmitSkips: number
    stateCloneCount: number
    runtimeSyncQueueFlushes: number
    syncRuntimeStateCalls: number
    captureScreenshotCalls: number
    copyScreenshotToClipboardCalls: number
    captureScreenshotPngCalls: number
    capturedScreenshotBytes: number
    lastScreenshotBytes: number
    lastScreenshotAt: number | null
    inactiveTabSuspendScheduled: number
    inactiveTabSuspendCancelled: number
    inactiveTabBudgetEvictions: number
    warmInactiveRuntimeCount: number
  }
  trackedProcessIds: number[]
  trackedOSProcessIds: number[]
  panel: {
    windowAttached: boolean
    activeThreadId: ThreadId | null
    activeBoundsThreadId: ThreadId | null
    activeBounds: BrowserPanelBounds | null
    attachedRuntimeKey: string | null
    attachedBoundsSignature: string | null
    stateCount: number
    openThreadCount: number
    runtimeCount: number
    pendingRuntimeSyncCount: number
    runtimeSyncFlushScheduled: boolean
    listenerCount: number
    webContentsListenerCount: number
    promptRequestListenerCount: number
    annotationRuntimeEventListenerCount: number
  }
  limits: {
    threadLimit: number
    tabLimit: number
    runtimeLimit: number
    truncatedThreads: number
    truncatedTabs: number
    truncatedRuntimes: number
  }
  threads: BrowserPerformanceThreadSnapshot[]
  runtimes: BrowserPerformanceRuntimeSnapshot[]
}

export interface BrowserUseSnapshot {
  threadId: ThreadId
  state: ThreadBrowserState
}

export interface BrowserUseCdpEvent {
  method: string
  params?: unknown
}

function createBrowserTab(url = ABOUT_BLANK_URL): BrowserTabState {
  return {
    id: Crypto.randomUUID(),
    url,
    title: defaultTitleForUrl(url),
    status: SUSPENDED_TAB_STATUS,
    isLoading: false,
    canGoBack: false,
    canGoForward: false,
    faviconUrl: null,
    lastCommittedUrl: null,
    lastError: null,
  }
}

function defaultThreadBrowserState(threadId: ThreadId): ThreadBrowserState {
  return {
    threadId,
    version: 0,
    open: false,
    activeTabId: null,
    tabs: [],
    lastError: null,
  }
}

function cloneThreadState(state: ThreadBrowserState): ThreadBrowserState {
  return {
    ...state,
    tabs: state.tabs.map(tab => ({ ...tab })),
  }
}

function defaultTitleForUrl(url: string): string {
  if (url === ABOUT_BLANK_URL) {
    return 'New tab'
  }

  try {
    const parsed = new URL(url)
    return parsed.hostname || url
  }
 catch {
    return url
  }
}

function screenshotFileNameForUrl(url: string): string {
  const fallback = 'browser'
  try {
    const hostname = new URL(url).hostname.trim().toLowerCase()
    const normalizedHost = hostname.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    return `${normalizedHost || fallback}-${Date.now()}.png`
  }
 catch {
    return `${fallback}-${Date.now()}.png`
  }
}

function normalizeBounds(bounds: BrowserPanelBounds | null): BrowserPanelBounds | null {
  if (!bounds) { return null }
  if (
    !Number.isFinite(bounds.x)
    || !Number.isFinite(bounds.y)
    || !Number.isFinite(bounds.width)
    || !Number.isFinite(bounds.height)
  ) {
    return null
  }

  const width = Math.max(0, Math.floor(bounds.width))
  const height = Math.max(0, Math.floor(bounds.height))
  if (width === 0 || height === 0) {
    return null
  }

  return {
    x: Math.max(0, Math.floor(bounds.x)),
    y: Math.max(0, Math.floor(bounds.y)),
    width,
    height,
  }
}

function looksLikeUrlInput(value: string): boolean {
  return (
    value.includes('.')
    || value.startsWith('localhost')
    || value.startsWith('127.0.0.1')
    || value.startsWith('0.0.0.0')
    || value.startsWith('[::1]')
  )
}

function normalizeUrlInput(input: string | undefined): string {
  const trimmed = input?.trim() ?? ''
  if (trimmed.length === 0) {
    return ABOUT_BLANK_URL
  }

  try {
    const withScheme = new URL(trimmed)
    if (withScheme.protocol === 'http:' || withScheme.protocol === 'https:') {
      return withScheme.toString()
    }
    if (withScheme.protocol === 'about:') {
      return withScheme.toString()
    }
  }
 catch {
    // Fall through to heuristics below.
  }

  if (trimmed.includes(' ')) {
    return `${SEARCH_URL_PREFIX}${encodeURIComponent(trimmed)}`
  }

  if (looksLikeUrlInput(trimmed)) {
    const prefersHttp
      = trimmed.startsWith('localhost')
        || trimmed.startsWith('127.0.0.1')
        || trimmed.startsWith('0.0.0.0')
        || trimmed.startsWith('[::1]')
    const scheme = prefersHttp ? 'http' : 'https'
    try {
      return new URL(`${scheme}://${trimmed}`).toString()
    }
 catch {
      return `${SEARCH_URL_PREFIX}${encodeURIComponent(trimmed)}`
    }
  }

  return `${SEARCH_URL_PREFIX}${encodeURIComponent(trimmed)}`
}

function isAbortedNavigationError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false
  }
  return /ERR_ABORTED|\(-3\)/i.test(error.message)
}

function mapBrowserLoadError(errorCode: number): string {
  switch (errorCode) {
    case -102:
      return 'Connection refused.'
    case -105:
      return 'Couldn\'t resolve this address.'
    case -106:
      return 'You\'re offline.'
    case -118:
      return 'This page took too long to respond.'
    case -137:
      return 'A secure connection couldn\'t be established.'
    case -200:
      return 'A secure connection couldn\'t be established.'
    default:
      return 'Couldn\'t open this page.'
  }
}

function buildRuntimeKey(threadId: ThreadId, tabId: string): string {
  return `${threadId}:${tabId}`
}

function normalizeBrowserPromptPayload(
  payload: unknown,
): Pick<BrowserPromptRequest, 'text' | 'attachments'> | null {
  if (!payload || typeof payload !== 'object') {
    return null
  }

  const candidate = payload as {
    attachments?: unknown
    text?: unknown
  }
  const text = typeof candidate.text === 'string' ? candidate.text : ''
  const attachments = Array.isArray(candidate.attachments)
    ? candidate.attachments.flatMap(normalizeBrowserPromptAttachment).slice(0, BROWSER_PROMPT_ATTACHMENT_LIMIT)
    : []

  if (!text.trim() && attachments.length === 0) {
    return null
  }

  return {
    text,
    attachments,
  }
}

function normalizeBrowserPromptAttachment(value: unknown): BrowserPromptAttachmentInput[] {
  if (!value || typeof value !== 'object') {
    return []
  }

  const candidate = value as {
    filename?: unknown
    mediaType?: unknown
    url?: unknown
  }
  if (typeof candidate.url !== 'string' || !candidate.url.trim()) {
    return []
  }

  return [{
    ...(typeof candidate.filename === 'string' && candidate.filename.trim()
      ? { filename: candidate.filename.trim() }
      : {}),
    ...(typeof candidate.mediaType === 'string' && candidate.mediaType.trim()
      ? { mediaType: candidate.mediaType.trim() }
      : {}),
    url: candidate.url.trim(),
  }]
}

function readWebContentsUrl(webContents: WebContents): string | null {
  const url = webContents.getURL()
  return url.trim() ? url : null
}

function readWebContentsTitle(webContents: WebContents): string | null {
  const title = webContents.getTitle()
  return title.trim() ? title : null
}

function limitDiagnosticText(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? ''
  if (!trimmed) {
    return null
  }
  return trimmed.length > BROWSER_DIAGNOSTIC_TEXT_LIMIT
    ? `${trimmed.slice(0, BROWSER_DIAGNOSTIC_TEXT_LIMIT)}...`
    : trimmed
}

function redactDiagnosticUrl(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? ''
  if (!trimmed) {
    return null
  }

  try {
    const parsed = new URL(trimmed)
    parsed.search = ''
    parsed.hash = ''
    return limitDiagnosticText(parsed.toString())
  }
 catch {
    return limitDiagnosticText(trimmed)
  }
}

function readWebContentsChromiumProcessId(webContents: WebContents): number | null {
  try {
    const processId = webContents.getProcessId()
    return Number.isFinite(processId) && processId > 0 ? processId : null
  }
 catch {
    return null
  }
}

function readWebContentsOSProcessId(webContents: WebContents): number | null {
  try {
    const processId = webContents.getOSProcessId()
    return Number.isFinite(processId) && processId > 0 ? processId : null
  }
 catch {
    return null
  }
}

function readDiagnosticWebContentsUrl(webContents: WebContents): string | null {
  try {
    return redactDiagnosticUrl(readWebContentsUrl(webContents))
  }
 catch {
    return null
  }
}

function readDiagnosticWebContentsTitle(webContents: WebContents): string | null {
  try {
    return limitDiagnosticText(readWebContentsTitle(webContents))
  }
 catch {
    return null
  }
}

function readWebContentsLoading(webContents: WebContents): boolean {
  try {
    return webContents.isLoading()
  }
 catch {
    return false
  }
}

function readWebContentsDebuggerAttached(webContents: WebContents): boolean {
  try {
    return webContents.debugger.isAttached()
  }
 catch {
    return false
  }
}

function browserBoundsSignature(bounds: BrowserPanelBounds | null): string {
  if (!bounds) {
    return 'hidden'
  }

  return `${bounds.x}:${bounds.y}:${bounds.width}:${bounds.height}`
}

function isBlankBrowserTab(tab: BrowserTabState | null | undefined): boolean {
  if (!tab) {
    return true
  }
  const currentUrl = tab.url.trim()
  const committedUrl = tab.lastCommittedUrl?.trim() ?? ''
  return (
    (currentUrl.length === 0 || currentUrl === ABOUT_BLANK_URL)
    && (committedUrl.length === 0 || committedUrl === ABOUT_BLANK_URL)
  )
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function decodeTitleEntity(entity: string): string {
  switch (entity) {
    case 'amp':
      return '&'
    case 'lt':
      return '<'
    case 'gt':
      return '>'
    case 'quot':
      return '"'
    case '#39':
    case 'apos':
      return '\''
    default:
      return `&${entity};`
  }
}

function extractHtmlTitle(html: string): string | null {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  const rawTitle = normalizeWhitespace(match?.[1] ?? '')
  if (!rawTitle) {
    return null
  }
  return rawTitle.replace(/&([a-z0-9#]+);/gi, (_match, entity: string) =>
    decodeTitleEntity(entity))
}

function fallbackLocalServerTitle(port: number): string {
  return `localhost:${port}`
}

async function probeLocalServer(port: number): Promise<BrowserLocalServer | null> {
  const controller = new AbortController()
  const timeout = setTimeout(() => {
    controller.abort()
  }, LOCAL_SERVER_DISCOVERY_TIMEOUT_MS)
  timeout.unref?.()

  try {
    const response = await fetch(`http://localhost:${port}/`, {
      signal: controller.signal,
      redirect: 'manual',
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/json;q=0.8,*/*;q=0.5',
      },
    })
    const contentType = response.headers.get('content-type') ?? ''
    const title = contentType.includes('text/html')
      ? extractHtmlTitle(await response.text().catch(() => ''))
      : null
    return {
      port,
      url: `http://localhost:${port}/`,
      title: title ?? fallbackLocalServerTitle(port),
      statusCode: response.status,
    }
  }
 catch {
    return null
  }
 finally {
    clearTimeout(timeout)
  }
}

export class DesktopBrowserManager {
  private window: BrowserWindow | null = null
  private activeThreadId: ThreadId | null = null
  private activeBounds: BrowserPanelBounds | null = null
  private activeBoundsThreadId: ThreadId | null = null
  private attachedRuntimeKey: string | null = null
  private attachedBoundsSignature: string | null = null
  private readonly states = new Map<ThreadId, ThreadBrowserState>()
  private readonly threadVersionById = new Map<ThreadId, number>()
  private readonly snapshotCacheByThreadId = new Map<
    ThreadId,
    { version: number, snapshot: ThreadBrowserState }
  >()

  private readonly lastEmittedVersionByThreadId = new Map<ThreadId, number>()
  private readonly runtimes = new Map<string, LiveTabRuntime>()
  private readonly runtimeLastActiveAtByKey = new Map<string, number>()
  private readonly pendingRuntimeSyncs = new Map<string, PendingRuntimeSync>()
  private readonly listeners = new Set<BrowserStateListener>()
  private readonly webContentsListeners = new Set<BrowserWebContentsListener>()
  private readonly promptRequestListeners = new Set<BrowserPromptRequestListener>()
  private readonly annotationRuntimeEventListeners = new Set<BrowserAnnotationRuntimeEventListener>()
  private readonly tabSuspendTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly suspendTimers = new Map<ThreadId, ReturnType<typeof setTimeout>>()
  private runtimeSyncFlushScheduled = false
  private readonly perfCounters = {
    setPanelBoundsCalls: 0,
    setPanelBoundsNoopSkips: 0,
    setPanelBoundsViewportUpdates: 0,
    stateEmitCalls: 0,
    stateEmitSkips: 0,
    stateCloneCount: 0,
    runtimeSyncQueueFlushes: 0,
    syncRuntimeStateCalls: 0,
    captureScreenshotCalls: 0,
    copyScreenshotToClipboardCalls: 0,
    captureScreenshotPngCalls: 0,
    capturedScreenshotBytes: 0,
    lastScreenshotBytes: 0,
    lastScreenshotAt: null as number | null,
    inactiveTabSuspendScheduled: 0,
    inactiveTabSuspendCancelled: 0,
    inactiveTabBudgetEvictions: 0,
    warmInactiveRuntimeCount: 0,
  }

  setWindow(window: BrowserWindow | null): void {
    this.window = window
    if (window) {
      const bounds = this.activeThreadId
        ? this.getVisibleBoundsForThread(this.activeThreadId)
        : null
      if (this.activeThreadId && bounds) {
        this.attachActiveTab(this.activeThreadId, bounds)
      }
      return
    }

    this.detachAttachedRuntime()
    this.destroyAllRuntimes()
  }

  subscribe(listener: BrowserStateListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  subscribeToWebContentsCreated(listener: BrowserWebContentsListener): () => void {
    this.webContentsListeners.add(listener)
    return () => {
      this.webContentsListeners.delete(listener)
    }
  }

  subscribeToPromptRequests(listener: BrowserPromptRequestListener): () => void {
    this.promptRequestListeners.add(listener)
    return () => {
      this.promptRequestListeners.delete(listener)
    }
  }

  subscribeToAnnotationRuntimeEvents(listener: BrowserAnnotationRuntimeEventListener): () => void {
    this.annotationRuntimeEventListeners.add(listener)
    return () => {
      this.annotationRuntimeEventListeners.delete(listener)
    }
  }

  dispose(): void {
    for (const timer of this.suspendTimers.values()) {
      clearTimeout(timer)
    }
    this.suspendTimers.clear()
    for (const timer of this.tabSuspendTimers.values()) {
      clearTimeout(timer)
    }
    this.tabSuspendTimers.clear()
    this.detachAttachedRuntime()
    this.destroyAllRuntimes()
    this.pendingRuntimeSyncs.clear()
    this.runtimeLastActiveAtByKey.clear()
    this.listeners.clear()
    this.webContentsListeners.clear()
    this.promptRequestListeners.clear()
    this.annotationRuntimeEventListeners.clear()
    this.states.clear()
    this.threadVersionById.clear()
    this.snapshotCacheByThreadId.clear()
    this.lastEmittedVersionByThreadId.clear()
    this.window = null
    this.activeThreadId = null
    this.activeBounds = null
    this.activeBoundsThreadId = null
    this.attachedBoundsSignature = null
    this.runtimeSyncFlushScheduled = false
  }

  getPerformanceSnapshot(): BrowserPerformanceSnapshot {
    this.perfCounters.warmInactiveRuntimeCount = this.countWarmInactiveRuntimes()
    const stateEntries = [...this.states.entries()]
    const runtimeEntries = [...this.runtimes.values()]
    const runtimeCountByThreadId = new Map<ThreadId, number>()
    for (const runtime of runtimeEntries) {
      runtimeCountByThreadId.set(
        runtime.threadId,
        (runtimeCountByThreadId.get(runtime.threadId) ?? 0) + 1,
      )
    }
    const orderedStateEntries = stateEntries
      .map((entry, index) => {
        const [threadId, state] = entry
        const runtimeCount = runtimeCountByThreadId.get(threadId) ?? 0
        const rank
          = (threadId === this.activeThreadId ? 0 : 100)
            + (state.open ? 0 : 10)
            + (runtimeCount > 0 ? 0 : 1)
        return { entry, index, rank }
      })
      .sort((a, b) => a.rank - b.rank || a.index - b.index)
      .map(item => item.entry)
    const orderedRuntimeEntries = runtimeEntries
      .map((runtime, index) => {
        const rank
          = (runtime.key === this.attachedRuntimeKey ? 0 : 100)
            + (runtime.threadId === this.activeThreadId ? 0 : 10)
        return { runtime, index, rank }
      })
      .sort((a, b) => a.rank - b.rank || a.index - b.index)
      .map(item => item.runtime)

    let capturedTabCount = 0
    const totalTabCount = stateEntries.reduce((total, [, state]) => total + state.tabs.length, 0)
    const threads = orderedStateEntries
      .slice(0, BROWSER_PERFORMANCE_THREAD_LIMIT)
      .map(([threadId, state]) => {
        const orderedTabs = state.tabs
          .map((tab, index) => {
            const rank
              = (tab.id === state.activeTabId ? 0 : 100)
                + (tab.status === LIVE_TAB_STATUS ? 0 : 10)
            return { tab, index, rank }
          })
          .sort((a, b) => a.rank - b.rank || a.index - b.index)
          .map(item => item.tab)
        const tabs = orderedTabs
          .slice(0, BROWSER_PERFORMANCE_TAB_LIMIT)
          .map((tab) => {
            const runtime = this.runtimes.get(buildRuntimeKey(threadId, tab.id))
            const webContents = runtime?.webContents
            const webContentsDestroyed = webContents?.isDestroyed() ?? true
            return {
              id: tab.id,
              status: tab.status,
              active: state.activeTabId === tab.id,
              loading: tab.isLoading,
              hasRuntime: runtime !== undefined,
              webContentsId: webContents && !webContentsDestroyed ? webContents.id : null,
              chromiumProcessId: webContents && !webContentsDestroyed
                ? readWebContentsChromiumProcessId(webContents)
                : null,
              osProcessId: webContents && !webContentsDestroyed
                ? readWebContentsOSProcessId(webContents)
                : null,
              url: webContents && !webContentsDestroyed
                ? readDiagnosticWebContentsUrl(webContents)
                : redactDiagnosticUrl(tab.url),
              title: webContents && !webContentsDestroyed
                ? readDiagnosticWebContentsTitle(webContents)
                : limitDiagnosticText(tab.title),
              lastCommittedUrl: redactDiagnosticUrl(tab.lastCommittedUrl),
              lastError: limitDiagnosticText(tab.lastError),
            }
          })
        capturedTabCount += tabs.length

        return {
          threadId,
          open: state.open,
          active: this.activeThreadId === threadId,
          activeTabId: state.activeTabId,
          tabCount: state.tabs.length,
          liveTabCount: state.tabs.filter(tab => tab.status === LIVE_TAB_STATUS).length,
          suspendedTabCount: state.tabs.filter(tab => tab.status === SUSPENDED_TAB_STATUS).length,
          runtimeCount: runtimeCountByThreadId.get(threadId) ?? 0,
          activeBounds: this.activeBoundsThreadId === threadId ? this.activeBounds : null,
          lastError: limitDiagnosticText(state.lastError),
          tabs,
        }
      })

    const runtimes = orderedRuntimeEntries
      .slice(0, BROWSER_PERFORMANCE_RUNTIME_LIMIT)
      .map((runtime) => {
        const webContents = runtime.webContents
        const destroyed = webContents.isDestroyed()
        return {
          key: runtime.key,
          threadId: runtime.threadId,
          tabId: runtime.tabId,
          attached: this.attachedRuntimeKey === runtime.key,
          webContentsId: webContents.id,
          chromiumProcessId: destroyed ? null : readWebContentsChromiumProcessId(webContents),
          osProcessId: destroyed ? null : readWebContentsOSProcessId(webContents),
          destroyed,
          loading: destroyed ? false : readWebContentsLoading(webContents),
          debuggerAttached: destroyed ? false : readWebContentsDebuggerAttached(webContents),
          url: destroyed ? null : readDiagnosticWebContentsUrl(webContents),
          title: destroyed ? null : readDiagnosticWebContentsTitle(webContents),
        }
      })

    return {
      counters: { ...this.perfCounters },
      trackedProcessIds: this.getTrackedProcessIds(),
      trackedOSProcessIds: this.getTrackedOSProcessIds(),
      panel: {
        windowAttached: this.window !== null,
        activeThreadId: this.activeThreadId,
        activeBoundsThreadId: this.activeBoundsThreadId,
        activeBounds: this.activeBounds,
        attachedRuntimeKey: this.attachedRuntimeKey,
        attachedBoundsSignature: this.attachedBoundsSignature,
        stateCount: this.states.size,
        openThreadCount: stateEntries.filter(([, state]) => state.open).length,
        runtimeCount: this.runtimes.size,
        pendingRuntimeSyncCount: this.pendingRuntimeSyncs.size,
        runtimeSyncFlushScheduled: this.runtimeSyncFlushScheduled,
        listenerCount: this.listeners.size,
        webContentsListenerCount: this.webContentsListeners.size,
        promptRequestListenerCount: this.promptRequestListeners.size,
        annotationRuntimeEventListenerCount: this.annotationRuntimeEventListeners.size,
      },
      limits: {
        threadLimit: BROWSER_PERFORMANCE_THREAD_LIMIT,
        tabLimit: BROWSER_PERFORMANCE_TAB_LIMIT,
        runtimeLimit: BROWSER_PERFORMANCE_RUNTIME_LIMIT,
        truncatedThreads: Math.max(0, stateEntries.length - threads.length),
        truncatedTabs: Math.max(0, totalTabCount - capturedTabCount),
        truncatedRuntimes: Math.max(0, runtimeEntries.length - runtimes.length),
      },
      threads,
      runtimes,
    }
  }

  getBrowserUseSnapshot(): BrowserUseSnapshot | null {
    if (this.activeThreadId) {
      const activeState = this.states.get(this.activeThreadId)
      if (activeState?.open) {
        return {
          threadId: this.activeThreadId,
          state: this.snapshotThreadState(this.activeThreadId, activeState),
        }
      }
    }

    for (const [threadId, state] of this.states) {
      if (state.open) {
        return {
          threadId,
          state: this.snapshotThreadState(threadId, state),
        }
      }
    }
    return null
  }

  async discoverLocalServers(): Promise<BrowserLocalServer[]> {
    const results = await Promise.all(LOCAL_SERVER_CANDIDATE_PORTS.map(probeLocalServer))
    return results
      .filter((server): server is BrowserLocalServer => server !== null)
      .filter(server => server.statusCode !== null && server.statusCode >= 200 && server.statusCode < 300)
      .slice(0, LOCAL_SERVER_DISCOVERY_LIMIT)
  }

  open(input: BrowserOpenInput): ThreadBrowserState {
    const state = this.ensureWorkspace(input.threadId, input.initialUrl)
    const didChange = !state.open
    state.open = true
    const nextInitialUrl = input.initialUrl ? normalizeUrlInput(input.initialUrl) : null
    const activeTab = nextInitialUrl ? this.getActiveTab(state) : null
    if (nextInitialUrl && activeTab && activeTab.url !== nextInitialUrl) {
      return this.navigate({
        threadId: input.threadId,
        tabId: activeTab.id,
        url: nextInitialUrl,
      })
    }

    const nextDidChange = syncThreadLastError(state) || didChange

    if (
      this.activeBounds
      && this.activeBoundsThreadId === input.threadId
      && (this.activeThreadId === null || this.activeThreadId === input.threadId)
    ) {
      const visibleTab = this.getActiveTab(state)
      if (!isBlankBrowserTab(visibleTab)) {
        this.activateThread(input.threadId, this.activeBounds)
      }
    }

    if (nextDidChange) {
      this.markThreadStateChanged(input.threadId)
    }
    this.emitState(input.threadId)
    return this.snapshotThreadState(input.threadId, state)
  }

  close(input: BrowserThreadInput): ThreadBrowserState {
    this.clearSuspendTimer(input.threadId)

    if (this.activeThreadId === input.threadId) {
      this.detachAttachedRuntime()
      this.activeThreadId = null
    }
    this.clearActiveBoundsForThread(input.threadId)

    this.destroyThreadRuntimes(input.threadId)

    const state = this.getOrCreateState(input.threadId)
    state.open = false
    state.activeTabId = null
    state.tabs = []
    state.lastError = null
    this.markThreadStateChanged(input.threadId)
    this.lastEmittedVersionByThreadId.delete(input.threadId)
    this.emitState(input.threadId)
    return this.snapshotThreadState(input.threadId, state)
  }

  hide(input: BrowserThreadInput): void {
    const state = this.states.get(input.threadId)
    if (this.activeThreadId === input.threadId) {
      this.detachAttachedRuntime()
      this.activeThreadId = null
    }

    if (!state?.open) {
      return
    }

    this.scheduleThreadSuspend(input.threadId)
  }

  getState(input: BrowserThreadInput): ThreadBrowserState {
    return this.snapshotThreadState(input.threadId)
  }

  setPanelBounds(input: BrowserSetPanelBoundsInput): void {
    this.perfCounters.setPanelBoundsCalls += 1
    const state = this.getOrCreateState(input.threadId)
    const nextBounds = normalizeBounds(input.bounds)
    const nextBoundsSignature = browserBoundsSignature(nextBounds)
    const activeTabId = this.getActiveTab(state)?.id ?? null
    const activeRuntimeKey = activeTabId ? buildRuntimeKey(input.threadId, activeTabId) : null
    const activeRuntime = activeRuntimeKey ? this.runtimes.get(activeRuntimeKey) : null
    this.setActiveBounds(input.threadId, nextBounds)

    if (!state.open || nextBounds === null) {
      if (this.activeThreadId === input.threadId) {
        this.detachAttachedRuntime()
        this.activeThreadId = null
        this.scheduleThreadSuspend(input.threadId)
      }
      return
    }

    if (
      input.surface === 'native'
      && activeTabId
      && activeRuntime
      && !activeRuntime.ownsWebContents
    ) {
      this.destroyRuntime(input.threadId, activeTabId)
      const activeTab = this.getTab(state, activeTabId)
      if (activeTab) {
        suspendTabState(activeTab)
        this.markThreadStateChanged(input.threadId)
      }
      this.attachedRuntimeKey = null
      this.attachedBoundsSignature = null
    }

    if (input.surface === 'renderer' && activeTabId && !activeRuntime) {
      this.activateThreadForPendingRenderer(input.threadId, nextBounds)
      return
    }

    // Bounds sync fires often during panel motion. If the visible runtime and
    // applied viewport are already current, avoid waking the browser stack again.
    if (
      this.activeThreadId === input.threadId
      && this.attachedRuntimeKey === activeRuntimeKey
      && this.attachedBoundsSignature === nextBoundsSignature
    ) {
      this.perfCounters.setPanelBoundsNoopSkips += 1
      return
    }

    if (this.activeThreadId === input.threadId) {
      if (activeRuntimeKey && this.attachedRuntimeKey === activeRuntimeKey) {
        const runtime = this.runtimes.get(activeRuntimeKey)
        if (runtime) {
          this.perfCounters.setPanelBoundsViewportUpdates += 1
          this.attachRuntime(runtime, nextBounds)
          return
        }
      }
      this.attachActiveTab(input.threadId, nextBounds)
      return
    }

    this.activateThread(input.threadId, nextBounds)
  }

  attachWebview(input: BrowserAttachWebviewInput): ThreadBrowserState {
    const state = this.ensureWorkspace(input.threadId)
    const tab = this.resolveTab(state, input.tabId)
    const webContents = electronWebContents.fromId(input.webContentsId)
    if (!webContents || webContents.isDestroyed()) {
      throw new Error('The visible browser webview is not available.')
    }

    const key = buildRuntimeKey(input.threadId, tab.id)
    const existingRendererRuntime = this.findRendererRuntimeByWebContentsId(webContents.id)
    if (existingRendererRuntime && existingRendererRuntime.key !== key) {
      this.destroyRuntime(existingRendererRuntime.threadId, existingRendererRuntime.tabId)
    }

    const existing = this.runtimes.get(key)
    if (existing?.webContents.id !== webContents.id) {
      if (existing) {
        this.destroyRuntime(input.threadId, tab.id)
      }
      const runtime: LiveTabRuntime = {
        key,
        threadId: input.threadId,
        tabId: tab.id,
        webContents,
        view: null,
        ownsWebContents: false,
        listenerDisposers: [],
      }
      this.configureRuntimeWebContents(runtime)
      this.runtimes.set(key, runtime)
      for (const listener of this.webContentsListeners) {
        listener(runtime.webContents, tab.id)
      }
    }

    const bounds = this.getVisibleBoundsForThread(input.threadId)
    const runtime = this.runtimes.get(key)
    if (runtime && bounds) {
      this.attachRuntime(runtime, bounds)
    }

    const didChange = tab.status !== LIVE_TAB_STATUS || tab.lastError !== null
    tab.status = LIVE_TAB_STATUS
    tab.lastError = null
    syncThreadLastError(state)
    if (didChange) {
      this.markThreadStateChanged(input.threadId)
    }
    this.queueRuntimeStateSync(input.threadId, tab.id)
    this.emitState(input.threadId)
    return this.snapshotThreadState(input.threadId, state)
  }

  detachWebview(input: BrowserDetachWebviewInput): void {
    const state = this.states.get(input.threadId)
    const tab = state ? this.getTab(state, input.tabId) : null
    if (!state || !tab) {
      return
    }

    const runtime = this.runtimes.get(buildRuntimeKey(input.threadId, input.tabId))
    if (!runtime || runtime.ownsWebContents || runtime.webContents.id !== input.webContentsId) {
      return
    }

    this.destroyRuntime(input.threadId, input.tabId)
    const didChange = suspendTabState(tab) || syncThreadLastError(state)
    if (didChange) {
      this.markThreadStateChanged(input.threadId)
      this.emitState(input.threadId)
    }
  }

  navigate(input: BrowserNavigateInput): ThreadBrowserState {
    const state = this.ensureWorkspace(input.threadId)
    const tab = this.resolveTab(state, input.tabId)
    const nextUrl = normalizeUrlInput(input.url)
    tab.url = nextUrl
    tab.title = defaultTitleForUrl(nextUrl)
    tab.lastCommittedUrl = null
    tab.lastError = null
    syncThreadLastError(state)
    this.markThreadStateChanged(input.threadId)

    const runtime = this.runtimes.get(buildRuntimeKey(input.threadId, tab.id))
    if (runtime) {
      const bounds = this.getVisibleBoundsForThread(input.threadId)
      if (state.activeTabId === tab.id && bounds) {
        this.attachRuntime(runtime, bounds)
      }
      void this.loadTab(input.threadId, tab.id, { force: true, runtime })
    }
 else if (this.activeThreadId === input.threadId) {
      // Load the target tab directly so we don't clobber its pending URL with a
      // thread-wide runtime sync from the old live page state.
      const nextRuntime = this.ensureLiveRuntime(input.threadId, tab.id)
      const bounds = this.getVisibleBoundsForThread(input.threadId)
      if (state.activeTabId === tab.id && bounds) {
        this.attachRuntime(nextRuntime, bounds)
      }
      void this.loadTab(input.threadId, tab.id, { force: true, runtime: nextRuntime })
    }

    this.emitState(input.threadId)
    return this.snapshotThreadState(input.threadId, state)
  }

  reload(input: BrowserTabInput): ThreadBrowserState {
    const state = this.ensureWorkspace(input.threadId)
    const tab = this.resolveTab(state, input.tabId)
    const runtime = this.runtimes.get(buildRuntimeKey(input.threadId, tab.id))
    if (runtime) {
      runtime.webContents.reload()
    }
 else if (this.activeThreadId === input.threadId) {
      this.resumeThread(input.threadId)
      void this.loadTab(input.threadId, tab.id, { force: true })
    }
    return this.snapshotThreadState(input.threadId, state)
  }

  goBack(input: BrowserTabInput): ThreadBrowserState {
    const state = this.ensureWorkspace(input.threadId)
    const tab = this.resolveTab(state, input.tabId)
    const runtime = this.runtimes.get(buildRuntimeKey(input.threadId, tab.id))
    if (runtime && canWebContentsGoBack(runtime.webContents)) {
      runtime.webContents.goBack()
    }
    return this.getState({ threadId: input.threadId })
  }

  goForward(input: BrowserTabInput): ThreadBrowserState {
    const state = this.ensureWorkspace(input.threadId)
    const tab = this.resolveTab(state, input.tabId)
    const runtime = this.runtimes.get(buildRuntimeKey(input.threadId, tab.id))
    if (runtime && canWebContentsGoForward(runtime.webContents)) {
      runtime.webContents.goForward()
    }
    return this.getState({ threadId: input.threadId })
  }

  newTab(input: BrowserNewTabInput): ThreadBrowserState {
    const state = this.ensureWorkspace(input.threadId)
    const tab = createBrowserTab(normalizeUrlInput(input.url))
    state.tabs = [...state.tabs, tab]
    if (input.activate !== false || !state.activeTabId) {
      state.activeTabId = tab.id
    }

    if (this.activeThreadId === input.threadId) {
      const bounds = this.getVisibleBoundsForThread(input.threadId)
      if (state.activeTabId === tab.id && bounds) {
        this.clearSuspendTimer(input.threadId)
        this.attachActiveTab(input.threadId, bounds, { forceLoad: true })
      }
      else {
        tab.status = 'suspended'
      }
    }
    else {
      tab.status = 'suspended'
    }

    syncThreadLastError(state)
    this.markThreadStateChanged(input.threadId)
    this.emitState(input.threadId)
    return this.snapshotThreadState(input.threadId, state)
  }

  closeTab(input: BrowserTabInput): ThreadBrowserState {
    const state = this.ensureWorkspace(input.threadId)
    const tab = this.resolveTab(state, input.tabId)
    const closedIndex = state.tabs.findIndex(candidate => candidate.id === tab.id)
    const nextTabs = state.tabs.filter(candidate => candidate.id !== tab.id)
    if (nextTabs.length === state.tabs.length) {
      return this.snapshotThreadState(input.threadId, state)
    }

    this.destroyRuntime(input.threadId, tab.id)
    state.tabs = nextTabs

    if (nextTabs.length === 0) {
      const replacementTab = createBrowserTab()
      state.tabs = [replacementTab]
      state.activeTabId = replacementTab.id
      state.lastError = null
      this.markThreadStateChanged(input.threadId)
      this.emitState(input.threadId)
      return this.snapshotThreadState(input.threadId, state)
    }

    if (!state.activeTabId || state.activeTabId === tab.id) {
      state.activeTabId = nextTabs[Math.max(0, closedIndex - 1)]?.id ?? null
    }

    const bounds = this.getVisibleBoundsForThread(input.threadId)
    if (this.activeThreadId === input.threadId && bounds) {
      this.attachActiveTab(input.threadId, bounds)
    }

    syncThreadLastError(state)
    this.markThreadStateChanged(input.threadId)
    this.emitState(input.threadId)
    return this.snapshotThreadState(input.threadId, state)
  }

  selectTab(input: BrowserTabInput): ThreadBrowserState {
    const state = this.ensureWorkspace(input.threadId)
    const tab = this.resolveTab(state, input.tabId)
    if (state.activeTabId !== tab.id) {
      state.activeTabId = tab.id
      syncThreadLastError(state)
      this.markThreadStateChanged(input.threadId)
      this.emitState(input.threadId)
    }

    if (this.activeThreadId === input.threadId) {
      this.resumeThread(input.threadId)
      const bounds = this.getVisibleBoundsForThread(input.threadId)
      if (bounds) {
        this.attachActiveTab(input.threadId, bounds)
      }
    }

    return this.snapshotThreadState(input.threadId, state)
  }

  openDevTools(input: BrowserTabInput): void {
    const state = this.ensureWorkspace(input.threadId)
    const tab = this.resolveTab(state, input.tabId)
    if (state.activeTabId !== tab.id) {
      state.activeTabId = tab.id
      syncThreadLastError(state)
      this.markThreadStateChanged(input.threadId)
      this.emitState(input.threadId)
    }

    this.resumeThread(input.threadId)
    const runtime = this.ensureLiveRuntime(input.threadId, tab.id)
    const bounds = this.getVisibleBoundsForThread(input.threadId)
    if (bounds) {
      this.attachActiveTab(input.threadId, bounds)
    }
    runtime.webContents.openDevTools({ mode: 'detach' })
  }

  handlePromptRequest(sender: WebContents, payload: unknown): BrowserPromptRequest | null {
    const runtime = this.findRuntimeByWebContents(sender)
    if (!runtime) {
      return null
    }

    const normalizedPayload = normalizeBrowserPromptPayload(payload)
    if (!normalizedPayload) {
      return null
    }

    const request: BrowserPromptRequest = {
      threadId: runtime.threadId,
      tabId: runtime.tabId,
      text: normalizedPayload.text,
      attachments: normalizedPayload.attachments,
      sourceUrl: readWebContentsUrl(runtime.webContents),
      sourceTitle: readWebContentsTitle(runtime.webContents),
    }

    for (const listener of this.promptRequestListeners) {
      listener(request)
    }
    return request
  }

  handleAnnotationRuntimeEvent(
    sender: WebContents,
    payload: unknown,
  ): BrowserAnnotationRuntimeEvent | null {
    const runtime = this.findRuntimeByWebContents(sender)
    if (!runtime || !payload || typeof payload !== 'object') {
      return null
    }

    const candidate = payload as Partial<BrowserAnnotationRuntimeEvent>
    if (
      candidate.type !== 'ready'
      && candidate.type !== 'selected-element'
      && candidate.type !== 'save'
      && candidate.type !== 'submit'
      && candidate.type !== 'cancel'
      && candidate.type !== 'closed'
      && candidate.type !== 'toggle'
      && candidate.type !== 'copy'
      && candidate.type !== 'clear'
      && candidate.type !== 'delete'
      && candidate.type !== 'edit'
      && candidate.type !== 'layout-sync'
    ) {
      return null
    }

    const event: BrowserAnnotationRuntimeEvent = {
      ...candidate,
      threadId: runtime.threadId,
      tabId: runtime.tabId,
      type: candidate.type,
      sourceUrl: readWebContentsUrl(runtime.webContents),
      sourceTitle: readWebContentsTitle(runtime.webContents),
    }

    for (const listener of this.annotationRuntimeEventListeners) {
      listener(event)
    }
    return event
  }

  async startAnnotationRuntime(input: BrowserAnnotationRuntimeInput): Promise<void> {
    const runtime = await this.resolveLiveRuntimeForCommand(input)
    runtime.webContents.send(BROWSER_ANNOTATION_RUNTIME_COMMAND_CHANNEL, {
      type: 'start',
      annotations: input.annotations ?? [],
      editAnnotationId: input.editAnnotationId ?? null,
      layoutHints: input.layoutHints ?? [],
    })
  }

  async stopAnnotationRuntime(input: BrowserAnnotationRuntimeInput): Promise<void> {
    const runtime = await this.resolveLiveRuntimeForCommand(input)
    runtime.webContents.send(BROWSER_ANNOTATION_RUNTIME_COMMAND_CHANNEL, { type: 'stop' })
  }

  async notifyAnnotationRuntime(input: BrowserAnnotationRuntimeNotificationInput): Promise<void> {
    const runtime = await this.resolveLiveRuntimeForCommand(input)
    runtime.webContents.send(BROWSER_ANNOTATION_RUNTIME_COMMAND_CHANNEL, {
      type: 'notify',
      notification: {
        message: input.message,
        tone: input.tone ?? 'neutral',
      },
    })
  }

  // Ensures the requested tab is active/live, then returns a fresh PNG capture
  // from the native browser surface for whichever destination needs it next.
  private async captureScreenshotPng(input: BrowserTabInput): Promise<{
    name: string
    pngBytes: Buffer
  }> {
    this.perfCounters.captureScreenshotPngCalls += 1
    const state = this.ensureWorkspace(input.threadId)
    const tab = this.resolveTab(state, input.tabId)
    const isActiveTab = state.activeTabId === tab.id
    const wasSuspended = tab.status === SUSPENDED_TAB_STATUS
    const runtime = this.ensureLiveRuntime(input.threadId, tab.id)
    const webContents = runtime.webContents
    const expectedUrl = normalizeUrlInput(tab.lastCommittedUrl ?? tab.url)
    const currentUrl = webContents.getURL()
    const bounds = this.getVisibleBoundsForThread(input.threadId)
    if (isActiveTab) {
      this.resumeThread(input.threadId)
      if (bounds) {
        this.attachRuntime(runtime, bounds)
      }
    }

    if (wasSuspended || currentUrl.length === 0 || currentUrl !== expectedUrl) {
      await this.loadTab(input.threadId, tab.id, { runtime })
    }
 else {
      this.queueRuntimeStateSync(input.threadId, tab.id)
    }

    const pngBytes = (await webContents.capturePage()).toPNG()
    if (pngBytes.byteLength === 0) {
      throw new Error('Couldn\'t capture a browser screenshot.')
    }
    this.perfCounters.capturedScreenshotBytes += pngBytes.byteLength
    this.perfCounters.lastScreenshotBytes = pngBytes.byteLength
    this.perfCounters.lastScreenshotAt = Date.now()

    return {
      name: screenshotFileNameForUrl(tab.lastCommittedUrl ?? tab.url),
      pngBytes,
    }
  }

  // Captures the current browser viewport as a PNG so the renderer can attach
  // it directly to the composer without introducing temp-file disk churn.
  async captureScreenshot(input: BrowserTabInput): Promise<BrowserCaptureScreenshotResult> {
    this.perfCounters.captureScreenshotCalls += 1
    const { name, pngBytes } = await this.captureScreenshotPng(input)

    return {
      name,
      mimeType: 'image/png',
      sizeBytes: pngBytes.byteLength,
      bytes: Uint8Array.from(pngBytes),
    }
  }

  // Writes the current browser viewport screenshot straight to the native
  // clipboard so the renderer does not have to ferry image payloads over IPC.
  async copyScreenshotToClipboard(input: BrowserTabInput): Promise<void> {
    this.perfCounters.copyScreenshotToClipboardCalls += 1
    const { pngBytes } = await this.captureScreenshotPng(input)
    const image = nativeImage.createFromBuffer(pngBytes)
    if (image.isEmpty()) {
      throw new Error('Couldn\'t copy a browser screenshot to the clipboard.')
    }
    clipboard.writeImage(image)
  }

  // Runs a Chrome DevTools Protocol command against the requested tab so higher-level
  // browser automation can reuse the native browser runtime instead of scripting React.
  async executeCdp(input: BrowserExecuteCdpInput): Promise<unknown> {
    const state = this.ensureWorkspace(input.threadId)
    const tab = this.resolveTab(state, input.tabId)
    if (state.activeTabId !== tab.id) {
      state.activeTabId = tab.id
      syncThreadLastError(state)
      this.markThreadStateChanged(input.threadId)
      this.emitState(input.threadId)
    }

    this.resumeThread(input.threadId)
    const wasSuspended = tab.status === SUSPENDED_TAB_STATUS
    const runtime = this.ensureLiveRuntime(input.threadId, tab.id)
    const webContents = runtime.webContents
    const bounds = this.getVisibleBoundsForThread(input.threadId)
    if (bounds) {
      this.attachActiveTab(input.threadId, bounds)
    }

    if (wasSuspended) {
      await this.loadTab(input.threadId, tab.id, { force: true, runtime })
    }
 else {
      this.queueRuntimeStateSync(input.threadId, tab.id)
    }

    if (!webContents.debugger.isAttached()) {
      webContents.debugger.attach('1.3')
    }

    try {
      return await webContents.debugger.sendCommand(input.method, input.params ?? {})
    }
 catch (error) {
      if (error instanceof Error) {
        throw new Error(`CDP ${input.method} failed: ${error.message}`)
      }
      throw error
    }
  }

  async applyAnnotationDesign(
    input: BrowserAnnotationDesignInput,
  ): Promise<BrowserAnnotationElement | null> {
    const runtime = await this.resolveLiveRuntimeForCommand(input)
    runtime.webContents.send(BROWSER_ANNOTATION_RUNTIME_COMMAND_CHANNEL, {
      type: 'apply-design',
      selector: input.selector,
      designChange: input.designChange,
    })
    return null
  }

  async clearAnnotationDesign(input: BrowserTabInput): Promise<void> {
    const runtime = await this.resolveLiveRuntimeForCommand(input)
    runtime.webContents.send(BROWSER_ANNOTATION_RUNTIME_COMMAND_CHANNEL, { type: 'clear-design' })
  }

  async attachBrowserUseTab(input: BrowserTabInput): Promise<void> {
    const state = this.ensureWorkspace(input.threadId)
    const tab = this.resolveTab(state, input.tabId)
    if (state.activeTabId !== tab.id) {
      state.activeTabId = tab.id
      syncThreadLastError(state)
      this.markThreadStateChanged(input.threadId)
      this.emitState(input.threadId)
    }

    this.resumeThread(input.threadId)
    const wasSuspended = tab.status === SUSPENDED_TAB_STATUS
    const runtime = this.ensureLiveRuntime(input.threadId, tab.id)
    if (this.activeBounds && this.activeBoundsThreadId === input.threadId) {
      this.activateThread(input.threadId, this.activeBounds)
    }

    if (wasSuspended) {
      await this.loadTab(input.threadId, tab.id, { force: true, runtime })
    }
 else {
      this.queueRuntimeStateSync(input.threadId, tab.id)
    }

    if (!runtime.webContents.debugger.isAttached()) {
      runtime.webContents.debugger.attach('1.3')
    }
  }

  subscribeToCdpEvents(
    input: BrowserTabInput,
    listener: (event: BrowserUseCdpEvent) => void,
  ): () => void {
    const state = this.ensureWorkspace(input.threadId)
    const tab = this.resolveTab(state, input.tabId)
    const runtime = this.runtimes.get(buildRuntimeKey(input.threadId, tab.id))
    if (!runtime) {
      return () => {}
    }

    const handleMessage = (_event: Electron.Event, method: string, params?: unknown) => {
      listener({
        method,
        ...(params !== undefined ? { params } : {}),
      })
    }

    runtime.webContents.debugger.on('message', handleMessage)
    return () => {
      runtime.webContents.debugger.removeListener('message', handleMessage)
    }
  }

  private activateThread(threadId: ThreadId, bounds: BrowserPanelBounds): void {
    if (this.activeThreadId && this.activeThreadId !== threadId) {
      this.scheduleThreadSuspend(this.activeThreadId)
    }

    this.activeThreadId = threadId
    this.activeBounds = bounds
    this.activeBoundsThreadId = threadId
    this.resumeThread(threadId)
    this.attachActiveTab(threadId, bounds)
  }

  private activateThreadForPendingRenderer(threadId: ThreadId, bounds: BrowserPanelBounds): void {
    if (this.activeThreadId && this.activeThreadId !== threadId) {
      this.scheduleThreadSuspend(this.activeThreadId)
    }
    this.activeThreadId = threadId
    this.activeBounds = bounds
    this.activeBoundsThreadId = threadId
    this.clearSuspendTimer(threadId)
  }

  private async resolveLiveRuntimeForCommand(input: BrowserTabInput): Promise<LiveTabRuntime> {
    const state = this.ensureWorkspace(input.threadId)
    const tab = this.resolveTab(state, input.tabId)
    if (state.activeTabId !== tab.id) {
      state.activeTabId = tab.id
      syncThreadLastError(state)
      this.markThreadStateChanged(input.threadId)
      this.emitState(input.threadId)
    }

    this.resumeThread(input.threadId)
    const wasSuspended = tab.status === SUSPENDED_TAB_STATUS
    const runtime = this.ensureLiveRuntime(input.threadId, tab.id)
    const bounds = this.getVisibleBoundsForThread(input.threadId)
    if (bounds) {
      this.attachActiveTab(input.threadId, bounds)
    }

    if (wasSuspended) {
      await this.loadTab(input.threadId, tab.id, { force: true, runtime })
    }
 else {
      this.queueRuntimeStateSync(input.threadId, tab.id)
    }

    return runtime
  }

  private setActiveBounds(threadId: ThreadId, bounds: BrowserPanelBounds | null): void {
    if (!bounds) {
      this.clearActiveBoundsForThread(threadId)
      return
    }
    this.activeBounds = bounds
    this.activeBoundsThreadId = threadId
  }

  private clearActiveBoundsForThread(threadId: ThreadId): void {
    if (this.activeBoundsThreadId !== threadId) {
      return
    }
    this.activeBounds = null
    this.activeBoundsThreadId = null
  }

  private getVisibleBoundsForThread(threadId: ThreadId): BrowserPanelBounds | null {
    return this.activeBoundsThreadId === threadId ? this.activeBounds : null
  }

  private resumeThread(threadId: ThreadId): void {
    const state = this.ensureWorkspace(threadId)
    if (!state.open) {
      return
    }

    this.clearSuspendTimer(threadId)
    const activeTab = this.getActiveTab(state)
    let didChange = this.suspendInactiveTabs(threadId, activeTab?.id ?? null)

    // Only resume the visible tab. Waking every tab can fan out into several
    // Chromium renderer processes and background page activity at once.
    for (const tab of state.tabs) {
      if (tab.id !== activeTab?.id) {
        continue
      }
      const wasSuspended = tab.status === SUSPENDED_TAB_STATUS
      const runtime = this.ensureLiveRuntime(threadId, tab.id)
      if (wasSuspended) {
        void this.loadTab(threadId, tab.id, { force: true, runtime })
      }
 else {
        didChange = syncTabStateFromRuntime(state, tab, runtime.webContents) || didChange
      }
    }

    didChange = syncThreadLastError(state) || didChange
    if (didChange) {
      this.markThreadStateChanged(threadId)
      this.emitState(threadId)
    }
  }

  private suspendInactiveTabs(threadId: ThreadId, activeTabId: string | null): boolean {
    const state = this.states.get(threadId)
    if (!state) {
      return false
    }

    let didChange = false
    const inactiveRuntimeTabIds = state.tabs
      .filter(tab => tab.id !== activeTabId)
      .filter(tab => this.runtimes.has(buildRuntimeKey(threadId, tab.id)))
      .sort((left, right) => {
        const leftKey = buildRuntimeKey(threadId, left.id)
        const rightKey = buildRuntimeKey(threadId, right.id)
        return (
          (this.runtimeLastActiveAtByKey.get(rightKey) ?? 0)
          - (this.runtimeLastActiveAtByKey.get(leftKey) ?? 0)
        )
      })
    const warmRuntimeTabIds = new Set(
      inactiveRuntimeTabIds
        .slice(0, BROWSER_MAX_WARM_INACTIVE_RUNTIMES_PER_THREAD)
        .map(tab => tab.id),
    )

    for (const tab of state.tabs) {
      if (tab.id === activeTabId) {
        this.clearTabSuspendTimer(threadId, tab.id)
        continue
      }

      const runtime = this.runtimes.get(buildRuntimeKey(threadId, tab.id))
      if (runtime) {
        if (warmRuntimeTabIds.has(tab.id)) {
          this.scheduleInactiveTabSuspend(threadId, tab.id)
          continue
        }

        this.perfCounters.inactiveTabBudgetEvictions += 1
        this.destroyRuntime(threadId, tab.id)
        didChange = suspendTabState(tab) || didChange
        continue
      }

      didChange = suspendTabState(tab) || didChange
    }

    return didChange
  }

  private scheduleThreadSuspend(threadId: ThreadId): void {
    const state = this.states.get(threadId)
    if (!state?.open || this.activeThreadId === threadId) {
      return
    }

    this.clearSuspendTimer(threadId)
    const timer = setTimeout(() => {
      this.suspendThread(threadId)
      this.suspendTimers.delete(threadId)
    }, BROWSER_THREAD_SUSPEND_DELAY_MS)
    timer.unref()
    this.suspendTimers.set(threadId, timer)
  }

  private suspendThread(threadId: ThreadId): void {
    const state = this.states.get(threadId)
    if (!state || this.activeThreadId === threadId) {
      return
    }

    let didChange = false
    for (const tab of state.tabs) {
      this.destroyRuntime(threadId, tab.id)
      didChange = suspendTabState(tab) || didChange
    }

    didChange = syncThreadLastError(state) || didChange
    if (didChange) {
      this.markThreadStateChanged(threadId)
      this.emitState(threadId)
    }
  }

  private clearSuspendTimer(threadId: ThreadId): void {
    const existing = this.suspendTimers.get(threadId)
    if (!existing) {
      return
    }
    clearTimeout(existing)
    this.suspendTimers.delete(threadId)
  }

  private scheduleInactiveTabSuspend(threadId: ThreadId, tabId: string): void {
    const key = buildRuntimeKey(threadId, tabId)
    if (this.tabSuspendTimers.has(key)) {
      return
    }

    this.perfCounters.inactiveTabSuspendScheduled += 1
    const delayMs = this.resolveInactiveTabSuspendDelay(threadId)
    const timer = setTimeout(() => {
      this.tabSuspendTimers.delete(key)
      const state = this.states.get(threadId)
      const tab = state ? this.getTab(state, tabId) : null
      if (!state || !tab) {
        return
      }

      this.destroyRuntime(threadId, tabId)
      const didChange = suspendTabState(tab) || syncThreadLastError(state)
      if (didChange) {
        this.markThreadStateChanged(threadId)
        this.emitState(threadId)
      }
    }, delayMs)
    timer.unref()
    this.tabSuspendTimers.set(key, timer)
  }

  private clearTabSuspendTimer(threadId: ThreadId, tabId: string): void {
    const key = buildRuntimeKey(threadId, tabId)
    const existing = this.tabSuspendTimers.get(key)
    if (!existing) {
      return
    }

    clearTimeout(existing)
    this.tabSuspendTimers.delete(key)
    this.perfCounters.inactiveTabSuspendCancelled += 1
  }

  private attachActiveTab(
    threadId: ThreadId,
    bounds: BrowserPanelBounds,
    options: { forceLoad?: boolean } = {},
  ): void {
    const state = this.ensureWorkspace(threadId)
    const activeTab = this.getActiveTab(state)
    if (!activeTab) {
      return
    }

    this.suspendInactiveTabs(threadId, activeTab.id)
    const wasSuspended = activeTab.status === SUSPENDED_TAB_STATUS
    const runtime = this.ensureLiveRuntime(threadId, activeTab.id)
    this.attachRuntime(runtime, bounds)
    if (options.forceLoad || wasSuspended) {
      void this.loadTab(threadId, activeTab.id, {
        force: options.forceLoad || wasSuspended,
        runtime,
      })
    }
 else {
      this.syncRuntimeState(threadId, activeTab.id)
    }
  }

  private attachRuntime(runtime: LiveTabRuntime, bounds: BrowserPanelBounds): void {
    const window = this.window
    if (!window) {
      return
    }

    const nextBoundsSignature = browserBoundsSignature(bounds)
    this.runtimeLastActiveAtByKey.set(runtime.key, Date.now())
    if (!runtime.ownsWebContents) {
      if (this.attachedRuntimeKey && this.attachedRuntimeKey !== runtime.key) {
        this.detachAttachedRuntime()
      }
      this.attachedRuntimeKey = runtime.key
      this.attachedBoundsSignature = nextBoundsSignature
      return
    }
    if (!runtime.view) {
      return
    }
    if (this.attachedRuntimeKey === runtime.key) {
      this.setRuntimeViewHidden(runtime, false)
      this.bringRuntimeViewToFront(runtime)
      if (this.attachedBoundsSignature === nextBoundsSignature) {
        return
      }
      runtime.view.setBounds(bounds)
      this.attachedBoundsSignature = nextBoundsSignature
      return
    }

    this.detachAttachedRuntime()
    this.setRuntimeViewHidden(runtime, false)
    this.bringRuntimeViewToFront(runtime)
    runtime.view.setBounds(bounds)
    this.attachedRuntimeKey = runtime.key
    this.attachedBoundsSignature = nextBoundsSignature
  }

  private bringRuntimeViewToFront(runtime: LiveTabRuntime): void {
    const window = this.window
    if (!window || !runtime.view) {
      return
    }

    const children = window.contentView.children
    if (children.at(-1) === runtime.view) {
      return
    }
    if (!children.includes(runtime.view)) {
      window.contentView.addChildView(runtime.view)
      return
    }

    try {
      window.contentView.removeChildView(runtime.view)
    }
 catch {
      // Electron throws when the view is not attached yet; adding it below is the desired state.
    }
    window.contentView.addChildView(runtime.view)
  }

  private detachAttachedRuntime(): void {
    if (!this.window || !this.attachedRuntimeKey) {
      this.attachedRuntimeKey = null
      this.attachedBoundsSignature = null
      return
    }

    const runtime = this.runtimes.get(this.attachedRuntimeKey)
    if (runtime?.view) {
      this.setRuntimeViewHidden(runtime, true)
      this.removeRuntimeView(runtime)
    }
    this.attachedRuntimeKey = null
    this.attachedBoundsSignature = null
  }

  private setRuntimeViewHidden(runtime: LiveTabRuntime, hidden: boolean): void {
    if (!runtime.view) {
      return
    }
    const nativeView = runtime.view as typeof runtime.view & NativeBrowserViewVisibility
    if (!nativeView.setVisible) {
      if (hidden) {
        runtime.view.setBounds(HIDDEN_BROWSER_BOUNDS)
      }
      return
    }
    if (hidden) {
      nativeView.setVisible(false)
      return
    }
    nativeView.setVisible(true)
  }

  private removeRuntimeView(runtime: LiveTabRuntime): void {
    const window = this.window
    if (!window || !runtime.view || !window.contentView.children.includes(runtime.view)) {
      return
    }
    window.contentView.removeChildView(runtime.view)
  }

  private ensureLiveRuntime(threadId: ThreadId, tabId: string): LiveTabRuntime {
    const key = buildRuntimeKey(threadId, tabId)
    this.clearTabSuspendTimer(threadId, tabId)
    const existing = this.runtimes.get(key)
    if (existing) {
      if (existing.webContents.isDestroyed()) {
        this.destroyRuntime(threadId, tabId)
      }
 else {
        return existing
      }
    }

    const runtime = this.createLiveRuntime(threadId, tabId)
    this.runtimes.set(key, runtime)
    const state = this.ensureWorkspace(threadId)
    const tab = this.getTab(state, tabId)
    if (tab) {
      const didChange = tab.status !== 'live' || tab.lastError !== null
      tab.status = 'live'
      tab.lastError = null
      syncThreadLastError(state)
      if (didChange) {
        this.markThreadStateChanged(threadId)
      }
    }
    return runtime
  }

  private createLiveRuntime(threadId: ThreadId, tabId: string): LiveTabRuntime {
    const view = new WebContentsView({
      webPreferences: {
        partition: browserSessionPartition(threadId),
        preload: resolveDesktopBrowserPanelPreloadPath(__dirname),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    })
    view.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => {
      callback(true)
    })
    view.webContents.session.setPermissionCheckHandler(() => true)
    const runtime: LiveTabRuntime = {
      key: buildRuntimeKey(threadId, tabId),
      threadId,
      tabId,
      webContents: view.webContents,
      view,
      ownsWebContents: true,
      listenerDisposers: [],
    }
    this.configureRuntimeWebContents(runtime)
    for (const listener of this.webContentsListeners) {
      listener(runtime.webContents, tabId)
    }
    return runtime
  }

  private findRuntimeByWebContents(webContents: WebContents): LiveTabRuntime | null {
    for (const runtime of this.runtimes.values()) {
      if (runtime.webContents === webContents) {
        return runtime
      }
    }
    return null
  }

  private findRendererRuntimeByWebContentsId(webContentsId: number): LiveTabRuntime | null {
    for (const runtime of this.runtimes.values()) {
      if (!runtime.ownsWebContents && runtime.webContents.id === webContentsId) {
        return runtime
      }
    }
    return null
  }

  private configureRuntimeWebContents(runtime: LiveTabRuntime): void {
    const { threadId, tabId, webContents } = runtime

    webContents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith('http://') || url.startsWith('https://') || url === ABOUT_BLANK_URL) {
        this.newTab({
          threadId,
          url,
          activate: true,
        })
        const bounds = this.getVisibleBoundsForThread(threadId)
        if (this.activeThreadId === threadId && bounds) {
          this.attachActiveTab(threadId, bounds)
        }
        return { action: 'deny' }
      }

      void shell.openExternal(url)
      return { action: 'deny' }
    })

    const pageTitleUpdated = (event: Electron.Event) => {
      event.preventDefault()
      this.queueRuntimeStateSync(threadId, tabId)
    }
    webContents.on('page-title-updated', pageTitleUpdated)
    runtime.listenerDisposers.push(() => {
      webContents.removeListener('page-title-updated', pageTitleUpdated)
    })

    const pageFaviconUpdated = (_event: Electron.Event, faviconUrls: string[]) => {
      this.queueRuntimeStateSync(threadId, tabId, faviconUrls)
    }
    webContents.on('page-favicon-updated', pageFaviconUpdated)
    runtime.listenerDisposers.push(() => {
      webContents.removeListener('page-favicon-updated', pageFaviconUpdated)
    })

    const didStartLoading = () => {
      this.queueRuntimeStateSync(threadId, tabId)
    }
    webContents.on('did-start-loading', didStartLoading)
    runtime.listenerDisposers.push(() => {
      webContents.removeListener('did-start-loading', didStartLoading)
    })

    const didStopLoading = () => {
      this.queueRuntimeStateSync(threadId, tabId)
    }
    webContents.on('did-stop-loading', didStopLoading)
    runtime.listenerDisposers.push(() => {
      webContents.removeListener('did-stop-loading', didStopLoading)
    })

    const didNavigate = () => {
      this.queueRuntimeStateSync(threadId, tabId)
    }
    webContents.on('did-navigate', didNavigate)
    runtime.listenerDisposers.push(() => {
      webContents.removeListener('did-navigate', didNavigate)
    })

    const didNavigateInPage = () => {
      this.queueRuntimeStateSync(threadId, tabId)
    }
    webContents.on('did-navigate-in-page', didNavigateInPage)
    runtime.listenerDisposers.push(() => {
      webContents.removeListener('did-navigate-in-page', didNavigateInPage)
    })

    const didFailLoad = (
      _event: Electron.Event,
      errorCode: number,
      _errorDescription: string,
      validatedURL: string,
      isMainFrame: boolean,
    ) => {
      if (!isMainFrame || errorCode === BROWSER_ERROR_ABORTED) {
        return
      }

      const state = this.states.get(threadId)
      const tab = state ? this.getTab(state, tabId) : null
      if (!state || !tab) {
        return
      }

      tab.url = validatedURL || tab.url
      tab.title = defaultTitleForUrl(tab.url)
      tab.isLoading = false
      tab.lastError = mapBrowserLoadError(errorCode)
      syncThreadLastError(state)
      this.markThreadStateChanged(threadId)
      this.emitState(threadId)
    }
    webContents.on('did-fail-load', didFailLoad)
    runtime.listenerDisposers.push(() => {
      webContents.removeListener('did-fail-load', didFailLoad)
    })

    const renderProcessGone = () => {
      const state = this.states.get(threadId)
      const tab = state ? this.getTab(state, tabId) : null
      this.destroyRuntime(threadId, tabId)
      if (state && tab) {
        tab.status = 'suspended'
        tab.isLoading = false
        tab.lastError = 'This tab stopped unexpectedly.'
        syncThreadLastError(state)
        this.markThreadStateChanged(threadId)
        this.emitState(threadId)
      }
      const bounds = this.getVisibleBoundsForThread(threadId)
      if (this.activeThreadId === threadId && bounds) {
        this.attachActiveTab(threadId, bounds)
      }
    }
    webContents.on('render-process-gone', renderProcessGone)
    runtime.listenerDisposers.push(() => {
      webContents.removeListener('render-process-gone', renderProcessGone)
    })
  }

  private async loadTab(
    threadId: ThreadId,
    tabId: string,
    options: { force?: boolean, runtime?: LiveTabRuntime } = {},
  ): Promise<void> {
    const state = this.ensureWorkspace(threadId)
    const tab = this.getTab(state, tabId)
    if (!tab) {
      return
    }

    const runtime = options.runtime ?? this.ensureLiveRuntime(threadId, tabId)
    const webContents = runtime.webContents
    const nextUrl = normalizeUrlInput(
      options.force === true ? tab.url : (tab.lastCommittedUrl ?? tab.url),
    )
    const currentUrl = webContents.getURL()
    const shouldLoad = options.force === true || currentUrl !== nextUrl || currentUrl.length === 0

    if (!shouldLoad) {
      this.queueRuntimeStateSync(threadId, tabId)
      return
    }

    tab.url = nextUrl
    tab.status = 'live'
    tab.isLoading = true
    tab.lastError = null
    syncThreadLastError(state)
    this.markThreadStateChanged(threadId)
    this.emitState(threadId)

    try {
      await webContents.loadURL(nextUrl)
      this.queueRuntimeStateSync(threadId, tabId)
    }
 catch (error) {
      if (isAbortedNavigationError(error)) {
        this.queueRuntimeStateSync(threadId, tabId)
        return
      }

      tab.isLoading = false
      tab.lastError = 'Couldn\'t open this page.'
      syncThreadLastError(state)
      this.markThreadStateChanged(threadId)
      this.emitState(threadId)
    }
  }

  private syncRuntimeState(threadId: ThreadId, tabId: string, faviconUrls?: string[]): void {
    this.perfCounters.syncRuntimeStateCalls += 1
    const state = this.states.get(threadId)
    const tab = state ? this.getTab(state, tabId) : null
    const runtime = this.runtimes.get(buildRuntimeKey(threadId, tabId))
    if (!state || !tab || !runtime) {
      return
    }

    const didChange = syncTabStateFromRuntime(state, tab, runtime.webContents, faviconUrls)
    const nextDidChange = syncThreadLastError(state) || didChange
    if (nextDidChange) {
      this.markThreadStateChanged(threadId)
      this.emitState(threadId)
    }
  }

  private queueRuntimeStateSync(threadId: ThreadId, tabId: string, faviconUrls?: string[]): void {
    const key = buildRuntimeKey(threadId, tabId)
    const existing = this.pendingRuntimeSyncs.get(key)
    const nextPendingSync: PendingRuntimeSync = {
      threadId,
      tabId,
    }
    const nextFaviconUrls = faviconUrls ?? existing?.faviconUrls
    if (nextFaviconUrls !== undefined) {
      nextPendingSync.faviconUrls = nextFaviconUrls
    }
    this.pendingRuntimeSyncs.set(key, nextPendingSync)

    if (this.runtimeSyncFlushScheduled) {
      return
    }

    this.runtimeSyncFlushScheduled = true
    queueMicrotask(() => {
      this.runtimeSyncFlushScheduled = false
      if (this.pendingRuntimeSyncs.size === 0) {
        return
      }

      this.perfCounters.runtimeSyncQueueFlushes += 1
      const pendingSyncs = [...this.pendingRuntimeSyncs.values()]
      this.pendingRuntimeSyncs.clear()
      for (const pendingSync of pendingSyncs) {
        this.syncRuntimeState(pendingSync.threadId, pendingSync.tabId, pendingSync.faviconUrls)
      }
    })
  }

  private destroyThreadRuntimes(threadId: ThreadId): void {
    const state = this.states.get(threadId)
    if (!state) {
      return
    }

    for (const tab of state.tabs) {
      this.destroyRuntime(threadId, tab.id)
    }
  }

  private destroyAllRuntimes(): void {
    for (const runtime of this.runtimes.values()) {
      this.destroyRuntime(runtime.threadId, runtime.tabId)
    }
  }

  private destroyRuntime(threadId: ThreadId, tabId: string): void {
    const key = buildRuntimeKey(threadId, tabId)
    this.clearTabSuspendTimer(threadId, tabId)
    this.pendingRuntimeSyncs.delete(key)
    this.runtimeLastActiveAtByKey.delete(key)
    const runtime = this.runtimes.get(key)
    if (!runtime) {
      return
    }

    if (this.attachedRuntimeKey === key) {
      this.detachAttachedRuntime()
    }
    this.removeRuntimeView(runtime)

    this.runtimes.delete(key)
    const webContents = runtime.webContents
    for (const disposeListener of runtime.listenerDisposers.splice(0)) {
      disposeListener()
    }
    if (!webContents.isDestroyed()) {
      if (webContents.debugger.isAttached()) {
        try {
          webContents.debugger.detach()
        }
 catch {
          // The runtime is being torn down anyway; ignore stale-debugger cleanup noise.
        }
      }
      if (runtime.ownsWebContents) {
        webContents.close({ waitForBeforeUnload: false })
      }
    }
  }

  private getOrCreateState(threadId: ThreadId): ThreadBrowserState {
    const existing = this.states.get(threadId)
    if (existing) {
      return existing
    }

    const initial = defaultThreadBrowserState(threadId)
    this.states.set(threadId, initial)
    this.threadVersionById.set(threadId, 0)
    return initial
  }

  private markThreadStateChanged(threadId: ThreadId): void {
    const nextVersion = (this.threadVersionById.get(threadId) ?? 0) + 1
    this.threadVersionById.set(threadId, nextVersion)
    const state = this.states.get(threadId)
    if (state) {
      state.version = nextVersion
    }
  }

  private snapshotThreadState(
    threadId: ThreadId,
    state = this.getOrCreateState(threadId),
  ): ThreadBrowserState {
    const version = state.version
    const cached = this.snapshotCacheByThreadId.get(threadId)
    if (cached && cached.version === version) {
      return cached.snapshot
    }

    const snapshot = cloneThreadState(state)
    this.perfCounters.stateCloneCount += 1
    this.snapshotCacheByThreadId.set(threadId, {
      version,
      snapshot,
    })
    return snapshot
  }

  private getTrackedProcessIds(): number[] {
    const processIds = new Set<number>()
    for (const runtime of this.runtimes.values()) {
      const webContents = runtime.webContents
      if (webContents.isDestroyed()) {
        continue
      }
      const processId = readWebContentsChromiumProcessId(webContents)
      if (processId !== null) {
        processIds.add(processId)
      }
    }
    return [...processIds]
  }

  private getTrackedOSProcessIds(): number[] {
    const processIds = new Set<number>()
    for (const runtime of this.runtimes.values()) {
      const webContents = runtime.webContents
      if (webContents.isDestroyed()) {
        continue
      }
      const processId = readWebContentsOSProcessId(webContents)
      if (processId !== null) {
        processIds.add(processId)
      }
    }
    return [...processIds]
  }

  private countWarmInactiveRuntimes(): number {
    let count = 0
    for (const [key] of this.tabSuspendTimers) {
      if (this.runtimes.has(key)) {
        count += 1
      }
    }
    return count
  }

  private resolveInactiveTabSuspendDelay(threadId: ThreadId): number {
    const threadRuntimeCount = [...this.runtimes.values()].filter(
      runtime => runtime.threadId === threadId,
    ).length
    if (
      threadRuntimeCount > BROWSER_MAX_WARM_INACTIVE_RUNTIMES_PER_THREAD + 1
      || this.runtimes.size > 4
    ) {
      return BROWSER_INACTIVE_TAB_SUSPEND_DELAY_PRESSURED_MS
    }

    return BROWSER_INACTIVE_TAB_SUSPEND_DELAY_MS
  }

  private ensureWorkspace(threadId: ThreadId, initialUrl?: string): ThreadBrowserState {
    const state = this.getOrCreateState(threadId)
    if (state.tabs.length === 0) {
      const initialTab = createBrowserTab(normalizeUrlInput(initialUrl))
      state.tabs = [initialTab]
      state.activeTabId = initialTab.id
    }

    if (!state.activeTabId || !state.tabs.some(tab => tab.id === state.activeTabId)) {
      state.activeTabId = state.tabs[0]?.id ?? null
    }

    return state
  }

  private resolveTab(state: ThreadBrowserState, tabId?: string): BrowserTabState {
    const resolvedTabId = tabId ?? state.activeTabId
    const existing
      = (resolvedTabId ? state.tabs.find(tab => tab.id === resolvedTabId) : undefined)
        ?? state.tabs[0]
    if (existing) {
      return existing
    }

    const fallback = createBrowserTab()
    state.tabs = [fallback]
    state.activeTabId = fallback.id
    return fallback
  }

  private getActiveTab(state: ThreadBrowserState): BrowserTabState | null {
    if (!state.activeTabId) {
      return state.tabs[0] ?? null
    }
    return state.tabs.find(tab => tab.id === state.activeTabId) ?? state.tabs[0] ?? null
  }

  private getTab(state: ThreadBrowserState, tabId: string): BrowserTabState | null {
    return state.tabs.find(tab => tab.id === tabId) ?? null
  }

  private emitState(threadId: ThreadId): void {
    this.perfCounters.stateEmitCalls += 1
    const state = this.getOrCreateState(threadId)
    const nextVersion = state.version
    if (this.lastEmittedVersionByThreadId.get(threadId) === nextVersion) {
      this.perfCounters.stateEmitSkips += 1
      return
    }
    this.lastEmittedVersionByThreadId.set(threadId, nextVersion)
    const snapshot = this.snapshotThreadState(threadId, state)
    for (const listener of this.listeners) {
      listener(snapshot)
    }
  }
}

function setIfChanged<T>(current: T, next: T, apply: (value: T) => void): boolean {
  if (Object.is(current, next)) {
    return false
  }
  apply(next)
  return true
}

function suspendTabState(tab: BrowserTabState): boolean {
  let didChange = false
  didChange
    = setIfChanged(tab.status, SUSPENDED_TAB_STATUS, (value) => {
      tab.status = value
    }) || didChange
  didChange
    = setIfChanged(tab.isLoading, false, (value) => {
      tab.isLoading = value
    }) || didChange
  didChange
    = setIfChanged(tab.canGoBack, false, (value) => {
      tab.canGoBack = value
    }) || didChange
  didChange
    = setIfChanged(tab.canGoForward, false, (value) => {
      tab.canGoForward = value
    }) || didChange
  return didChange
}

function syncTabStateFromRuntime(
  state: ThreadBrowserState,
  tab: BrowserTabState,
  webContents: WebContents,
  faviconUrls?: string[],
): boolean {
  const currentUrl = webContents.getURL()
  const nextUrl = currentUrl || tab.url
  const nextTitle = webContents.getTitle()
  let didChange = false
  didChange
    = setIfChanged(tab.status, LIVE_TAB_STATUS, (value) => {
      tab.status = value
    }) || didChange
  didChange
    = setIfChanged(tab.url, nextUrl, (value) => {
      tab.url = value
    }) || didChange
  const resolvedTitle
    = !nextTitle || nextTitle === ABOUT_BLANK_URL ? defaultTitleForUrl(nextUrl) : nextTitle
  didChange
    = setIfChanged(tab.title, resolvedTitle, (value) => {
      tab.title = value
    }) || didChange
  didChange
    = setIfChanged(tab.isLoading, webContents.isLoading(), (value) => {
      tab.isLoading = value
    }) || didChange
  didChange
    = setIfChanged(tab.canGoBack, canWebContentsGoBack(webContents), (value) => {
      tab.canGoBack = value
    }) || didChange
  didChange
    = setIfChanged(tab.canGoForward, canWebContentsGoForward(webContents), (value) => {
      tab.canGoForward = value
    }) || didChange
  didChange
    = setIfChanged(tab.lastCommittedUrl, currentUrl || tab.lastCommittedUrl, (value) => {
      tab.lastCommittedUrl = value
    }) || didChange
  if (faviconUrls) {
    didChange
      = setIfChanged(tab.faviconUrl, faviconUrls[0] ?? tab.faviconUrl, (value) => {
        tab.faviconUrl = value
      }) || didChange
  }
  if (tab.lastError && !tab.isLoading) {
    tab.lastError = null
    didChange = true
  }
  didChange = syncThreadLastError(state) || didChange
  return didChange
}

function canWebContentsGoBack(webContents: WebContents): boolean {
  return webContents.navigationHistory?.canGoBack() ?? webContents.canGoBack()
}

function canWebContentsGoForward(webContents: WebContents): boolean {
  return webContents.navigationHistory?.canGoForward() ?? webContents.canGoForward()
}

function syncThreadLastError(state: ThreadBrowserState): boolean {
  const activeTab
    = (state.activeTabId ? state.tabs.find(tab => tab.id === state.activeTabId) : undefined)
      ?? state.tabs[0]
  const nextLastError = activeTab?.lastError ?? null
  if (state.lastError === nextLastError) {
    return false
  }
  state.lastError = nextLastError
  return true
}
