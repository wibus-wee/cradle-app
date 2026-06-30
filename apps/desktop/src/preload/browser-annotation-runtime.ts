import { ipcRenderer } from 'electron'

import { BROWSER_ANNOTATION_MARKER_CSS } from './browser-annotation-marker'
import type { BrowserAnnotationToolbarButtonInput } from './browser-annotation-toolbar'
import {
  BROWSER_ANNOTATION_TOOLBAR_CSS,
  renderBrowserAnnotationToolbar,
} from './browser-annotation-toolbar'
import type { BrowserAnnotationAnchor, BrowserAnnotationDesignChange, BrowserAnnotationElement, BrowserAnnotationElementStyle, BrowserAnnotationLayoutComponentType, BrowserAnnotationLayoutHint, BrowserAnnotationMarkerClickBehavior, BrowserAnnotationMarkerColorId, BrowserAnnotationOutputDetail, BrowserAnnotationReactDetectionMode, BrowserAnnotationResizeHandle, BrowserAnnotationRuntimeAnnotation, BrowserAnnotationRuntimeCommand, BrowserAnnotationRuntimeEvent, BrowserAnnotationRuntimeNotification, BrowserAnnotationRuntimeSettings, BrowserAnnotationRuntimeStage, BrowserPanelPromptAttachment } from './browser-panel-contract'
import {
  BROWSER_ANNOTATION_RUNTIME_COMMAND_CHANNEL,
  BROWSER_ANNOTATION_RUNTIME_EVENT_CHANNEL,
} from './browser-panel-contract'
import { blobToDataUrl } from './browser-panel-prompt'

interface BrowserAnnotationFreezeState {
  frozen: boolean
  installed: boolean
  originalSetTimeout: typeof window.setTimeout
  originalSetInterval: typeof window.setInterval
  originalRequestAnimationFrame: typeof window.requestAnimationFrame
  pausedAnimations: Animation[]
  timeoutQueue: Array<() => void>
  rafQueue: FrameRequestCallback[]
}

interface BrowserAnnotationLayoutPlacement {
  id: string
  type: BrowserAnnotationLayoutComponentType
  label: string
  x: number
  /** Document-space top edge, so layout hints stay attached while the page scrolls. */
  y: number
  width: number
  height: number
  scrollY: number
}

interface BrowserAnnotationLayoutRearrangement {
  id: string
  selector: string
  label: string
  from: { x: number, y: number, width: number, height: number }
  to: { x: number, y: number, width: number, height: number }
  scrollY: number
}

interface BrowserAnnotationSnapGuide {
  axis: 'x' | 'y'
  position: number
}

interface BrowserAnnotationLayoutComponentDefinition {
  type: BrowserAnnotationLayoutComponentType
  label: string
  width: number
  height: number
}

const BROWSER_ANNOTATION_SETTINGS_KEY = 'cradle-browser-annotation-settings'
const BROWSER_ANNOTATION_FREEZE_STYLE_ID = 'cradle-browser-comment-freeze-style'
const BROWSER_ANNOTATION_FREEZE_STATE_KEY = '__cradle_browser_annotation_freeze'

const BROWSER_ANNOTATION_MARKER_COLORS: Record<BrowserAnnotationMarkerColorId, string> = {
  blue: '#0088ff',
  green: '#34c759',
  purple: '#af52de',
  orange: '#ff9500',
  red: '#ff383c',
}

const DEFAULT_SIZES: Record<BrowserAnnotationLayoutComponentType, { width: number, height: number }> = {
  navigation: { width: 800, height: 56 },
  hero: { width: 800, height: 320 },
  card: { width: 280, height: 240 },
  button: { width: 140, height: 40 },
  sidebar: { width: 240, height: 400 },
  table: { width: 560, height: 220 },
  form: { width: 360, height: 320 },
  input: { width: 280, height: 56 },
  modal: { width: 480, height: 300 },
  footer: { width: 800, height: 160 },
  avatar: { width: 48, height: 48 },
  badge: { width: 80, height: 28 },
  text: { width: 400, height: 120 },
  image: { width: 320, height: 200 },
  list: { width: 300, height: 180 },
  tabs: { width: 480, height: 240 },
  header: { width: 800, height: 80 },
  section: { width: 800, height: 400 },
  grid: { width: 600, height: 300 },
  dropdown: { width: 200, height: 200 },
  toggle: { width: 44, height: 24 },
  breadcrumb: { width: 300, height: 24 },
  pagination: { width: 300, height: 36 },
  progress: { width: 240, height: 8 },
  divider: { width: 600, height: 1 },
  accordion: { width: 400, height: 200 },
  carousel: { width: 600, height: 300 },
  chart: { width: 400, height: 240 },
  video: { width: 480, height: 270 },
  search: { width: 320, height: 44 },
  toast: { width: 320, height: 64 },
  tooltip: { width: 180, height: 40 },
  pricing: { width: 300, height: 360 },
  testimonial: { width: 360, height: 200 },
  cta: { width: 600, height: 160 },
  alert: { width: 400, height: 56 },
  banner: { width: 800, height: 48 },
  stat: { width: 200, height: 120 },
  stepper: { width: 480, height: 48 },
  tag: { width: 72, height: 28 },
  rating: { width: 160, height: 28 },
  map: { width: 480, height: 300 },
  timeline: { width: 360, height: 320 },
  fileUpload: { width: 360, height: 180 },
  codeBlock: { width: 480, height: 200 },
  calendar: { width: 300, height: 300 },
  notification: { width: 360, height: 72 },
  productCard: { width: 280, height: 360 },
  profile: { width: 280, height: 200 },
  drawer: { width: 320, height: 400 },
  popover: { width: 240, height: 160 },
  logo: { width: 120, height: 40 },
  faq: { width: 560, height: 320 },
  gallery: { width: 560, height: 360 },
  checkbox: { width: 20, height: 20 },
  radio: { width: 20, height: 20 },
  slider: { width: 240, height: 32 },
  datePicker: { width: 300, height: 320 },
  skeleton: { width: 320, height: 120 },
  chip: { width: 96, height: 32 },
  icon: { width: 24, height: 24 },
  spinner: { width: 32, height: 32 },
  feature: { width: 360, height: 200 },
  team: { width: 560, height: 280 },
  login: { width: 360, height: 360 },
  contact: { width: 400, height: 320 },
}

const BROWSER_ANNOTATION_LAYOUT_COMPONENTS: ReadonlyArray<{
  section: string
  items: BrowserAnnotationLayoutComponentDefinition[]
}> = [
  {
    section: 'Layout',
    items: [
      { type: 'navigation', label: 'Navigation', ...DEFAULT_SIZES.navigation },
      { type: 'header', label: 'Header', ...DEFAULT_SIZES.header },
      { type: 'hero', label: 'Hero', ...DEFAULT_SIZES.hero },
      { type: 'section', label: 'Section', ...DEFAULT_SIZES.section },
      { type: 'sidebar', label: 'Sidebar', ...DEFAULT_SIZES.sidebar },
      { type: 'footer', label: 'Footer', ...DEFAULT_SIZES.footer },
      { type: 'modal', label: 'Modal', ...DEFAULT_SIZES.modal },
      { type: 'banner', label: 'Banner', ...DEFAULT_SIZES.banner },
      { type: 'drawer', label: 'Drawer', ...DEFAULT_SIZES.drawer },
      { type: 'popover', label: 'Popover', ...DEFAULT_SIZES.popover },
      { type: 'divider', label: 'Divider', ...DEFAULT_SIZES.divider },
    ],
  },
  {
    section: 'Content',
    items: [
      { type: 'card', label: 'Card', ...DEFAULT_SIZES.card },
      { type: 'text', label: 'Text', ...DEFAULT_SIZES.text },
      { type: 'image', label: 'Image', ...DEFAULT_SIZES.image },
      { type: 'video', label: 'Video', ...DEFAULT_SIZES.video },
      { type: 'table', label: 'Table', ...DEFAULT_SIZES.table },
      { type: 'grid', label: 'Grid', ...DEFAULT_SIZES.grid },
      { type: 'list', label: 'List', ...DEFAULT_SIZES.list },
      { type: 'chart', label: 'Chart', ...DEFAULT_SIZES.chart },
      { type: 'codeBlock', label: 'Code Block', ...DEFAULT_SIZES.codeBlock },
      { type: 'map', label: 'Map', ...DEFAULT_SIZES.map },
      { type: 'timeline', label: 'Timeline', ...DEFAULT_SIZES.timeline },
      { type: 'calendar', label: 'Calendar', ...DEFAULT_SIZES.calendar },
      { type: 'accordion', label: 'Accordion', ...DEFAULT_SIZES.accordion },
      { type: 'carousel', label: 'Carousel', ...DEFAULT_SIZES.carousel },
      { type: 'logo', label: 'Logo', ...DEFAULT_SIZES.logo },
      { type: 'faq', label: 'FAQ', ...DEFAULT_SIZES.faq },
      { type: 'gallery', label: 'Gallery', ...DEFAULT_SIZES.gallery },
    ],
  },
  {
    section: 'Controls',
    items: [
      { type: 'button', label: 'Button', ...DEFAULT_SIZES.button },
      { type: 'input', label: 'Input', ...DEFAULT_SIZES.input },
      { type: 'search', label: 'Search', ...DEFAULT_SIZES.search },
      { type: 'form', label: 'Form', ...DEFAULT_SIZES.form },
      { type: 'tabs', label: 'Tabs', ...DEFAULT_SIZES.tabs },
      { type: 'dropdown', label: 'Dropdown', ...DEFAULT_SIZES.dropdown },
      { type: 'toggle', label: 'Toggle', ...DEFAULT_SIZES.toggle },
      { type: 'stepper', label: 'Stepper', ...DEFAULT_SIZES.stepper },
      { type: 'rating', label: 'Rating', ...DEFAULT_SIZES.rating },
      { type: 'fileUpload', label: 'File Upload', ...DEFAULT_SIZES.fileUpload },
      { type: 'checkbox', label: 'Checkbox', ...DEFAULT_SIZES.checkbox },
      { type: 'radio', label: 'Radio', ...DEFAULT_SIZES.radio },
      { type: 'slider', label: 'Slider', ...DEFAULT_SIZES.slider },
      { type: 'datePicker', label: 'Date Picker', ...DEFAULT_SIZES.datePicker },
    ],
  },
  {
    section: 'Elements',
    items: [
      { type: 'avatar', label: 'Avatar', ...DEFAULT_SIZES.avatar },
      { type: 'badge', label: 'Badge', ...DEFAULT_SIZES.badge },
      { type: 'tag', label: 'Tag', ...DEFAULT_SIZES.tag },
      { type: 'breadcrumb', label: 'Breadcrumb', ...DEFAULT_SIZES.breadcrumb },
      { type: 'pagination', label: 'Pagination', ...DEFAULT_SIZES.pagination },
      { type: 'progress', label: 'Progress', ...DEFAULT_SIZES.progress },
      { type: 'alert', label: 'Alert', ...DEFAULT_SIZES.alert },
      { type: 'toast', label: 'Toast', ...DEFAULT_SIZES.toast },
      { type: 'notification', label: 'Notification', ...DEFAULT_SIZES.notification },
      { type: 'tooltip', label: 'Tooltip', ...DEFAULT_SIZES.tooltip },
      { type: 'stat', label: 'Stat', ...DEFAULT_SIZES.stat },
      { type: 'skeleton', label: 'Skeleton', ...DEFAULT_SIZES.skeleton },
      { type: 'chip', label: 'Chip', ...DEFAULT_SIZES.chip },
      { type: 'icon', label: 'Icon', ...DEFAULT_SIZES.icon },
      { type: 'spinner', label: 'Spinner', ...DEFAULT_SIZES.spinner },
    ],
  },
  {
    section: 'Blocks',
    items: [
      { type: 'pricing', label: 'Pricing', ...DEFAULT_SIZES.pricing },
      { type: 'testimonial', label: 'Testimonial', ...DEFAULT_SIZES.testimonial },
      { type: 'cta', label: 'CTA', ...DEFAULT_SIZES.cta },
      { type: 'productCard', label: 'Product Card', ...DEFAULT_SIZES.productCard },
      { type: 'profile', label: 'Profile', ...DEFAULT_SIZES.profile },
      { type: 'feature', label: 'Feature', ...DEFAULT_SIZES.feature },
      { type: 'team', label: 'Team', ...DEFAULT_SIZES.team },
      { type: 'login', label: 'Login', ...DEFAULT_SIZES.login },
      { type: 'contact', label: 'Contact', ...DEFAULT_SIZES.contact },
    ],
  },
]

const BROWSER_ANNOTATION_DEFAULT_SETTINGS: BrowserAnnotationRuntimeSettings = {
  blockInteractions: true,
  clearOnCopySend: false,
  markerClickBehavior: 'delete',
  markerColorId: 'blue',
  outputDetail: 'detailed',
  reactDetectionEnabled: true,
  toolbarPosition: null,
}

const BROWSER_ANNOTATION_POPUP_STYLE_FIELDS: ReadonlyArray<{
  key: keyof BrowserAnnotationElementStyle
  property: string
}> = [
  { key: 'display', property: 'display' },
  { key: 'color', property: 'color' },
  { key: 'backgroundColor', property: 'background-color' },
  { key: 'fontSize', property: 'font-size' },
  { key: 'fontWeight', property: 'font-weight' },
  { key: 'width', property: 'width' },
  { key: 'height', property: 'height' },
  { key: 'paddingTop', property: 'padding-top' },
  { key: 'paddingRight', property: 'padding-right' },
  { key: 'paddingBottom', property: 'padding-bottom' },
  { key: 'paddingLeft', property: 'padding-left' },
]

function browserAnnotationFreezeState(): BrowserAnnotationFreezeState {
  const globalWindow = window as Window & {
    [BROWSER_ANNOTATION_FREEZE_STATE_KEY]?: BrowserAnnotationFreezeState
  }
  if (!globalWindow[BROWSER_ANNOTATION_FREEZE_STATE_KEY]) {
    globalWindow[BROWSER_ANNOTATION_FREEZE_STATE_KEY] = {
      frozen: false,
      installed: false,
      originalSetTimeout: window.setTimeout.bind(window),
      originalSetInterval: window.setInterval.bind(window),
      originalRequestAnimationFrame: window.requestAnimationFrame.bind(window),
      pausedAnimations: [],
      timeoutQueue: [],
      rafQueue: [],
    }
  }
  return globalWindow[BROWSER_ANNOTATION_FREEZE_STATE_KEY]
}

function installBrowserAnnotationFreezePatches(): BrowserAnnotationFreezeState {
  const state = browserAnnotationFreezeState()
  if (state.installed) {
    return state
  }

  window.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
    if (typeof handler === 'string') {
      return state.originalSetTimeout(handler, timeout)
    }
    return state.originalSetTimeout((...callbackArgs: unknown[]) => {
      if (state.frozen) {
        state.timeoutQueue.push(() => handler(...callbackArgs))
        return
      }
      handler(...callbackArgs)
    }, timeout, ...args)
  }) as typeof window.setTimeout

  window.setInterval = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
    if (typeof handler === 'string') {
      return state.originalSetInterval(handler, timeout)
    }
    return state.originalSetInterval((...callbackArgs: unknown[]) => {
      if (!state.frozen) {
        handler(...callbackArgs)
      }
    }, timeout, ...args)
  }) as typeof window.setInterval

  window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
    return state.originalRequestAnimationFrame((timestamp: DOMHighResTimeStamp) => {
      if (state.frozen) {
        state.rafQueue.push(callback)
        return
      }
      callback(timestamp)
    })
  }) as typeof window.requestAnimationFrame

  state.installed = true
  return state
}

export function installBrowserAnnotationRuntime(): void {
  const runtime = new BrowserAnnotationRuntime()
  ipcRenderer.on(
    BROWSER_ANNOTATION_RUNTIME_COMMAND_CHANNEL,
    (_event, command: BrowserAnnotationRuntimeCommand) => {
      runtime.handleCommand(command)
    },
  )
}

class BrowserAnnotationRuntime {
  private root: HTMLDivElement | null = null
  private layer: HTMLDivElement | null = null
  private markerLayer: HTMLDivElement | null = null
  private placementLayer: HTMLDivElement | null = null
  private toolbar: HTMLDivElement | null = null
  private settingsPanel: HTMLDivElement | null = null
  private layoutPanel: HTMLDivElement | null = null
  private notice: HTMLDivElement | null = null
  private toolbarHasEntered = false
  private highlight: HTMLDivElement | null = null
  private highlightLabel: HTMLDivElement | null = null
  private region: HTMLDivElement | null = null
  private editor: HTMLDivElement | null = null
  private textarea: HTMLTextAreaElement | null = null
  private fileInput: HTMLInputElement | null = null
  private selectedElement: Element | null = null
  private designElement: Element | null = null
  private selectedElements: Element[] = []
  private selectedAnchor: BrowserAnnotationAnchor | null = null
  private designChange: BrowserAnnotationDesignChange | null = null
  private attachedImages: BrowserPanelPromptAttachment[] = []
  private dragStart: { x: number, y: number, altKey: boolean, shiftKey: boolean } | null = null
  private textDragStart: { x: number, y: number, altKey: boolean, shiftKey: boolean } | null = null
  private layoutSelectStart: { x: number, y: number, additive: boolean } | null = null
  private layoutSelectionBox: HTMLDivElement | null = null
  private selectionFrames: HTMLDivElement[] = []
  private stopTimer: number | null = null
  private noticeTimer: number | null = null
  private shakeTimer: number | null = null
  private active = false
  private selectionEnabled = true
  private stage: BrowserAnnotationRuntimeStage = 'selecting'
  private annotations: BrowserAnnotationRuntimeAnnotation[] = []
  private placements: BrowserAnnotationLayoutPlacement[] = []
  private rearrangements: BrowserAnnotationLayoutRearrangement[] = []
  private selectedPlacementIds = new Set<string>()
  private exitingPlacementIds = new Set<string>()
  private markerExitingIds = new Set<string>()
  private markerNumberByAnnotationId = new Map<string, number>()
  private editingAnnotationId: string | null = null
  private activeLayoutComponent: BrowserAnnotationLayoutComponentDefinition | null = null
  private markersVisible = true
  private pageFrozen = false
  private layoutMode = false
  private showSettings = false
  private blockInteractions = BROWSER_ANNOTATION_DEFAULT_SETTINGS.blockInteractions
  private clearOnCopySend = BROWSER_ANNOTATION_DEFAULT_SETTINGS.clearOnCopySend
  private markerClickBehavior: BrowserAnnotationMarkerClickBehavior = BROWSER_ANNOTATION_DEFAULT_SETTINGS.markerClickBehavior
  private markerColorId: BrowserAnnotationMarkerColorId = BROWSER_ANNOTATION_DEFAULT_SETTINGS.markerColorId
  private outputDetail: BrowserAnnotationOutputDetail = BROWSER_ANNOTATION_DEFAULT_SETTINGS.outputDetail
  private reactDetectionEnabled = BROWSER_ANNOTATION_DEFAULT_SETTINGS.reactDetectionEnabled
  private toolbarPosition: { x: number, y: number } | null = BROWSER_ANNOTATION_DEFAULT_SETTINGS.toolbarPosition
  private wireframeMode = false
  private wireframeOpacity = 0.22
  private wireframePurpose = ''

  constructor() {
    this.applySettings(this.loadSettings())
    window.addEventListener('keydown', this.onKeyDown, true)
    window.addEventListener('resize', this.onWindowResize, true)
    window.addEventListener('scroll', this.onWindowScroll, true)
  }

  handleCommand(command: BrowserAnnotationRuntimeCommand): void {
    if (command.type === 'start') {
      const wasActive = this.active
      this.annotations = command.annotations ?? []
      this.hydrateLayoutHints(command.layoutHints ?? [])
      this.start()
      if (wasActive) {
        this.renderMarkers()
        this.renderPlacements()
        this.renderToolbar()
      }
      if (command.editAnnotationId) {
        const annotation = this.annotations.find(item => item.id === command.editAnnotationId)
        if (annotation) {
          this.editAnnotationInline(annotation)
        }
      }
      return
    }
    if (command.type === 'stop') {
      this.stop('closed')
      return
    }
    if (command.type === 'apply-design') {
      this.applyDesign(command.selector, command.designChange ?? {})
      return
    }
    if (command.type === 'clear-design') {
      this.clearDesign()
      return
    }
    if (command.type === 'notify' && command.notification) {
      this.showNotice(command.notification.message, command.notification.tone)
    }
  }

  private start(): void {
    if (this.active) {
      return
    }
    this.active = true
    this.selectionEnabled = true
    this.stage = 'selecting'
    this.mount()
    this.emit({ type: 'ready', surfaceSize: this.surfaceSize(), elements: this.scanElements() })
  }

  private stop(eventType: 'cancel' | 'closed'): void {
    if (!this.active && !this.root) {
      return
    }
    if (eventType === 'cancel' && this.root && !this.root.hasAttribute('data-cradle-browser-comment-exiting')) {
      this.active = false
      this.root.setAttribute('data-cradle-browser-comment-exiting', 'true')
      if (this.stopTimer !== null) {
        clearTimeout(this.stopTimer)
      }
      this.stopTimer = this.nativeSetTimeout(() => {
        this.stopTimer = null
        this.finishStop(eventType)
      }, 150)
      return
    }
    this.finishStop(eventType)
  }

  private finishStop(eventType: 'cancel' | 'closed'): void {
    if (!this.active && !this.root) {
      return
    }
    if (this.stopTimer !== null) {
      clearTimeout(this.stopTimer)
      this.stopTimer = null
    }
    if (this.shakeTimer !== null) {
      clearTimeout(this.shakeTimer)
      this.shakeTimer = null
    }
    if (this.noticeTimer !== null) {
      clearTimeout(this.noticeTimer)
      this.noticeTimer = null
    }
    this.active = false
    this.selectionEnabled = true
    this.stage = 'selecting'
    this.clearDesign()
    document.removeEventListener('pointerdown', this.onDocumentPointerDown, true)
    document.removeEventListener('pointermove', this.onDocumentPointerMove, true)
    document.removeEventListener('pointerup', this.onDocumentPointerUp, true)
    document.removeEventListener('mouseup', this.onDocumentMouseUp, true)
    this.root?.remove()
    this.root = null
    this.layer = null
    this.highlight = null
    this.highlightLabel = null
    this.region = null
    this.editor = null
    this.textarea = null
    this.fileInput = null
    this.markerLayer = null
    this.placementLayer = null
    this.toolbar = null
    this.settingsPanel = null
    this.layoutPanel = null
    this.notice = null
    this.toolbarHasEntered = false
    this.selectedAnchor = null
    this.editingAnnotationId = null
    this.markerExitingIds.clear()
    this.markerNumberByAnnotationId.clear()
    this.textDragStart = null
    this.selectedPlacementIds.clear()
    this.selectedElement = null
    this.designElement = null
    this.selectedElements = []
    this.attachedImages = []
    this.pageFrozen = false
    this.layoutMode = false
    this.showSettings = false
    this.wireframeMode = false
    this.clearSelectionFrames()
    this.clearLayoutSelectionBox()
    this.clearWireframeStyle()
    this.clearFreezeStyle()
    this.emit({ type: eventType })
  }

  private mount(): void {
    this.root?.remove()
    const root = document.createElement('div')
    root.id = 'cradle-browser-comment-root'
    root.setAttribute('data-cradle-browser-comment-root', 'true')
    this.applyRootSettings(root)

    const style = document.createElement('style')
    style.textContent = `
      #cradle-browser-comment-root {
        --cradle-browser-comment-accent: ${BROWSER_ANNOTATION_MARKER_COLORS[this.markerColorId]};
        --cradle-browser-comment-blue: #0088ff;
        --cradle-browser-comment-green: #34c759;
        --cradle-browser-comment-red: #ff383c;
        position: fixed;
        inset: 0;
        z-index: 2147483646;
        pointer-events: none;
        color-scheme: light;
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        -webkit-font-smoothing: antialiased;
      }
      #cradle-browser-comment-root svg[fill="none"] {
        fill: none !important;
      }
      #cradle-browser-comment-root svg[fill="none"] :not([fill]) {
        fill: none !important;
      }
      #cradle-browser-comment-root :where(button, input, textarea, label) {
        box-sizing: border-box;
        appearance: none;
        background: unset;
        border: unset;
        border-radius: unset;
        color: unset;
        font-family: unset;
        font-size: unset;
        font-style: unset;
        font-weight: unset;
        letter-spacing: unset;
        line-height: unset;
        margin: unset;
        outline: unset;
        padding: unset;
        text-decoration: unset;
        text-transform: unset;
        box-shadow: unset;
      }
      #cradle-browser-comment-root [data-cradle-browser-comment-layer] {
        position: absolute;
        inset: 0;
        cursor: crosshair;
        pointer-events: auto;
        background: transparent;
      }
      #cradle-browser-comment-root[data-cradle-browser-block-interactions="false"] [data-cradle-browser-comment-layer] {
        pointer-events: none;
      }
      #cradle-browser-comment-root[data-cradle-browser-selection-enabled="false"] [data-cradle-browser-comment-layer] {
        pointer-events: none;
      }
      #cradle-browser-comment-root[data-cradle-browser-layout-mode="true"] [data-cradle-browser-comment-layer] {
        pointer-events: none;
      }
      #cradle-browser-comment-root [data-cradle-browser-comment-highlight],
      #cradle-browser-comment-root [data-cradle-browser-comment-region],
      #cradle-browser-comment-root [data-cradle-browser-comment-selection-frame] {
        position: absolute;
        box-sizing: border-box;
        border: 2px solid var(--cradle-browser-comment-accent);
        border-radius: 4px;
        pointer-events: none;
      }
      #cradle-browser-comment-root [data-cradle-browser-comment-highlight] {
        background: rgba(0, 136, 255, 0.10);
        box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.68), 0 2px 10px rgba(0, 0, 0, 0.16);
        transform-origin: center;
        transition:
          left 140ms cubic-bezier(0.22, 1, 0.36, 1),
          top 140ms cubic-bezier(0.22, 1, 0.36, 1),
          width 140ms cubic-bezier(0.22, 1, 0.36, 1),
          height 140ms cubic-bezier(0.22, 1, 0.36, 1),
          transform 140ms cubic-bezier(0.22, 1, 0.36, 1),
          opacity 120ms cubic-bezier(0.22, 1, 0.36, 1);
        will-change: left, top, width, height, transform, opacity;
      }
      #cradle-browser-comment-root [data-cradle-browser-comment-region] {
        background: rgba(0, 136, 255, 0.10);
        box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.68), 0 2px 10px rgba(0, 0, 0, 0.16);
        animation: cradle-browser-comment-frame-in 160ms cubic-bezier(0.22, 1, 0.36, 1);
      }
      #cradle-browser-comment-root [data-cradle-browser-comment-highlight-label],
      #cradle-browser-comment-root [data-cradle-browser-comment-selection-label] {
        position: absolute;
        box-sizing: border-box;
        max-width: min(220px, calc(100vw - 16px));
        min-height: 22px;
        display: flex;
        align-items: center;
        gap: 5px;
        padding: 4px 7px;
        border-radius: 12px;
        color: rgba(255, 255, 255, 0.86);
        background: #1a1a1a;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.30), 0 0 0 1px rgba(255, 255, 255, 0.08);
        font: 500 11px/1.25 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        pointer-events: none;
        animation: cradle-browser-comment-label-in 100ms ease-out both;
        transition:
          left 140ms cubic-bezier(0.22, 1, 0.36, 1),
          top 140ms cubic-bezier(0.22, 1, 0.36, 1),
          transform 140ms cubic-bezier(0.22, 1, 0.36, 1),
          opacity 120ms cubic-bezier(0.22, 1, 0.36, 1);
        will-change: left, top, transform, opacity;
      }
      #cradle-browser-comment-root [data-cradle-browser-comment-highlight-label] span,
      #cradle-browser-comment-root [data-cradle-browser-comment-selection-label] span {
        min-width: 0;
        overflow-wrap: anywhere;
        white-space: normal;
        word-break: break-word;
      }
      #cradle-browser-comment-root [data-cradle-browser-comment-selection-frame] {
        background: rgba(0, 136, 255, 0.10);
        box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.68), 0 2px 10px rgba(0, 0, 0, 0.16);
        animation: cradle-browser-comment-frame-in 160ms cubic-bezier(0.22, 1, 0.36, 1);
        transition:
          left 160ms cubic-bezier(0.22, 1, 0.36, 1),
          top 160ms cubic-bezier(0.22, 1, 0.36, 1),
          width 160ms cubic-bezier(0.22, 1, 0.36, 1),
          height 160ms cubic-bezier(0.22, 1, 0.36, 1),
          opacity 120ms cubic-bezier(0.22, 1, 0.36, 1);
        will-change: left, top, width, height, opacity;
      }
      #cradle-browser-comment-root [data-cradle-browser-comment-selection-frame][data-multi="true"] {
        border-color: var(--cradle-browser-comment-green);
        background: rgba(52, 199, 89, 0.10);
      }
      #cradle-browser-comment-root [data-cradle-browser-comment-selection-label][data-multi="true"] {
        color: #fff;
        background: var(--cradle-browser-comment-green);
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.24), 0 0 0 1px rgba(0, 0, 0, 0.04);
      }
      #cradle-browser-comment-root [data-cradle-browser-comment-marker-layer] {
        position: absolute;
        inset: 0;
        pointer-events: none;
      }
      #cradle-browser-comment-root [data-cradle-browser-comment-placement-layer] {
        position: absolute;
        inset: 0;
        pointer-events: none;
      }
      #cradle-browser-comment-root[data-cradle-browser-layout-mode="true"] [data-cradle-browser-comment-placement-layer] {
        pointer-events: auto;
        cursor: crosshair;
      }
      #cradle-browser-comment-root [data-cradle-browser-comment-placement] {
        position: absolute;
        box-sizing: border-box;
        display: flex;
        min-width: 44px;
        min-height: 28px;
        align-items: flex-start;
        justify-content: space-between;
        gap: 8px;
        border: 1.5px dashed var(--cradle-browser-comment-green);
        border-radius: 8px;
        padding: 8px;
        color: #16702e;
        background: rgba(52, 199, 89, 0.12);
        box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.65), 0 4px 16px rgba(0, 0, 0, 0.12);
        font: 600 12px/1.2 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        pointer-events: auto;
        cursor: grab;
        user-select: none;
        animation: cradle-browser-comment-frame-in 160ms cubic-bezier(0.22, 1, 0.36, 1);
      }
      #cradle-browser-comment-root [data-cradle-browser-comment-placement][data-exiting="true"] {
        opacity: 0;
        transform: scale(0.85);
        transition:
          opacity 180ms ease,
          transform 180ms ease;
        pointer-events: none;
      }
      #cradle-browser-comment-root [data-cradle-browser-comment-placement]:active {
        cursor: grabbing;
      }
      #cradle-browser-comment-root [data-cradle-browser-comment-placement][data-selected="true"] {
        border-style: solid;
        background: rgba(52, 199, 89, 0.18);
        box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.75), 0 8px 22px rgba(0, 0, 0, 0.18);
      }
      #cradle-browser-comment-root [data-cradle-browser-comment-placement] small {
        display: block;
        margin-top: 4px;
        color: rgba(22, 112, 46, 0.70);
        font: 500 10px/1.2 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      #cradle-browser-comment-root [data-cradle-browser-comment-resize-handle] {
        position: absolute;
        width: 10px;
        height: 10px;
        border-radius: 50%;
        background: var(--cradle-browser-comment-green);
        box-shadow: 0 0 0 2px #fff, 0 2px 5px rgba(0, 0, 0, 0.18);
      }
      #cradle-browser-comment-root [data-cradle-browser-comment-resize-handle="nw"] {
        left: -5px;
        top: -5px;
        cursor: nwse-resize;
      }
      #cradle-browser-comment-root [data-cradle-browser-comment-resize-handle="n"] {
        left: calc(50% - 5px);
        top: -5px;
        cursor: ns-resize;
      }
      #cradle-browser-comment-root [data-cradle-browser-comment-resize-handle="ne"] {
        right: -5px;
        top: -5px;
        cursor: nesw-resize;
      }
      #cradle-browser-comment-root [data-cradle-browser-comment-resize-handle="e"] {
        right: -5px;
        top: calc(50% - 5px);
        cursor: ew-resize;
      }
      #cradle-browser-comment-root [data-cradle-browser-comment-resize-handle="se"] {
        right: -5px;
        bottom: -5px;
        cursor: nwse-resize;
      }
      #cradle-browser-comment-root [data-cradle-browser-comment-resize-handle="s"] {
        left: calc(50% - 5px);
        bottom: -5px;
        cursor: ns-resize;
      }
      #cradle-browser-comment-root [data-cradle-browser-comment-resize-handle="sw"] {
        left: -5px;
        bottom: -5px;
        cursor: nesw-resize;
      }
      #cradle-browser-comment-root [data-cradle-browser-comment-resize-handle="w"] {
        left: -5px;
        top: calc(50% - 5px);
        cursor: ew-resize;
      }
      #cradle-browser-comment-root [data-cradle-browser-comment-snap-guide] {
        position: absolute;
        z-index: 4;
        background: var(--cradle-browser-comment-accent);
        opacity: 0.76;
        pointer-events: none;
      }
      #cradle-browser-comment-root [data-cradle-browser-comment-layout-selection] {
        position: absolute;
        z-index: 3;
        box-sizing: border-box;
        border: 1.5px solid var(--cradle-browser-comment-blue);
        border-radius: 6px;
        background: rgba(0, 136, 255, 0.10);
        box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.64), 0 4px 16px rgba(0, 0, 0, 0.10);
        pointer-events: none;
        animation: cradle-browser-comment-frame-in 120ms cubic-bezier(0.22, 1, 0.36, 1);
      }
      #cradle-browser-comment-root [data-cradle-browser-comment-snap-guide][data-axis="x"] {
        top: 0;
        width: 1px;
        height: 100vh;
      }
      #cradle-browser-comment-root [data-cradle-browser-comment-snap-guide][data-axis="y"] {
        left: 0;
        width: 100vw;
        height: 1px;
      }
      #cradle-browser-comment-root [data-cradle-browser-comment-placement-remove] {
        width: 20px;
        min-width: 20px;
        height: 20px;
        border-radius: 50%;
        color: #fff;
        background: rgba(22, 112, 46, 0.75);
        font: 700 13px/20px ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        text-align: center;
        cursor: pointer;
      }
      #cradle-browser-comment-root [data-cradle-browser-comment-rearrange] {
        position: absolute;
        box-sizing: border-box;
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 8px;
        border: 1.5px dashed #ff9500;
        border-radius: 8px;
        padding: 7px;
        color: #7a4200;
        background: rgba(255, 149, 0, 0.10);
        box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.65), 0 4px 16px rgba(0, 0, 0, 0.10);
        font: 600 12px/1.2 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        pointer-events: auto;
        cursor: grab;
        user-select: none;
      }
      #cradle-browser-comment-root [data-cradle-browser-comment-rearrange][data-moved="true"] {
        background: rgba(255, 149, 0, 0.18);
        box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.70), 0 6px 18px rgba(0, 0, 0, 0.16);
      }
      #cradle-browser-comment-root [data-cradle-browser-comment-rearrange]:active {
        cursor: grabbing;
      }
      #cradle-browser-comment-root [data-cradle-browser-comment-rearrange] small {
        display: block;
        margin-top: 4px;
        color: rgba(122, 66, 0, 0.72);
        font: 500 10px/1.2 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      #cradle-browser-comment-root [data-cradle-browser-comment-notice] {
        position: fixed;
        z-index: 11;
        max-width: min(280px, calc(100vw - 24px));
        padding: 8px 11px;
        border-radius: 12px;
        color: #fff;
        background: rgba(26, 26, 26, 0.94);
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.24), 0 0 0 1px rgba(255, 255, 255, 0.08);
        font: 500 12px/1.35 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        text-align: center;
        pointer-events: none;
        -webkit-font-smoothing: antialiased;
        animation: cradle-browser-comment-notice-in 140ms cubic-bezier(0.22, 1, 0.36, 1) both;
      }
      #cradle-browser-comment-root [data-cradle-browser-comment-notice][data-tone="success"] {
        background: rgba(24, 122, 58, 0.95);
      }
      #cradle-browser-comment-root [data-cradle-browser-comment-notice][data-tone="error"] {
        background: rgba(180, 35, 24, 0.95);
      }
      #cradle-browser-comment-root [data-cradle-browser-comment-notice][data-exiting="true"] {
        opacity: 0;
        transform: translateY(3px) scale(0.98);
        transition:
          opacity 120ms ease,
          transform 120ms ease;
      }
      #cradle-browser-comment-root [data-cradle-browser-comment-settings],
      #cradle-browser-comment-root [data-cradle-browser-comment-layout-panel] {
        position: fixed;
        right: 20px;
        bottom: 72px;
        z-index: 10;
        width: 292px;
        max-height: min(620px, calc(100vh - 96px));
        overflow: auto;
        border-radius: 1rem;
        padding: 12px;
        color: #fff;
        background: #1a1a1a;
        box-shadow: 0 4px 24px rgba(0, 0, 0, 0.30), 0 0 0 1px rgba(255, 255, 255, 0.08);
        pointer-events: auto;
        animation: cradle-browser-comment-popup-enter 200ms cubic-bezier(0.34, 1.56, 0.64, 1) both;
      }
      #cradle-browser-comment-root [data-cradle-browser-comment-settings] h3,
      #cradle-browser-comment-root [data-cradle-browser-comment-layout-panel] h3 {
        margin: 0 0 8px;
        color: rgba(255, 255, 255, 0.92);
        font: 600 12px/1.2 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      #cradle-browser-comment-root [data-cradle-browser-comment-settings] label {
        width: 100%;
        display: flex;
        align-items: center;
        justify-content: space-between;
        border-radius: 10px;
        padding: 8px;
        color: rgba(255, 255, 255, 0.76);
        background: rgba(255, 255, 255, 0.05);
      }
      #cradle-browser-comment-root [data-cradle-browser-comment-settings-section],
      #cradle-browser-comment-root [data-cradle-browser-comment-layout-section] {
        display: grid;
        gap: 8px;
        margin-top: 10px;
      }
      #cradle-browser-comment-root [data-cradle-browser-comment-segment] {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 4px;
        border-radius: 0.5rem;
        padding: 4px;
        background: rgba(255, 255, 255, 0.06);
      }
      #cradle-browser-comment-root [data-cradle-browser-comment-segment="four"] {
        grid-template-columns: repeat(4, minmax(0, 1fr));
      }
      #cradle-browser-comment-root [data-cradle-browser-comment-segment-button],
      #cradle-browser-comment-root [data-cradle-browser-comment-palette-button] {
        min-height: 30px;
        border-radius: 0.375rem;
        padding: 0 8px;
        color: rgba(255, 255, 255, 0.70);
        background: transparent;
        font: 600 11px/1 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        transition:
          background-color 150ms ease,
          color 150ms ease,
          transform 100ms ease;
      }
      #cradle-browser-comment-root [data-cradle-browser-comment-segment-button]:hover,
      #cradle-browser-comment-root [data-cradle-browser-comment-palette-button]:hover {
        color: #fff;
        background: rgba(255, 255, 255, 0.10);
      }
      #cradle-browser-comment-root [data-cradle-browser-comment-segment-button]:active,
      #cradle-browser-comment-root [data-cradle-browser-comment-palette-button]:active {
        transform: scale(0.98);
      }
      #cradle-browser-comment-root [data-cradle-browser-comment-segment-button][data-active="true"] {
        color: #fff;
        background: rgba(255, 255, 255, 0.18);
      }
      #cradle-browser-comment-root [data-cradle-browser-comment-palette-button][data-active="true"] {
        color: #fff;
        background: color-mix(in srgb, var(--cradle-browser-comment-green) 22%, transparent);
      }
      #cradle-browser-comment-root [data-cradle-browser-comment-color-row] {
        display: flex;
        gap: 8px;
        border-radius: 0.5rem;
        padding: 8px;
        background: rgba(255, 255, 255, 0.05);
      }
      #cradle-browser-comment-root [data-cradle-browser-comment-color-button] {
        width: 22px;
        height: 22px;
        border-radius: 50%;
        box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.20);
        transition:
          transform 100ms ease,
          box-shadow 150ms ease;
      }
      #cradle-browser-comment-root [data-cradle-browser-comment-color-button][data-active="true"] {
        box-shadow: 0 0 0 2px #fff, inset 0 0 0 1px rgba(0, 0, 0, 0.12);
      }
      #cradle-browser-comment-root [data-cradle-browser-comment-color-button]:active {
        transform: scale(0.94);
      }
      #cradle-browser-comment-root [data-cradle-browser-comment-palette-grid] {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 6px;
      }
      #cradle-browser-comment-root [data-cradle-browser-comment-palette-button] {
        display: flex;
        height: 36px;
        align-items: center;
        justify-content: flex-start;
        gap: 8px;
        text-align: left;
      }
      #cradle-browser-comment-root [data-cradle-browser-comment-palette-icon] {
        width: 18px;
        min-width: 18px;
        height: 14px;
        border: 1px solid rgba(255, 255, 255, 0.45);
        border-radius: 4px;
        opacity: 0.8;
      }
      #cradle-browser-comment-root [data-cradle-browser-comment-drag-preview] {
        position: fixed;
        z-index: 12;
        box-sizing: border-box;
        display: flex;
        align-items: center;
        justify-content: center;
        border: 1.5px dashed var(--cradle-browser-comment-green);
        border-radius: 8px;
        color: #16702e;
        background: rgba(52, 199, 89, 0.14);
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18), 0 0 0 1px rgba(255, 255, 255, 0.75);
        font: 700 10px/1 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        pointer-events: none;
        user-select: none;
      }
      #cradle-browser-comment-root [data-cradle-browser-comment-wireframe-input] {
        width: 100%;
        height: 34px;
        border-radius: 0.5rem;
        padding: 0 10px;
        color: #fff;
        background: rgba(255, 255, 255, 0.08);
        font: 500 12px/1 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      #cradle-browser-comment-root input[type="checkbox"] {
        width: 32px;
        height: 18px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.18);
        box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08);
        transition: background-color 150ms ease;
      }
      #cradle-browser-comment-root input[type="checkbox"]::after {
        display: block;
        width: 14px;
        height: 14px;
        margin: 2px;
        border-radius: 50%;
        background: #fff;
        content: "";
        transition: transform 150ms ease;
      }
      #cradle-browser-comment-root input[type="checkbox"]:checked {
        background: var(--cradle-browser-comment-accent);
      }
      #cradle-browser-comment-root input[type="checkbox"]:checked::after {
        transform: translateX(14px);
      }
      #cradle-browser-comment-root input[type="range"] {
        appearance: none;
        -webkit-appearance: none;
        width: 100%;
        height: 4px;
        border-radius: 2px;
        background: rgba(255, 255, 255, 0.16);
        accent-color: var(--cradle-browser-comment-accent);
        cursor: pointer;
      }
      #cradle-browser-comment-root input[type="range"]::-webkit-slider-thumb {
        -webkit-appearance: none;
        width: 14px;
        height: 14px;
        border: 0;
        border-radius: 50%;
        background: var(--cradle-browser-comment-accent);
        box-shadow: 0 0 0 2px #1a1a1a, 0 2px 6px rgba(0, 0, 0, 0.22);
        transition:
          transform 120ms ease,
          box-shadow 120ms ease;
      }
      #cradle-browser-comment-root input[type="range"]:hover::-webkit-slider-thumb {
        transform: scale(1.15);
        box-shadow: 0 0 0 3px #1a1a1a, 0 3px 9px rgba(0, 0, 0, 0.28);
      }
      #cradle-browser-comment-root input[type="range"]::-moz-range-thumb {
        width: 14px;
        height: 14px;
        border: 0;
        border-radius: 50%;
        background: var(--cradle-browser-comment-accent);
        box-shadow: 0 0 0 2px #1a1a1a, 0 2px 6px rgba(0, 0, 0, 0.22);
      }
      #cradle-browser-comment-root input[type="range"]::-moz-range-track {
        height: 4px;
        border-radius: 2px;
        background: rgba(255, 255, 255, 0.16);
      }
      #cradle-browser-comment-root [data-cradle-browser-comment-settings] p,
      #cradle-browser-comment-root [data-cradle-browser-comment-layout-panel] p {
        margin: 0;
        color: rgba(255, 255, 255, 0.58);
        font: 400 12px/1.45 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      @keyframes cradle-browser-comment-frame-in {
        from {
          opacity: 0;
          transform: scale(0.96);
        }
        to {
          opacity: 1;
          transform: scale(1);
        }
      }
      @keyframes cradle-browser-comment-label-in {
        from {
          opacity: 0;
          transform: scale(0.95) translateY(4px);
        }
        to {
          opacity: 1;
          transform: scale(1) translateY(0);
        }
      }
      @keyframes cradle-browser-comment-marker-in {
        from {
          opacity: 0;
          transform: translate(-50%, -50%) scale(0.3);
        }
        to {
          opacity: 1;
          transform: translate(-50%, -50%) scale(1);
        }
      }
      @keyframes cradle-browser-comment-marker-renumber {
        from {
          opacity: 0;
          transform: translateX(-40%);
        }
        to {
          opacity: 1;
          transform: translateX(0);
        }
      }
      @keyframes cradle-browser-comment-tooltip-in {
        from {
          opacity: 0;
          transform: translateX(-50%) translateY(2px) scale(0.891);
        }
        to {
          opacity: 1;
          transform: translateX(-50%) translateY(0) scale(0.909);
        }
      }
      @keyframes cradle-browser-comment-notice-in {
        from {
          opacity: 0;
          transform: translateY(3px) scale(0.98);
        }
        to {
          opacity: 1;
          transform: translateY(0) scale(1);
        }
      }
      @keyframes cradle-browser-comment-toolbar-enter {
        from {
          opacity: 0;
          transform: scale(0.5) rotate(90deg);
        }
        to {
          opacity: 1;
          transform: scale(1) rotate(0deg);
        }
      }
      @keyframes cradle-browser-comment-popup-enter {
        from {
          opacity: 0;
          transform: scale(0.95) translateY(4px);
        }
        to {
          opacity: 1;
          transform: scale(1) translateY(0);
        }
      }
      @keyframes cradle-browser-comment-popup-exit {
        from {
          opacity: 1;
          transform: scale(1) translateY(0);
        }
        to {
          opacity: 0;
          transform: scale(0.95) translateY(4px);
        }
      }
      @keyframes cradle-browser-comment-popup-shake {
        0%,
        100% {
          transform: scale(1) translateX(0);
        }
        20% {
          transform: scale(1) translateX(-3px);
        }
        40% {
          transform: scale(1) translateX(3px);
        }
        60% {
          transform: scale(1) translateX(-2px);
        }
        80% {
          transform: scale(1) translateX(2px);
        }
      }
      #cradle-browser-comment-root [data-cradle-browser-comment-editor] {
        position: absolute;
        box-sizing: border-box;
        width: min(280px, calc(100vw - 24px));
        min-height: 112px;
        pointer-events: auto;
        border: 0;
        border-radius: 16px;
        background: #1a1a1a;
        box-shadow: 0 4px 24px rgba(0, 0, 0, 0.30), 0 0 0 1px rgba(255, 255, 255, 0.08);
        padding: 12px 16px 14px;
        backdrop-filter: blur(10px);
        animation: cradle-browser-comment-popup-enter 200ms cubic-bezier(0.34, 1.56, 0.64, 1) both;
        transform-origin: 24px 0;
        will-change: transform, opacity;
      }
      #cradle-browser-comment-root[data-cradle-browser-comment-exiting] [data-cradle-browser-comment-editor] {
        animation: cradle-browser-comment-popup-exit 150ms ease-in both;
      }
      #cradle-browser-comment-root[data-cradle-browser-comment-shaking] [data-cradle-browser-comment-editor] {
        animation: cradle-browser-comment-popup-shake 250ms ease-out;
      }
      #cradle-browser-comment-root [data-cradle-browser-comment-prompt-row] {
        display: flex;
        flex-wrap: wrap;
        min-width: 0;
        align-items: baseline;
        gap: 4px 6px;
        color: rgba(255, 255, 255, 0.94);
        font: 400 12px/1.35 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        letter-spacing: 0;
      }
      #cradle-browser-comment-root button[data-cradle-browser-comment-prompt-row] {
        width: 100%;
        height: auto;
        justify-content: flex-start;
        border-radius: 0;
        padding: 0;
        color: rgba(255, 255, 255, 0.94);
        background: transparent;
      }
      #cradle-browser-comment-root button[data-cradle-browser-comment-prompt-row]:hover {
        color: rgba(255, 255, 255, 0.94);
        background: transparent;
      }
      #cradle-browser-comment-root button[data-cradle-browser-comment-prompt-row]:active {
        transform: none;
      }
      #cradle-browser-comment-root [data-cradle-browser-comment-prompt-row] span {
        flex: none;
      }
      #cradle-browser-comment-root [data-cradle-browser-comment-chevron] {
        width: 14px;
        height: 14px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        color: rgba(255, 255, 255, 0.5);
        font: 600 14px/1 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        transform: rotate(0deg);
        transition: transform 250ms cubic-bezier(0.16, 1, 0.3, 1);
      }
      #cradle-browser-comment-root [data-cradle-browser-comment-chevron][data-expanded="true"] {
        transform: rotate(90deg);
      }
      #cradle-browser-comment-root [data-cradle-browser-comment-token] {
        display: inline-flex;
        max-width: min(188px, calc(100vw - 80px));
        min-width: 0;
        align-items: center;
        border-radius: 999px;
        padding: 2px 6px;
        color: #ffffff;
        background: var(--cradle-browser-comment-accent);
      }
      #cradle-browser-comment-root [data-cradle-browser-comment-token] span {
        min-width: 0;
        overflow-wrap: anywhere;
        white-space: normal;
        word-break: break-word;
      }
      #cradle-browser-comment-root [data-cradle-browser-comment-editor-drag-handle] {
        position: absolute;
        inset: 0 0 auto;
        height: 30px;
        cursor: grab;
      }
      #cradle-browser-comment-root [data-cradle-browser-comment-editor-drag-handle]:active {
        cursor: grabbing;
      }
      #cradle-browser-comment-root [data-cradle-browser-comment-styles-wrapper] {
        display: grid;
        grid-template-rows: 0fr;
        transition: grid-template-rows 300ms cubic-bezier(0.16, 1, 0.3, 1);
      }
      #cradle-browser-comment-root [data-cradle-browser-comment-styles-wrapper][data-expanded="true"] {
        grid-template-rows: 1fr;
      }
      #cradle-browser-comment-root [data-cradle-browser-comment-styles-inner] {
        overflow: hidden;
      }
      #cradle-browser-comment-root [data-cradle-browser-comment-styles-block] {
        box-sizing: border-box;
        width: 100%;
        margin: 8px 0 0;
        border-radius: 6px;
        padding: 8px 10px;
        background: rgba(255, 255, 255, 0.05);
        color: rgba(255, 255, 255, 0.85);
        font: 11px/1.5 ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
      }
      #cradle-browser-comment-root [data-cradle-browser-comment-style-line] {
        word-break: break-word;
      }
      #cradle-browser-comment-root [data-cradle-browser-comment-style-property] {
        color: #c792ea;
      }
      #cradle-browser-comment-root textarea {
        display: block;
        box-sizing: border-box;
        width: 100%;
        min-height: 48px;
        margin: 8px 0 0;
        resize: none;
        border: 1px solid rgba(255, 255, 255, 0.15);
        border-radius: 8px;
        padding: 8px 10px;
        color: rgba(255, 255, 255, 0.94);
        background: rgba(255, 255, 255, 0.05);
        font: 400 12px/1.35 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        letter-spacing: 0;
        outline: none;
        transition: border-color 150ms ease;
      }
      #cradle-browser-comment-root textarea:focus {
        border-color: var(--cradle-browser-comment-accent);
      }
      #cradle-browser-comment-root textarea::placeholder {
        color: rgba(255, 255, 255, 0.42);
      }
      #cradle-browser-comment-root [data-cradle-browser-comment-actions] {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-top: 10px;
      }
      #cradle-browser-comment-root button,
      #cradle-browser-comment-root label {
        display: inline-flex;
        min-width: 28px;
        height: 28px;
        align-items: center;
        justify-content: center;
        border-radius: 999px;
        border: 0;
        padding: 0 9px;
        color: rgba(255, 255, 255, 0.62);
        background: transparent;
        font: 500 11px/1 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        cursor: pointer;
        transition: background-color 160ms cubic-bezier(0.2, 0, 0, 1), color 160ms cubic-bezier(0.2, 0, 0, 1), transform 160ms cubic-bezier(0.2, 0, 0, 1);
      }
      #cradle-browser-comment-root button:hover,
      #cradle-browser-comment-root label:hover {
        color: rgba(255, 255, 255, 0.9);
        background: rgba(255, 255, 255, 0.08);
      }
      #cradle-browser-comment-root button:active,
      #cradle-browser-comment-root label:active {
        transform: scale(0.96);
      }
      #cradle-browser-comment-root [data-cradle-browser-comment-ghost] {
        background: rgba(255, 255, 255, 0.06);
      }
      #cradle-browser-comment-root button[data-primary] {
        margin-left: auto;
        width: 28px;
        min-width: 28px;
        padding: 0;
        color: #ffffff;
        background: var(--cradle-browser-comment-accent);
        font-size: 16px;
      }
      #cradle-browser-comment-root button[data-primary]:hover {
        color: #ffffff;
        filter: brightness(0.92);
      }
      #cradle-browser-comment-root [data-cradle-browser-comment-file-count] {
        min-width: 0;
        flex: 1;
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
        color: rgba(255, 255, 255, 0.48);
        font: 11px/1.2 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      #cradle-browser-comment-root input[type="file"] {
        display: none;
      }
      @media (prefers-reduced-motion: reduce) {
        #cradle-browser-comment-root [data-cradle-browser-comment-highlight],
        #cradle-browser-comment-root [data-cradle-browser-comment-highlight-label],
        #cradle-browser-comment-root [data-cradle-browser-comment-selection-label],
        #cradle-browser-comment-root [data-cradle-browser-comment-selection-frame],
        #cradle-browser-comment-root [data-cradle-browser-comment-region],
        #cradle-browser-comment-root [data-cradle-browser-comment-editor],
        #cradle-browser-comment-root [data-cradle-browser-comment-marker],
        #cradle-browser-comment-root [data-cradle-browser-comment-toolbar],
        #cradle-browser-comment-root [data-cradle-browser-comment-settings],
        #cradle-browser-comment-root [data-cradle-browser-comment-layout-panel] {
          animation: none;
          transition: none;
        }
      }
      ${BROWSER_ANNOTATION_MARKER_CSS}
      ${BROWSER_ANNOTATION_TOOLBAR_CSS}
    `
    const layer = document.createElement('div')
    layer.setAttribute('data-cradle-browser-comment-layer', 'true')
    const highlight = document.createElement('div')
    highlight.setAttribute('data-cradle-browser-comment-highlight', 'true')
    highlight.hidden = true
    const highlightLabel = document.createElement('div')
    highlightLabel.setAttribute('data-cradle-browser-comment-highlight-label', 'true')
    highlightLabel.hidden = true
    const region = document.createElement('div')
    region.setAttribute('data-cradle-browser-comment-region', 'true')
    region.hidden = true
    const markerLayer = document.createElement('div')
    markerLayer.setAttribute('data-cradle-browser-comment-marker-layer', 'true')
    const placementLayer = document.createElement('div')
    placementLayer.setAttribute('data-cradle-browser-comment-placement-layer', 'true')

    layer.addEventListener('pointerdown', this.onPointerDown)
    layer.addEventListener('pointermove', this.onPointerMove)
    layer.addEventListener('pointerup', this.onPointerUp)
    layer.addEventListener('pointerleave', this.onPointerLeave)
    placementLayer.addEventListener('pointerdown', this.onLayoutLayerPointerDown)
    document.addEventListener('pointerdown', this.onDocumentPointerDown, true)
    document.addEventListener('pointermove', this.onDocumentPointerMove, true)
    document.addEventListener('pointerup', this.onDocumentPointerUp, true)
    document.addEventListener('mouseup', this.onDocumentMouseUp, true)

    root.append(style, layer, markerLayer, placementLayer, highlight, highlightLabel, region)
    document.documentElement.appendChild(root)
    this.root = root
    this.layer = layer
    this.markerLayer = markerLayer
    this.placementLayer = placementLayer
    this.highlight = highlight
    this.highlightLabel = highlightLabel
    this.region = region
    this.renderMarkers()
    this.renderPlacements()
    this.renderToolbar()
  }

  private readonly onDocumentPointerDown = (event: PointerEvent): void => {
    if (
      this.blockInteractions
      || !this.active
      || this.root?.contains(event.target as Node)
    ) {
      return
    }
    const element = this.elementFromPoint(event.clientX, event.clientY)
    if (element && this.isInteractiveElement(element)) {
      return
    }
    this.onPointerDown(event)
  }

  private readonly onDocumentPointerMove = (event: PointerEvent): void => {
    if (
      this.blockInteractions
      || !this.active
      || this.root?.contains(event.target as Node)
    ) {
      return
    }
    if (this.dragStart || this.textDragStart) {
      this.onPointerMove(event)
      return
    }
    const element = this.elementFromPoint(event.clientX, event.clientY)
    if (element && this.isInteractiveElement(element)) {
      this.hideHighlight()
      return
    }
    this.onPointerMove(event)
  }

  private readonly onDocumentPointerUp = (event: PointerEvent): void => {
    if (
      this.blockInteractions
      || !this.active
      || this.root?.contains(event.target as Node)
      || (!this.dragStart && !this.textDragStart)
    ) {
      return
    }
    this.onPointerUp(event)
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (!this.active || !this.selectionEnabled || event.button !== 0) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    if (this.stage === 'editing') {
      this.shakeEditor()
      return
    }
    const element = this.elementFromPoint(event.clientX, event.clientY)
    const additiveSelection = event.shiftKey || ((event.metaKey || event.ctrlKey) && event.shiftKey)
    if (element && this.isTextSelectionElement(element)) {
      this.textDragStart = {
        x: event.clientX,
        y: event.clientY,
        altKey: event.altKey,
        shiftKey: additiveSelection,
      }
      this.dragStart = null
      this.hideRegion()
      return
    }
    this.dragStart = {
      x: event.clientX,
      y: event.clientY,
      altKey: event.altKey,
      shiftKey: additiveSelection,
    }
    this.layer?.setPointerCapture?.(event.pointerId)
    this.hideRegion()
  }

  private readonly onDocumentMouseUp = (event: MouseEvent): void => {
    if (!this.active || this.stage === 'editing' || this.blockInteractions || this.root?.contains(event.target as Node)) {
      return
    }
    const selection = window.getSelection()
    const text = selection?.toString().replace(/\s+/g, ' ').trim() ?? ''
    if (!selection || text.length === 0 || selection.rangeCount === 0) {
      return
    }
    const rect = selection.getRangeAt(0).getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    this.selectText({
      text,
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
    })
    this.showRegion({
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
    })
    this.openEditor({
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
    }, this.anchorLabel())
    if (this.textarea && !this.textarea.value) {
      this.textarea.placeholder = 'Describe the copy change...'
    }
    this.emitSelection(null)
  }

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (!this.active) {
      return
    }
    if (!this.selectionEnabled) {
      this.hideHighlight()
      return
    }
    if (this.textDragStart) {
      const rect = this.rectFromPoints(this.textDragStart, { x: event.clientX, y: event.clientY })
      if (rect.width > 4 || rect.height > 4) {
        this.showRegion(rect)
      }
      return
    }
    if (this.dragStart) {
      const rect = this.rectFromPoints(this.dragStart, { x: event.clientX, y: event.clientY })
      if (rect.width > 4 || rect.height > 4) {
        this.showRegion(rect)
      }
      return
    }

    if (this.stage === 'editing') {
      this.hideHighlight()
      return
    }

    const element = this.elementFromPoint(event.clientX, event.clientY)
    if (element) {
      const annotationElement = this.readElement(element, 0)
      this.showHighlight(element.getBoundingClientRect(), annotationElement)
      return
    }
    this.hideHighlight()
  }

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (!this.active || !this.selectionEnabled || (!this.dragStart && !this.textDragStart)) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    if (this.textDragStart) {
      const textDragStart = this.textDragStart
      this.textDragStart = null
      if (this.selectTextRangeFromPoints(textDragStart, { x: event.clientX, y: event.clientY })) {
        return
      }
      this.hideRegion()
      const element = this.elementFromPoint(event.clientX, event.clientY)
      if (element) {
        const selected = this.selectElements([element])
        if (selected) {
          this.openEditor(selected.element.rect, this.anchorLabel())
          this.emitSelection(selected.element)
          if (textDragStart.altKey) {
            this.submit('submit')
          }
          return
        }
      }
      return
    }
    if (!this.dragStart) {
      return
    }
    const rect = this.rectFromPoints(this.dragStart, { x: event.clientX, y: event.clientY })
    const dragStart = this.dragStart
    this.dragStart = null

    if (rect.width > 8 && rect.height > 8) {
      this.selectRegion(rect)
      this.showRegion(rect)
      this.openEditor(rect, this.anchorLabel())
      this.emitSelection(null)
      if (dragStart.altKey) {
        this.submit('submit')
      }
      return
    }

    const element = this.elementFromPoint(event.clientX, event.clientY)
    if (element) {
      if (dragStart.shiftKey) {
        const nextSelection = this.selectedElements.includes(element)
          ? this.selectedElements.filter(item => item !== element)
          : [...this.selectedElements, element]
        const selected = this.selectElements(nextSelection.length > 0 ? nextSelection : [element])
        if (selected) {
          this.hideRegion()
          this.openEditor(this.rectForAnchor(selected.anchor), this.anchorLabel())
          this.emitSelection(selected.element)
        }
        return
      }

      const selected = this.selectElements([element])
      if (selected) {
        this.hideRegion()
        this.openEditor(selected.element.rect, this.anchorLabel())
        this.emitSelection(selected.element)
        if (dragStart.altKey) {
          this.submit('submit')
        }
        return
      }
    }

    this.selectPoint(event.clientX, event.clientY)
    this.showRegion({ x: event.clientX - 5, y: event.clientY - 5, width: 10, height: 10 })
    this.openEditor({ x: event.clientX, y: event.clientY, width: 1, height: 1 }, this.anchorLabel())
    this.emitSelection(null)
    if (dragStart.altKey) {
      this.submit('submit')
    }
  }

  private readonly onPointerLeave = (): void => {
    if (!this.dragStart) {
      this.hideHighlight()
    }
  }

  private readonly onWindowResize = (): void => {
    if (!this.active) {
      return
    }
    this.positionToolbar()
    this.positionFloatingPanel(this.settingsPanel)
    this.positionFloatingPanel(this.layoutPanel)
    this.positionNotice()
    this.renderMarkers()
    this.renderPlacements()
  }

  private readonly onWindowScroll = (): void => {
    if (!this.active) {
      return
    }
    this.renderMarkers()
    this.renderPlacements()
    if (this.stage !== 'editing') {
      this.hideHighlight()
    }
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    const isToggleShortcut
      = (event.metaKey || event.ctrlKey)
        && event.shiftKey
        && !event.altKey
        && event.key.toLowerCase() === 'f'
    if (isToggleShortcut) {
      event.preventDefault()
      event.stopPropagation()
      this.emit({ type: 'toggle' })
      return
    }

    if (!this.active) {
      return
    }

    if (event.target === this.textarea) {
      this.onTextareaKeyDown(event)
      return
    }

    if (!event.metaKey && !event.ctrlKey && !event.altKey && !this.isTypingTarget(event.target)) {
      const key = event.key.toLowerCase()
      if (this.layoutMode && this.handleLayoutKeyDown(event)) {
        return
      }
      if (key === 'p') {
        event.preventDefault()
        event.stopPropagation()
        this.togglePause()
        return
      }
      if (key === 'h') {
        event.preventDefault()
        event.stopPropagation()
        this.toggleMarkers()
        return
      }
      if (key === 'c') {
        event.preventDefault()
        event.stopPropagation()
        void this.copyStructuredMarkdown()
        return
      }
      if (key === 'x') {
        event.preventDefault()
        event.stopPropagation()
        this.clearAnnotations()
        return
      }
      if (key === 'l') {
        event.preventDefault()
        event.stopPropagation()
        this.toggleLayoutMode()
        return
      }
    }

    const isAddToChatShortcut
      = event.metaKey
        && !event.shiftKey
        && !event.altKey
        && !event.ctrlKey
        && event.key.toLowerCase() === 'l'
    if (isAddToChatShortcut) {
      if (!this.selectedAnchor) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      this.submit('submit')
      return
    }

    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      if (this.layoutMode && this.selectedPlacementIds.size > 0) {
        this.selectedPlacementIds.clear()
        this.renderPlacements()
        return
      }
      if (this.layoutMode) {
        if (this.activeLayoutComponent) {
          this.activeLayoutComponent = null
          this.renderLayoutPanel()
        }
        this.clearLayoutSelectionBox()
        return
      }
      if (this.showSettings) {
        this.toggleSettings(false)
        return
      }
      this.toggleSelectionEnabled(false)
      return
    }

    const targetElement = this.selectedElement
    if (!targetElement) {
      return
    }

    let nextElement: Element | null = null
    if (event.key === 'Tab') {
      nextElement = event.shiftKey
        ? this.previousNavigableSibling(targetElement)
        : this.nextNavigableSibling(targetElement)
    }
    else if (event.key === 'Enter') {
      nextElement = event.shiftKey
        ? this.navigableParent(targetElement)
        : this.firstNavigableChild(targetElement)
    }

    if (!nextElement) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    const selected = this.selectElements([nextElement])
    if (selected) {
      this.hideRegion()
      this.openEditor(selected.element.rect, this.anchorLabel())
      this.emitSelection(selected.element)
    }
  }

  private handleLayoutKeyDown(event: KeyboardEvent): boolean {
    if (this.selectedPlacementIds.size === 0) {
      return false
    }
    if (event.key === 'Backspace' || event.key === 'Delete') {
      event.preventDefault()
      event.stopPropagation()
      this.removePlacements(new Set(this.selectedPlacementIds))
      return true
    }
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
      return false
    }
    event.preventDefault()
    event.stopPropagation()
    const step = event.shiftKey ? 20 : 1
    const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0
    const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0
    for (const placement of this.placements) {
      if (!this.selectedPlacementIds.has(placement.id)) {
        continue
      }
      placement.x = Math.max(0, Math.min(window.innerWidth - placement.width, placement.x + dx))
      const nextViewportY = this.placementViewportY(placement) + dy
      placement.y = this.placementDocumentY(Math.max(0, Math.min(window.innerHeight - placement.height, nextViewportY)))
      placement.scrollY = Math.round(window.scrollY)
    }
    this.renderPlacements()
    this.syncLayoutHints()
    return true
  }

  private onTextareaKeyDown(event: KeyboardEvent): void {
    const isAddToChatShortcut
      = event.metaKey
        && !event.shiftKey
        && !event.altKey
        && !event.ctrlKey
        && event.key.toLowerCase() === 'l'
    if (isAddToChatShortcut) {
      event.preventDefault()
      event.stopPropagation()
      this.submit('submit')
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      if (this.editingAnnotationId) {
        this.closeInlineEditor()
        return
      }
      this.toggleSelectionEnabled(false)
      return
    }
    if (event.isComposing) {
      return
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      event.stopPropagation()
      this.submit('submit')
    }
  }

  private emitSelection(element: BrowserAnnotationElement | null): void {
    this.emit({
      type: 'selected-element',
      anchor: this.selectedAnchor ?? undefined,
      selectedElement: element,
      surfaceSize: this.surfaceSize(),
      elements: this.scanElements(),
    })
  }

  private openEditor(
    rect: { x: number, y: number, width: number, height: number },
    anchorLabel: string,
    initialBody?: string,
  ): void {
    this.editor?.remove()
    if (!this.root) {
      return
    }

    const editor = document.createElement('div')
    editor.setAttribute('data-cradle-browser-comment-editor', 'true')
    const dragHandle = document.createElement('div')
    dragHandle.setAttribute('data-cradle-browser-comment-editor-drag-handle', 'true')
    const previousBody = initialBody ?? this.textarea?.value ?? this.designChange?.comment ?? ''
    const styleRows = this.selectedAnchor?.kind === 'element'
      ? this.popupStyleRows(this.selectedAnchor.element)
      : []
    const promptRow = document.createElement(styleRows.length > 0 ? 'button' : 'div')
    promptRow.setAttribute('data-cradle-browser-comment-prompt-row', 'true')
    if (promptRow instanceof HTMLButtonElement) {
      promptRow.type = 'button'
      promptRow.setAttribute('aria-expanded', 'false')
      const chevron = document.createElement('span')
      chevron.setAttribute('data-cradle-browser-comment-chevron', 'true')
      chevron.setAttribute('data-expanded', 'false')
      chevron.textContent = '›'
      promptRow.appendChild(chevron)
    }
    const promptPrefix = document.createElement('span')
    promptPrefix.textContent = this.editingAnnotationId ? 'Edit feedback on' : 'Add more detail to'
    const token = document.createElement('span')
    token.setAttribute('data-cradle-browser-comment-token', 'true')
    const tokenText = document.createElement('span')
    tokenText.textContent = anchorLabel
    token.appendChild(tokenText)
    promptRow.append(promptPrefix, token)

    const textarea = document.createElement('textarea')
    textarea.placeholder = 'What should change?'
    textarea.value = previousBody

    const styleWrapper = styleRows.length > 0
      ? this.createStyleAccordion(styleRows, promptRow, textarea)
      : null

    const actions = document.createElement('div')
    actions.setAttribute('data-cradle-browser-comment-actions', 'true')
    const fileLabel = document.createElement('label')
    fileLabel.textContent = 'Attach'
    const fileInput = document.createElement('input')
    fileInput.type = 'file'
    fileInput.accept = 'image/*'
    fileInput.multiple = true
    fileLabel.appendChild(fileInput)
    const fileCount = document.createElement('span')
    fileCount.setAttribute('data-cradle-browser-comment-file-count', 'true')
    fileCount.textContent = this.attachedImages.length === 0
      ? 'No files'
      : `${this.attachedImages.length} file${this.attachedImages.length === 1 ? '' : 's'}`
    const cancelButton = document.createElement('button')
    cancelButton.type = 'button'
    cancelButton.textContent = 'Cancel'
    cancelButton.setAttribute('data-cradle-browser-comment-ghost', 'true')
    const saveButton = document.createElement('button')
    saveButton.type = 'button'
    saveButton.textContent = 'Save'
    saveButton.setAttribute('data-cradle-browser-comment-ghost', 'true')
    const sendButton = document.createElement('button')
    sendButton.type = 'button'
    sendButton.textContent = '↑'
    sendButton.title = 'Add to chat (Command L)'
    sendButton.setAttribute('data-primary', 'true')

    fileInput.addEventListener('change', () => {
      void this.readAttachedFiles(fileInput.files).then((attachments) => {
        this.attachedImages = attachments
        fileCount.textContent = attachments.length === 0
          ? 'No files'
          : `${attachments.length} file${attachments.length === 1 ? '' : 's'}`
      })
    })
    cancelButton.addEventListener('click', () => {
      if (this.editingAnnotationId) {
        this.closeInlineEditor()
        return
      }
      this.clearActiveSelection()
    })
    saveButton.addEventListener('click', () => this.submit('save'))
    sendButton.addEventListener('click', () => this.submit('submit'))

    actions.append(fileLabel, fileCount, cancelButton, saveButton, sendButton)
    if (styleWrapper) {
      editor.append(dragHandle, promptRow, styleWrapper, textarea, actions)
    }
    else {
      editor.append(dragHandle, promptRow, textarea, actions)
    }
    this.root.appendChild(editor)
    this.editor = editor
    this.textarea = textarea
    this.fileInput = fileInput

    const editorWidth = Math.min(280, Math.max(260, window.innerWidth - 24))
    const leftCandidate = rect.x + rect.width + 8
    const fallbackLeft = rect.x
    const left = leftCandidate + editorWidth <= window.innerWidth - 12
      ? leftCandidate
      : fallbackLeft
    const top = Math.min(window.innerHeight - 136, Math.max(12, rect.y + rect.height + 8))
    editor.style.left = `${Math.max(12, Math.min(window.innerWidth - editorWidth - 12, left))}px`
    editor.style.top = `${top}px`
    this.attachEditorDrag(editor, dragHandle)
    textarea.focus()
  }

  private attachEditorDrag(editor: HTMLDivElement, dragHandle: HTMLDivElement): void {
    dragHandle.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      dragHandle.setPointerCapture(event.pointerId)
      const rect = editor.getBoundingClientRect()
      const startX = event.clientX
      const startY = event.clientY
      const initialX = rect.left
      const initialY = rect.top
      const onMove = (moveEvent: PointerEvent): void => {
        moveEvent.preventDefault()
        const nextX = Math.max(8, Math.min(window.innerWidth - rect.width - 8, initialX + moveEvent.clientX - startX))
        const nextY = Math.max(8, Math.min(window.innerHeight - rect.height - 8, initialY + moveEvent.clientY - startY))
        editor.style.left = `${Math.round(nextX)}px`
        editor.style.top = `${Math.round(nextY)}px`
      }
      const onUp = (): void => {
        window.removeEventListener('pointermove', onMove, true)
        window.removeEventListener('pointerup', onUp, true)
        if (dragHandle.hasPointerCapture(event.pointerId)) {
          dragHandle.releasePointerCapture(event.pointerId)
        }
      }
      window.addEventListener('pointermove', onMove, true)
      window.addEventListener('pointerup', onUp, true)
    })
  }

  private renderToolbar(): void {
    if (!this.root) {
      return
    }
    this.toolbar?.remove()
    const totalCount = this.annotations.length + this.placements.length + this.rearrangements.length
    const buttons: BrowserAnnotationToolbarButtonInput[] = [
      {
        id: 'select',
        label: this.selectionEnabled ? 'Stop selecting elements' : 'Select elements',
        shortcut: 'Esc',
        icon: 'cursor',
        active: this.selectionEnabled,
        onClick: () => this.toggleSelectionEnabled(),
      },
      {
        id: 'pause',
        label: this.pageFrozen ? 'Resume animations' : 'Pause animations',
        shortcut: 'P',
        icon: this.pageFrozen ? 'play' : 'pause',
        active: this.pageFrozen,
        onClick: () => this.togglePause(),
      },
      {
        id: 'layout',
        label: this.layoutMode ? 'Exit layout mode' : 'Layout mode',
        shortcut: 'L',
        icon: 'layout',
        active: this.layoutMode,
        onClick: () => this.toggleLayoutMode(),
      },
      {
        id: 'markers',
        label: this.markersVisible ? 'Hide markers' : 'Show markers',
        shortcut: 'H',
        icon: 'eye',
        active: this.markersVisible,
        disabled: this.annotations.length === 0,
        onClick: () => this.toggleMarkers(),
      },
      {
        id: 'copy',
        label: this.layoutMode ? 'Copy layout' : 'Copy feedback',
        shortcut: 'C',
        icon: 'copy',
        disabled: totalCount === 0,
        onClick: () => void this.copyStructuredMarkdown(),
      },
      {
        id: 'clear',
        label: 'Clear all',
        shortcut: 'X',
        icon: 'trash',
        danger: true,
        disabled: totalCount === 0,
        onClick: () => this.clearAnnotations(),
      },
      {
        id: 'settings',
        label: 'Settings',
        icon: 'gear',
        active: this.showSettings,
        onClick: () => this.toggleSettings(),
      },
      {
        id: 'exit',
        label: 'Close comments',
        icon: 'exit',
        danger: true,
        onClick: () => this.stop('cancel'),
      },
    ]
    const toolbar = renderBrowserAnnotationToolbar({
      buttons,
      count: totalCount,
      expanded: true,
      entrance: !this.toolbarHasEntered,
      tooltipBelow: this.toolbarPosition !== null && this.toolbarPosition.y < 100,
      position: this.toolbarPosition,
      onCollapsedClick: () => undefined,
      onPointerDown: (event, currentToolbar) => this.handleToolbarPointerDown(event, currentToolbar),
    })
    this.toolbarHasEntered = true

    this.root.appendChild(toolbar)
    this.toolbar = toolbar
    this.positionToolbar(toolbar)
    if (this.settingsPanel) {
      this.positionFloatingPanel(this.settingsPanel)
    }
    if (this.layoutPanel) {
      this.positionFloatingPanel(this.layoutPanel)
    }
  }

  private handleToolbarPointerDown(event: PointerEvent, toolbar: HTMLDivElement): void {
    const target = event.target
    if (
      event.button !== 0
      || (target instanceof Element && target.closest('button, [data-cradle-browser-comment-settings], [data-cradle-browser-comment-layout-panel]'))
    ) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    const container = event.currentTarget
    if (container instanceof HTMLElement) {
      container.setPointerCapture(event.pointerId)
    }
    const rect = toolbar.getBoundingClientRect()
    const startX = event.clientX
    const startY = event.clientY
    const initialX = rect.left
    const initialY = rect.top
    let didDrag = false
    const onMove = (moveEvent: PointerEvent): void => {
      if (!didDrag && Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < 4) {
        return
      }
      didDrag = true
      const next = this.clampToolbarPosition({
        x: initialX + moveEvent.clientX - startX,
        y: initialY + moveEvent.clientY - startY,
      }, toolbar)
      this.toolbarPosition = next
      toolbar.style.left = `${next.x}px`
      toolbar.style.top = `${next.y}px`
      toolbar.style.right = 'auto'
      toolbar.style.bottom = 'auto'
      this.positionFloatingPanel(this.settingsPanel)
      this.positionFloatingPanel(this.layoutPanel)
      this.positionNotice()
    }
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove, true)
      window.removeEventListener('pointerup', onUp, true)
      if (container instanceof HTMLElement && container.hasPointerCapture(event.pointerId)) {
        container.releasePointerCapture(event.pointerId)
      }
      this.saveSettings()
    }
    window.addEventListener('pointermove', onMove, true)
    window.addEventListener('pointerup', onUp, true)
  }

  private positionToolbar(toolbar = this.toolbar): void {
    if (!toolbar) {
      return
    }
    const pinnedPosition = this.toolbarPosition
    if (!pinnedPosition) {
      toolbar.style.left = ''
      toolbar.style.top = ''
      toolbar.style.right = ''
      toolbar.style.bottom = ''
      return
    }
    const position = this.clampToolbarPosition(
      pinnedPosition,
      toolbar,
    )
    this.toolbarPosition = position
    toolbar.style.left = `${position.x}px`
    toolbar.style.top = `${position.y}px`
    toolbar.style.right = 'auto'
    toolbar.style.bottom = 'auto'
  }

  private clampToolbarPosition(
    position: { x: number, y: number },
    toolbar = this.toolbar,
  ): { x: number, y: number } {
    const width = toolbar?.offsetWidth || 44
    const height = toolbar?.offsetHeight || 44
    return {
      x: Math.round(Math.max(8, Math.min(window.innerWidth - width - 8, position.x))),
      y: Math.round(Math.max(8, Math.min(window.innerHeight - height - 8, position.y))),
    }
  }

  private positionFloatingPanel(panel: HTMLDivElement | null): void {
    if (!panel || !this.toolbar) {
      return
    }
    const toolbarRect = this.toolbar.getBoundingClientRect()
    const panelWidth = panel.offsetWidth || 292
    const panelHeight = panel.offsetHeight || 240
    const left = Math.max(8, Math.min(window.innerWidth - panelWidth - 8, toolbarRect.right - panelWidth))
    const topCandidate = toolbarRect.top - panelHeight - 8
    const top = topCandidate >= 8
      ? topCandidate
      : Math.min(window.innerHeight - panelHeight - 8, toolbarRect.bottom + 8)
    panel.style.left = `${Math.round(left)}px`
    panel.style.top = `${Math.round(Math.max(8, top))}px`
    panel.style.right = 'auto'
    panel.style.bottom = 'auto'
  }

  private showNotice(
    message: string,
    tone: BrowserAnnotationRuntimeNotification['tone'] = 'neutral',
  ): void {
    if (!this.root) {
      return
    }
    if (this.noticeTimer !== null) {
      clearTimeout(this.noticeTimer)
      this.noticeTimer = null
    }
    this.notice?.remove()

    const notice = document.createElement('div')
    notice.setAttribute('data-cradle-browser-comment-notice', 'true')
    notice.setAttribute('data-tone', tone)
    notice.textContent = message
    this.root.appendChild(notice)
    this.notice = notice
    this.positionNotice()

    this.noticeTimer = this.nativeSetTimeout(() => {
      notice.setAttribute('data-exiting', 'true')
      this.noticeTimer = this.nativeSetTimeout(() => {
        if (this.notice === notice) {
          this.notice = null
        }
        notice.remove()
        this.noticeTimer = null
      }, 130)
    }, tone === 'error' ? 2600 : 1600)
  }

  private positionNotice(): void {
    if (!this.notice) {
      return
    }
    const toolbarRect = this.toolbar?.getBoundingClientRect()
    const noticeWidth = this.notice.offsetWidth || 180
    const noticeHeight = this.notice.offsetHeight || 34
    const anchorX = toolbarRect ? toolbarRect.left + toolbarRect.width / 2 : window.innerWidth - 120
    const anchorTop = toolbarRect ? toolbarRect.top : window.innerHeight - 72
    const anchorBottom = toolbarRect ? toolbarRect.bottom : window.innerHeight - 28
    const left = Math.max(8, Math.min(window.innerWidth - noticeWidth - 8, anchorX - noticeWidth / 2))
    const topCandidate = anchorTop - noticeHeight - 8
    const top = topCandidate >= 8
      ? topCandidate
      : Math.min(window.innerHeight - noticeHeight - 8, anchorBottom + 8)
    this.notice.style.left = `${Math.round(left)}px`
    this.notice.style.top = `${Math.round(Math.max(8, top))}px`
  }

  private loadSettings(): BrowserAnnotationRuntimeSettings {
    try {
      const raw = window.localStorage.getItem(BROWSER_ANNOTATION_SETTINGS_KEY)
      if (!raw) {
        return { ...BROWSER_ANNOTATION_DEFAULT_SETTINGS }
      }
      const parsed = JSON.parse(raw) as Partial<BrowserAnnotationRuntimeSettings>
      return {
        ...BROWSER_ANNOTATION_DEFAULT_SETTINGS,
        blockInteractions: typeof parsed.blockInteractions === 'boolean'
          ? parsed.blockInteractions
          : BROWSER_ANNOTATION_DEFAULT_SETTINGS.blockInteractions,
        clearOnCopySend: typeof parsed.clearOnCopySend === 'boolean'
          ? parsed.clearOnCopySend
          : BROWSER_ANNOTATION_DEFAULT_SETTINGS.clearOnCopySend,
        markerClickBehavior: parsed.markerClickBehavior === 'edit' ? 'edit' : 'delete',
        markerColorId: this.isMarkerColorId(parsed.markerColorId)
          ? parsed.markerColorId
          : BROWSER_ANNOTATION_DEFAULT_SETTINGS.markerColorId,
        outputDetail: this.isOutputDetail(parsed.outputDetail)
          ? parsed.outputDetail
          : BROWSER_ANNOTATION_DEFAULT_SETTINGS.outputDetail,
        reactDetectionEnabled: typeof parsed.reactDetectionEnabled === 'boolean'
          ? parsed.reactDetectionEnabled
          : BROWSER_ANNOTATION_DEFAULT_SETTINGS.reactDetectionEnabled,
        toolbarPosition: this.isToolbarPosition(parsed.toolbarPosition)
          ? parsed.toolbarPosition
          : BROWSER_ANNOTATION_DEFAULT_SETTINGS.toolbarPosition,
      }
    }
    catch {
      return { ...BROWSER_ANNOTATION_DEFAULT_SETTINGS }
    }
  }

  private saveSettings(): void {
    const settings: BrowserAnnotationRuntimeSettings = {
      blockInteractions: this.blockInteractions,
      clearOnCopySend: this.clearOnCopySend,
      markerClickBehavior: this.markerClickBehavior,
      markerColorId: this.markerColorId,
      outputDetail: this.outputDetail,
      reactDetectionEnabled: this.reactDetectionEnabled,
      toolbarPosition: this.toolbarPosition,
    }
    window.localStorage.setItem(BROWSER_ANNOTATION_SETTINGS_KEY, JSON.stringify(settings))
  }

  private applySettings(settings: BrowserAnnotationRuntimeSettings): void {
    this.blockInteractions = settings.blockInteractions
    this.clearOnCopySend = settings.clearOnCopySend
    this.markerClickBehavior = settings.markerClickBehavior
    this.markerColorId = settings.markerColorId
    this.outputDetail = settings.outputDetail
    this.reactDetectionEnabled = settings.reactDetectionEnabled
    this.toolbarPosition = settings.toolbarPosition
  }

  private applyRootSettings(root = this.root): void {
    if (!root) {
      return
    }
    root.setAttribute('data-cradle-browser-block-interactions', String(this.blockInteractions))
    root.setAttribute('data-cradle-browser-selection-enabled', String(this.selectionEnabled))
    root.setAttribute('data-cradle-browser-layout-mode', String(this.layoutMode))
    root.style.setProperty('--cradle-browser-comment-accent', BROWSER_ANNOTATION_MARKER_COLORS[this.markerColorId])
  }

  private updateSettings(nextSettings: Partial<BrowserAnnotationRuntimeSettings>): void {
    this.applySettings({
      blockInteractions: nextSettings.blockInteractions ?? this.blockInteractions,
      clearOnCopySend: nextSettings.clearOnCopySend ?? this.clearOnCopySend,
      markerClickBehavior: nextSettings.markerClickBehavior ?? this.markerClickBehavior,
      markerColorId: nextSettings.markerColorId ?? this.markerColorId,
      outputDetail: nextSettings.outputDetail ?? this.outputDetail,
      reactDetectionEnabled: nextSettings.reactDetectionEnabled ?? this.reactDetectionEnabled,
      toolbarPosition: nextSettings.toolbarPosition === undefined ? this.toolbarPosition : nextSettings.toolbarPosition,
    })
    this.applyRootSettings()
    this.saveSettings()
    this.renderMarkers()
    if (this.showSettings) {
      this.renderSettingsPanel()
    }
  }

  private isMarkerColorId(value: unknown): value is BrowserAnnotationMarkerColorId {
    return typeof value === 'string' && value in BROWSER_ANNOTATION_MARKER_COLORS
  }

  private isOutputDetail(value: unknown): value is BrowserAnnotationOutputDetail {
    return value === 'compact'
      || value === 'standard'
      || value === 'detailed'
      || value === 'forensic'
  }

  private isToolbarPosition(value: unknown): value is { x: number, y: number } {
    return Boolean(
      value
      && typeof value === 'object'
      && Number.isFinite((value as { x?: unknown }).x)
      && Number.isFinite((value as { y?: unknown }).y),
    )
  }

  private hydrateLayoutHints(hints: BrowserAnnotationLayoutHint[]): void {
    this.placements = hints
      .filter((hint): hint is Extract<BrowserAnnotationLayoutHint, { kind: 'placement' }> => hint.kind === 'placement')
      .map(hint => ({
        id: hint.id,
        type: this.isLayoutComponentType(hint.componentType) ? hint.componentType : 'section',
        label: hint.label,
        x: hint.x,
        y: hint.y,
        width: hint.width,
        height: hint.height,
        scrollY: hint.scrollY,
      }))
    this.rearrangements = hints
      .filter((hint): hint is Extract<BrowserAnnotationLayoutHint, { kind: 'rearrange' }> => hint.kind === 'rearrange')
      .map(hint => ({
        id: hint.id,
        selector: hint.selector,
        label: hint.label,
        from: hint.from,
        to: hint.to,
        scrollY: Number.isFinite(hint.scrollY) ? hint.scrollY : 0,
      }))
    this.selectedPlacementIds.clear()
  }

  private isLayoutComponentType(value: string): value is BrowserAnnotationLayoutComponentType {
    return value in DEFAULT_SIZES
  }

  private placementViewportY(placement: Pick<BrowserAnnotationLayoutPlacement, 'y'>): number {
    return placement.y - window.scrollY
  }

  private placementDocumentY(viewportY: number): number {
    return viewportY + window.scrollY
  }

  private placementViewportRect(
    placement: Pick<BrowserAnnotationLayoutPlacement, 'x' | 'y' | 'width' | 'height'>,
  ): { x: number, y: number, width: number, height: number } {
    return {
      x: placement.x,
      y: this.placementViewportY(placement),
      width: placement.width,
      height: placement.height,
    }
  }

  private layoutViewportRect(
    rect: { x: number, y: number, width: number, height: number },
  ): { x: number, y: number, width: number, height: number } {
    return {
      ...rect,
      y: rect.y - window.scrollY,
    }
  }

  private layoutDocumentRect(
    rect: { x: number, y: number, width: number, height: number },
  ): { x: number, y: number, width: number, height: number } {
    return {
      ...rect,
      y: rect.y + window.scrollY,
    }
  }

  private layoutHints(): BrowserAnnotationLayoutHint[] {
    return [
      ...this.placements.map((placement): BrowserAnnotationLayoutHint => ({
        id: placement.id,
        kind: 'placement',
        componentType: placement.type,
        label: placement.label,
        x: placement.x,
        y: placement.y,
        width: placement.width,
        height: placement.height,
        scrollY: placement.scrollY,
      })),
      ...this.rearrangements.map((rearrangement): BrowserAnnotationLayoutHint => ({
        id: rearrangement.id,
        kind: 'rearrange',
        selector: rearrangement.selector,
        label: rearrangement.label,
        from: rearrangement.from,
        to: rearrangement.to,
        scrollY: rearrangement.scrollY,
      })),
    ]
  }

  private syncLayoutHints(): void {
    this.emit({
      type: 'layout-sync',
      layoutHints: this.layoutHints(),
      surfaceSize: this.surfaceSize(),
    })
  }

  private renderMarkers(): void {
    if (!this.markerLayer) {
      return
    }
    this.markerLayer.innerHTML = ''
    const nextMarkerNumbers = new Map<string, number>()
    this.annotations.forEach((annotation, index) => {
      const point = this.markerPointFor(annotation.anchor)
      const markerNumber = index + 1
      nextMarkerNumbers.set(annotation.id, markerNumber)
      if (!point) {
        return
      }
      const marker = document.createElement('button')
      marker.type = 'button'
      marker.setAttribute('data-cradle-browser-comment-marker', 'true')
      marker.setAttribute('aria-label', `Browser annotation ${markerNumber}`)
      marker.style.left = `${point.x}px`
      marker.style.top = `${point.y}px`
      const markerNumberElement = document.createElement('span')
      markerNumberElement.setAttribute('data-cradle-browser-comment-marker-number', 'true')
      markerNumberElement.textContent = String(markerNumber)
      const previousMarkerNumber = this.markerNumberByAnnotationId.get(annotation.id)
      if (previousMarkerNumber !== undefined && previousMarkerNumber !== markerNumber) {
        markerNumberElement.setAttribute('data-renumbered', 'true')
      }
      marker.appendChild(markerNumberElement)
      if (annotation.anchor.kind === 'region') {
        marker.setAttribute('data-multi', 'true')
      }
      if (!this.markersVisible) {
        marker.setAttribute('data-hidden', 'true')
      }
      if (this.markerExitingIds.has(annotation.id)) {
        marker.setAttribute('data-exiting', 'true')
      }
      if (this.editingAnnotationId) {
        marker.setAttribute('data-editing', 'true')
      }
      marker.addEventListener('mouseenter', () => {
        if (this.editingAnnotationId) {
          return
        }
        marker.appendChild(this.createMarkerTooltip(annotation))
      })
      marker.addEventListener('mouseleave', () => {
        marker.querySelector('[data-cradle-browser-comment-marker-tooltip]')?.remove()
      })
      marker.addEventListener('click', (event) => {
        event.preventDefault()
        event.stopPropagation()
        if (this.editingAnnotationId) {
          this.shakeEditor()
          return
        }
        if (this.markerClickBehavior === 'edit') {
          this.editAnnotationInline(annotation)
          return
        }
        this.deleteAnnotation(annotation.id)
      })
      marker.addEventListener('contextmenu', (event) => {
        event.preventDefault()
        event.stopPropagation()
        if (this.editingAnnotationId) {
          this.shakeEditor()
          return
        }
        this.editAnnotationInline(annotation)
      })
      this.markerLayer?.appendChild(marker)
    })
    this.markerNumberByAnnotationId = nextMarkerNumbers
  }

  private deleteAnnotation(annotationId: string): void {
    this.markerExitingIds.add(annotationId)
    this.renderMarkers()
    this.renderToolbar()
    this.nativeSetTimeout(() => {
      this.annotations = this.annotations.filter(item => item.id !== annotationId)
      this.markerExitingIds.delete(annotationId)
      this.renderMarkers()
      this.renderToolbar()
      this.emit({ type: 'delete', annotationId })
    }, 150)
  }

  private editAnnotationInline(annotation: BrowserAnnotationRuntimeAnnotation): void {
    this.editingAnnotationId = annotation.id
    this.selectedAnchor = annotation.anchor
    this.stage = 'editing'
    this.selectedElement = null
    this.selectedElements = []
    this.attachedImages = []
    this.designChange = annotation.designChange ?? null
    this.clearSelectionFrames()
    this.hideHighlight()
    const rect = this.rectForAnchor(annotation.anchor)
    if (annotation.anchor.kind === 'element') {
      const element = document.querySelector(annotation.anchor.element.selector)
      if (element) {
        this.selectedElement = element
        this.renderSelectionFrames([element])
      }
    }
    else {
      this.showRegion(rect)
    }
    this.openEditor(rect, this.anchorLabel(), annotation.body)
  }

  private createMarkerTooltip(annotation: BrowserAnnotationRuntimeAnnotation): HTMLDivElement {
    const tooltip = document.createElement('div')
    tooltip.setAttribute('data-cradle-browser-comment-marker-tooltip', 'true')
    const quote = document.createElement('small')
    quote.textContent = this.anchorLabelFor(annotation.anchor)
    const note = document.createElement('span')
    note.textContent = annotation.body || this.designSummary(annotation.designChange) || 'No note'
    tooltip.append(quote, note)
    return tooltip
  }

  private markerPointFor(anchor: BrowserAnnotationAnchor): { x: number, y: number } | null {
    if (anchor.kind === 'point') {
      return { x: anchor.x, y: this.viewportYForAnchor(anchor) }
    }
    if (anchor.kind === 'element') {
      const rect = this.rectForAnchor(anchor)
      return {
        x: rect.x + Math.min(rect.width, 24) / 2,
        y: rect.y + Math.min(rect.height, 24) / 2,
      }
    }
    return {
      x: anchor.x + Math.min(anchor.width, 24) / 2,
      y: this.viewportYForAnchor(anchor) + Math.min(anchor.height, 24) / 2,
    }
  }

  private nativeSetTimeout(handler: () => void, timeout?: number): number {
    return browserAnnotationFreezeState().originalSetTimeout(handler, timeout)
  }

  private togglePause(nextValue = !this.pageFrozen): void {
    this.pageFrozen = nextValue
    if (this.pageFrozen) {
      this.freezePage()
    }
    else {
      this.unfreezePage()
    }
    this.renderToolbar()
  }

  private clearFreezeStyle(): void {
    this.unfreezePage()
  }

  private freezePage(): void {
    const state = installBrowserAnnotationFreezePatches()
    if (state.frozen) {
      return
    }
    state.frozen = true
    state.timeoutQueue = []
    state.rafQueue = []

    let style = document.getElementById(BROWSER_ANNOTATION_FREEZE_STYLE_ID)
    if (!style) {
      style = document.createElement('style')
      style.id = BROWSER_ANNOTATION_FREEZE_STYLE_ID
      document.head.appendChild(style)
    }
    style.textContent = `
      *:not(#cradle-browser-comment-root):not(#cradle-browser-comment-root *) ,
      *:not(#cradle-browser-comment-root):not(#cradle-browser-comment-root *)::before,
      *:not(#cradle-browser-comment-root):not(#cradle-browser-comment-root *)::after {
        animation-play-state: paused !important;
        transition: none !important;
      }
    `

    state.pausedAnimations = []
    try {
      for (const animation of document.getAnimations()) {
        if (animation.playState !== 'running') {
          continue
        }
        const target = (animation.effect as KeyframeEffect | null)?.target
        if (target instanceof Element && target.closest('#cradle-browser-comment-root')) {
          continue
        }
        animation.pause()
        state.pausedAnimations.push(animation)
      }
    }
    catch {
      state.pausedAnimations = []
    }

    document.querySelectorAll('video').forEach((video) => {
      if (!video.paused) {
        video.dataset.cradleBrowserAnnotationWasPlaying = 'true'
        void video.pause()
      }
    })
  }

  private unfreezePage(): void {
    const state = browserAnnotationFreezeState()
    if (!state.frozen && !document.getElementById(BROWSER_ANNOTATION_FREEZE_STYLE_ID)) {
      return
    }
    state.frozen = false

    const timeoutQueue = state.timeoutQueue
    state.timeoutQueue = []
    for (const callback of timeoutQueue) {
      state.originalSetTimeout(() => {
        if (state.frozen) {
          state.timeoutQueue.push(callback)
          return
        }
        callback()
      }, 0)
    }

    const rafQueue = state.rafQueue
    state.rafQueue = []
    for (const callback of rafQueue) {
      state.originalRequestAnimationFrame((timestamp) => {
        if (state.frozen) {
          state.rafQueue.push(callback)
          return
        }
        callback(timestamp)
      })
    }

    for (const animation of state.pausedAnimations) {
      try {
        animation.play()
      }
      catch {
        // Ignore animations that were detached while the page was frozen.
      }
    }
    state.pausedAnimations = []

    document.getElementById(BROWSER_ANNOTATION_FREEZE_STYLE_ID)?.remove()
    document.querySelectorAll('video[data-cradle-browser-annotation-was-playing="true"]').forEach((video) => {
      if (!(video instanceof HTMLVideoElement)) {
        return
      }
      delete video.dataset.cradleBrowserAnnotationWasPlaying
      void video.play().catch(() => {})
    })
  }

  private toggleMarkers(nextValue = !this.markersVisible): void {
    this.markersVisible = nextValue
    this.renderMarkers()
    this.renderToolbar()
  }

  private toggleSelectionEnabled(nextValue = !this.selectionEnabled): void {
    this.selectionEnabled = nextValue
    this.applyRootSettings()
    if (!this.selectionEnabled) {
      this.clearActiveSelection()
    }
    this.renderToolbar()
  }

  private clearActiveSelection(): void {
    this.editor?.remove()
    this.editor = null
    this.textarea = null
    this.fileInput = null
    this.editingAnnotationId = null
    this.selectedAnchor = null
    this.selectedElement = null
    this.selectedElements = []
    this.attachedImages = []
    this.designChange = null
    this.dragStart = null
    this.textDragStart = null
    this.stage = 'selecting'
    this.clearSelectionFrames()
    this.hideRegion()
    this.hideHighlight()
    this.emitSelection(null)
    this.renderToolbar()
  }

  private toggleLayoutMode(nextValue = !this.layoutMode): void {
    this.layoutMode = nextValue
    this.selectionEnabled = !this.layoutMode
    if (!this.root) {
      return
    }
    this.applyRootSettings()
    this.clearActiveSelection()
    this.clearLayoutSelectionBox()
    this.layoutPanel?.remove()
    this.layoutPanel = null
    this.selectedPlacementIds.clear()
    this.activeLayoutComponent = null
    this.applyWireframeMode()
    if (this.layoutMode) {
      this.renderLayoutPanel()
    }
    this.renderPlacements()
    this.renderToolbar()
  }

  private renderLayoutPanel(): void {
    if (!this.root || !this.layoutMode) {
      return
    }
    this.layoutPanel?.remove()
    const panel = document.createElement('div')
    panel.setAttribute('data-cradle-browser-comment-layout-panel', 'true')
    const title = document.createElement('h3')
    title.textContent = 'Layout mode'
    panel.appendChild(title)

    panel.append(
      this.createToggleRow('Wireframe mode', this.wireframeMode, (checked) => {
        this.wireframeMode = checked
        this.applyWireframeMode()
        this.renderLayoutPanel()
      }),
      this.createLayoutSection('Canvas opacity', this.createWireframeOpacityControl()),
      this.createLayoutSection('Purpose', this.createWireframePurposeInput()),
    )

    for (const section of BROWSER_ANNOTATION_LAYOUT_COMPONENTS) {
      const grid = document.createElement('div')
      grid.setAttribute('data-cradle-browser-comment-palette-grid', 'true')
      for (const item of section.items) {
        grid.appendChild(this.createPaletteButton(item))
      }
      panel.appendChild(this.createLayoutSection(section.section, grid))
    }

    this.root.appendChild(panel)
    this.layoutPanel = panel
    this.positionFloatingPanel(panel)
  }

  private createLayoutSection(title: string, content: HTMLElement): HTMLDivElement {
    const section = document.createElement('div')
    section.setAttribute('data-cradle-browser-comment-layout-section', 'true')
    const heading = document.createElement('h3')
    heading.textContent = title
    section.append(heading, content)
    return section
  }

  private createWireframeOpacityControl(): HTMLInputElement {
    const input = document.createElement('input')
    input.type = 'range'
    input.min = '0'
    input.max = '0.75'
    input.step = '0.01'
    input.value = String(this.wireframeOpacity)
    input.addEventListener('input', () => {
      this.wireframeOpacity = Number(input.value)
      this.applyWireframeMode()
    })
    return input
  }

  private createWireframePurposeInput(): HTMLInputElement {
    const input = document.createElement('input')
    input.type = 'text'
    input.value = this.wireframePurpose
    input.placeholder = 'New dashboard, pricing page...'
    input.setAttribute('data-cradle-browser-comment-wireframe-input', 'true')
    input.addEventListener('input', () => {
      this.wireframePurpose = input.value.trim()
    })
    return input
  }

  private createPaletteButton(item: BrowserAnnotationLayoutComponentDefinition): HTMLButtonElement {
    const button = document.createElement('button')
    button.type = 'button'
    button.setAttribute('data-cradle-browser-comment-palette-button', 'true')
    button.title = `Place ${item.label}`
    if (this.activeLayoutComponent?.type === item.type) {
      button.setAttribute('data-active', 'true')
    }
    const icon = document.createElement('span')
    icon.setAttribute('data-cradle-browser-comment-palette-icon', 'true')
    const text = document.createElement('span')
    text.textContent = item.label
    button.append(icon, text)
    this.attachPaletteDrag(button, item)
    button.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      if (button.getAttribute('data-suppress-click') === 'true') {
        button.removeAttribute('data-suppress-click')
        return
      }
      this.activeLayoutComponent = this.activeLayoutComponent?.type === item.type ? null : item
      this.renderLayoutPanel()
    })
    return button
  }

  private attachPaletteDrag(
    button: HTMLButtonElement,
    item: BrowserAnnotationLayoutComponentDefinition,
  ): void {
    button.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      button.setPointerCapture(event.pointerId)
      const startX = event.clientX
      const startY = event.clientY
      let didDrag = false
      let preview: HTMLDivElement | null = null
      const cleanup = (): void => {
        window.removeEventListener('pointermove', onMove, true)
        window.removeEventListener('pointerup', onUp, true)
        window.removeEventListener('pointercancel', onCancel, true)
        window.removeEventListener('blur', onCancel, true)
        preview?.remove()
        preview = null
        if (button.hasPointerCapture(event.pointerId)) {
          button.releasePointerCapture(event.pointerId)
        }
      }
      const onMove = (moveEvent: PointerEvent): void => {
        const dx = moveEvent.clientX - startX
        const dy = moveEvent.clientY - startY
        if (!didDrag && Math.hypot(dx, dy) > 4) {
          didDrag = true
          preview = document.createElement('div')
          preview.setAttribute('data-cradle-browser-comment-drag-preview', 'true')
          preview.textContent = item.label
          this.root?.appendChild(preview)
        }
        if (!preview) {
          return
        }
        const distance = Math.max(0, startY - moveEvent.clientY)
        const progress = Math.min(1, distance / 180)
        const eased = 1 - (1 - progress) ** 2
        const width = 28 + (Math.min(140, item.width * 0.18) - 28) * eased
        const height = 20 + (Math.min(90, item.height * 0.18) - 20) * eased
        preview.style.width = `${width}px`
        preview.style.height = `${height}px`
        preview.style.left = `${moveEvent.clientX - width / 2}px`
        preview.style.top = `${moveEvent.clientY - height / 2}px`
        preview.style.opacity = `${0.5 + 0.5 * eased}`
      }
      const onUp = (upEvent: PointerEvent): void => {
        cleanup()
        if (didDrag) {
          button.setAttribute('data-suppress-click', 'true')
          this.activeLayoutComponent = null
          this.addPlacement(item, { x: upEvent.clientX, y: upEvent.clientY })
        }
      }
      const onCancel = (): void => {
        cleanup()
      }
      window.addEventListener('pointermove', onMove, true)
      window.addEventListener('pointerup', onUp, true)
      window.addEventListener('pointercancel', onCancel, true)
      window.addEventListener('blur', onCancel, true)
    })
  }

  private addPlacement(
    item: BrowserAnnotationLayoutComponentDefinition,
    center?: { x: number, y: number },
  ): void {
    const width = Math.min(item.width, Math.max(80, window.innerWidth - 48))
    const height = Math.min(item.height, Math.max(40, window.innerHeight - 120))
    const placement: BrowserAnnotationLayoutPlacement = {
      id: `placement-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: item.type,
      label: item.label,
      x: Math.round(Math.max(0, Math.min(window.innerWidth - width, (center?.x ?? window.innerWidth / 2) - width / 2))),
      y: Math.round(this.placementDocumentY(Math.max(0, Math.min(window.innerHeight - height, (center?.y ?? window.innerHeight / 2) - height / 2)))),
      width: Math.round(width),
      height: Math.round(height),
      scrollY: Math.round(window.scrollY),
    }
    this.placements = [...this.placements, placement]
    this.selectedPlacementIds = new Set([placement.id])
    this.renderPlacements()
    this.renderToolbar()
    this.syncLayoutHints()
  }

  private renderPlacements(): void {
    if (!this.placementLayer) {
      return
    }
    this.placementLayer.innerHTML = ''
    for (const placement of this.placements) {
      const frame = document.createElement('div')
      frame.setAttribute('data-cradle-browser-comment-placement', 'true')
      frame.setAttribute('data-placement-id', placement.id)
      if (this.exitingPlacementIds.has(placement.id)) {
        frame.setAttribute('data-exiting', 'true')
      }
      if (this.selectedPlacementIds.has(placement.id)) {
        frame.setAttribute('data-selected', 'true')
      }
      frame.style.left = `${placement.x}px`
      frame.style.top = `${this.placementViewportY(placement)}px`
      frame.style.width = `${placement.width}px`
      frame.style.height = `${placement.height}px`
      const label = document.createElement('span')
      label.textContent = placement.label
      const size = document.createElement('small')
      size.textContent = `${placement.width}x${placement.height} at ${placement.x}, ${Math.round(this.placementViewportY(placement))}`
      label.appendChild(size)
      const remove = document.createElement('button')
      remove.type = 'button'
      remove.textContent = 'x'
      remove.setAttribute('data-cradle-browser-comment-placement-remove', 'true')
      remove.addEventListener('click', (event) => {
        event.preventDefault()
        event.stopPropagation()
        this.removePlacements(new Set([placement.id]))
      })
      this.attachPlacementDrag(frame, placement)
      frame.append(label, remove)
      if (this.selectedPlacementIds.has(placement.id)) {
        this.appendResizeHandles(frame, placement)
      }
      this.placementLayer.appendChild(frame)
    }
    if (this.layoutMode) {
      this.renderRearrangeHandles()
    }
  }

  private readonly onLayoutLayerPointerDown = (event: PointerEvent): void => {
    if (!this.active || !this.layoutMode || event.button !== 0) {
      return
    }
    const target = event.target
    if (target instanceof Element && target.closest([
      '[data-cradle-browser-comment-placement]',
      '[data-cradle-browser-comment-rearrange]',
      '[data-cradle-browser-comment-snap-guide]',
      '[data-cradle-browser-comment-layout-selection]',
    ].join(','))) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    if (this.activeLayoutComponent) {
      this.addPlacement(this.activeLayoutComponent, { x: event.clientX, y: event.clientY })
      this.activeLayoutComponent = null
      this.renderLayoutPanel()
      return
    }
    this.layoutSelectStart = {
      x: event.clientX,
      y: event.clientY,
      additive: event.shiftKey,
    }
    this.clearLayoutSelectionBox()
    const onMove = (moveEvent: PointerEvent): void => {
      if (!this.layoutSelectStart) {
        return
      }
      const rect = this.rectFromPoints(this.layoutSelectStart, {
        x: moveEvent.clientX,
        y: moveEvent.clientY,
      })
      if (rect.width <= 4 && rect.height <= 4) {
        return
      }
      this.showLayoutSelectionBox(rect)
    }
    const onUp = (upEvent: PointerEvent): void => {
      window.removeEventListener('pointermove', onMove, true)
      window.removeEventListener('pointerup', onUp, true)
      const start = this.layoutSelectStart
      this.layoutSelectStart = null
      const rect = start
        ? this.rectFromPoints(start, { x: upEvent.clientX, y: upEvent.clientY })
        : null
      this.clearLayoutSelectionBox()
      if (!rect || (rect.width <= 4 && rect.height <= 4)) {
        if (!event.shiftKey) {
          this.selectedPlacementIds.clear()
          this.renderPlacements()
        }
        return
      }
      const nextSelection = new Set(start?.additive ? this.selectedPlacementIds : [])
      for (const placement of this.placements) {
        const placementRect = this.placementViewportRect(placement)
        if (this.rectsIntersect(rect, placementRect)) {
          nextSelection.add(placement.id)
        }
      }
      this.selectedPlacementIds = nextSelection
      this.renderPlacements()
    }
    window.addEventListener('pointermove', onMove, true)
    window.addEventListener('pointerup', onUp, true)
  }

  private showLayoutSelectionBox(rect: { x: number, y: number, width: number, height: number }): void {
    if (!this.root) {
      return
    }
    if (!this.layoutSelectionBox) {
      const box = document.createElement('div')
      box.setAttribute('data-cradle-browser-comment-layout-selection', 'true')
      this.root.appendChild(box)
      this.layoutSelectionBox = box
    }
    this.layoutSelectionBox.style.left = `${rect.x}px`
    this.layoutSelectionBox.style.top = `${rect.y}px`
    this.layoutSelectionBox.style.width = `${rect.width}px`
    this.layoutSelectionBox.style.height = `${rect.height}px`
  }

  private clearLayoutSelectionBox(): void {
    this.layoutSelectionBox?.remove()
    this.layoutSelectionBox = null
    this.layoutSelectStart = null
  }

  private rectsIntersect(
    a: { x: number, y: number, width: number, height: number },
    b: { x: number, y: number, width: number, height: number },
  ): boolean {
    return a.x < b.x + b.width
      && a.x + a.width > b.x
      && a.y < b.y + b.height
      && a.y + a.height > b.y
  }

  private appendResizeHandles(frame: HTMLDivElement, placement: BrowserAnnotationLayoutPlacement): void {
    const handles: BrowserAnnotationResizeHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
    for (const handle of handles) {
      const button = document.createElement('button')
      button.type = 'button'
      button.setAttribute('data-cradle-browser-comment-resize-handle', handle)
      button.setAttribute('aria-label', `Resize ${placement.label} ${handle}`)
      button.addEventListener('pointerdown', (event) => {
        this.startPlacementResize(event, frame, placement, handle)
      })
      frame.appendChild(button)
    }
  }

  private renderRearrangeHandles(): void {
    if (!this.placementLayer) {
      return
    }
    for (const candidate of this.layoutRearrangeCandidates()) {
      const existing = this.rearrangements.find(item => item.selector === candidate.selector)
      const rect = this.layoutViewportRect(existing?.to ?? candidate.rect)
      const frame = document.createElement('div')
      frame.setAttribute('data-cradle-browser-comment-rearrange', 'true')
      if (existing) {
        frame.setAttribute('data-moved', 'true')
      }
      frame.style.left = `${rect.x}px`
      frame.style.top = `${rect.y}px`
      frame.style.width = `${rect.width}px`
      frame.style.height = `${rect.height}px`
      const label = document.createElement('span')
      label.textContent = candidate.label
      const size = document.createElement('small')
      size.textContent = existing
        ? `move to ${Math.round(rect.x)}, ${Math.round(rect.y)}`
        : 'drag to rearrange'
      label.appendChild(size)
      frame.appendChild(label)
      this.attachRearrangeDrag(frame, candidate)
      this.placementLayer.appendChild(frame)
    }
  }

  private layoutRearrangeCandidates(): Array<{
    element: Element
    selector: string
    label: string
    rect: { x: number, y: number, width: number, height: number }
  }> {
    const selectors = [
      'header',
      'nav',
      'main',
      'section',
      'article',
      'aside',
      'footer',
      '[role="banner"]',
      '[role="navigation"]',
      '[role="main"]',
      '[role="complementary"]',
      '[role="contentinfo"]',
    ].join(',')
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0
    return Array.from(document.querySelectorAll(selectors))
      .filter(element => !element.closest('#cradle-browser-comment-root'))
      .map((element, index) => {
        const rect = element.getBoundingClientRect()
        if (
          rect.width < 80
          || rect.height < 36
          || rect.right < 0
          || rect.bottom < 0
          || rect.left > viewportWidth
          || rect.top > viewportHeight
        ) {
          return null
        }
        const annotationElement = this.readElement(element, index)
        return {
          element,
          selector: annotationElement?.selector ?? this.cssPath(element),
          label: annotationElement ? this.elementTokenLabel(annotationElement) : element.tagName.toLowerCase(),
          rect: {
            x: Math.max(0, Math.min(viewportWidth, rect.left)),
            y: Math.max(0, Math.min(viewportHeight, rect.top)) + window.scrollY,
            width: Math.max(1, Math.min(viewportWidth, rect.right) - Math.max(0, rect.left)),
            height: Math.max(1, Math.min(viewportHeight, rect.bottom) - Math.max(0, rect.top)),
          },
        }
      })
      .filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null)
      .slice(0, 16)
  }

  private attachRearrangeDrag(
    frame: HTMLDivElement,
    candidate: {
      selector: string
      label: string
      rect: { x: number, y: number, width: number, height: number }
    },
  ): void {
    frame.addEventListener('pointerdown', (event) => {
      event.preventDefault()
      event.stopPropagation()
      frame.setPointerCapture(event.pointerId)
      const startX = event.clientX
      const startY = event.clientY
      const existing = this.rearrangements.find(item => item.selector === candidate.selector)
      const initial = this.layoutViewportRect(existing?.to ?? candidate.rect)
      const onMove = (moveEvent: PointerEvent): void => {
        const rawRect = {
          ...initial,
          x: Math.round(Math.max(0, Math.min(window.innerWidth - initial.width, initial.x + moveEvent.clientX - startX))),
          y: Math.round(Math.max(0, Math.min(window.innerHeight - initial.height, initial.y + moveEvent.clientY - startY))),
        }
        const snapped = this.snapRect(rawRect, new Set(), candidate.selector)
        const nextRect = snapped.rect
        this.showSnapGuides(snapped.guides)
        frame.style.left = `${nextRect.x}px`
        frame.style.top = `${nextRect.y}px`
        frame.setAttribute('data-moved', 'true')
        const size = frame.querySelector('small')
        if (size) {
          size.textContent = `move to ${nextRect.x}, ${nextRect.y}`
        }
        this.upsertRearrangement(candidate, this.layoutDocumentRect(nextRect))
      }
      const onUp = (): void => {
        window.removeEventListener('pointermove', onMove, true)
        window.removeEventListener('pointerup', onUp, true)
        this.clearSnapGuides()
        this.renderToolbar()
        this.syncLayoutHints()
      }
      window.addEventListener('pointermove', onMove, true)
      window.addEventListener('pointerup', onUp, true)
    })
  }

  private upsertRearrangement(
    candidate: {
      selector: string
      label: string
      rect: { x: number, y: number, width: number, height: number }
    },
    to: { x: number, y: number, width: number, height: number },
  ): void {
    const next: BrowserAnnotationLayoutRearrangement = {
      id: `rearrange-${candidate.selector}`,
      selector: candidate.selector,
      label: candidate.label,
      from: candidate.rect,
      to,
      scrollY: Math.round(window.scrollY),
    }
    this.rearrangements = [
      ...this.rearrangements.filter(item => item.selector !== candidate.selector),
      next,
    ]
  }

  private attachPlacementDrag(frame: HTMLDivElement, placement: BrowserAnnotationLayoutPlacement): void {
    frame.addEventListener('pointerdown', (event) => {
      const target = event.target
      if (target instanceof Element && target.closest('[data-cradle-browser-comment-placement-remove], [data-cradle-browser-comment-resize-handle]')) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      this.selectPlacement(placement.id, event.shiftKey, false)
      if (!this.selectedPlacementIds.has(placement.id)) {
        this.renderPlacements()
        return
      }
      frame.setAttribute('data-selected', 'true')
      frame.setPointerCapture(event.pointerId)
      const startX = event.clientX
      const startY = event.clientY
      const movingIds = this.selectedPlacementIds.has(placement.id)
        ? new Set(this.selectedPlacementIds)
        : new Set([placement.id])
      const initialPlacements = this.placements
        .filter(item => movingIds.has(item.id))
        .map(item => ({ ...item }))
      const primaryInitial = initialPlacements.find(item => item.id === placement.id) ?? { ...placement }
      const primaryInitialRect = this.placementViewportRect(primaryInitial)
      const onMove = (moveEvent: PointerEvent): void => {
        const rawRect = {
          x: primaryInitialRect.x + moveEvent.clientX - startX,
          y: primaryInitialRect.y + moveEvent.clientY - startY,
          width: primaryInitialRect.width,
          height: primaryInitialRect.height,
        }
        const snapped = this.snapRect(rawRect, movingIds)
        const dx = snapped.rect.x - primaryInitialRect.x
        const dy = snapped.rect.y - primaryInitialRect.y
        this.showSnapGuides(snapped.guides)
        for (const initial of initialPlacements) {
          const nextPlacement = this.placements.find(item => item.id === initial.id)
          if (!nextPlacement) {
            continue
          }
          const initialViewportY = this.placementViewportY(initial)
          nextPlacement.x = Math.round(Math.max(0, Math.min(window.innerWidth - nextPlacement.width, initial.x + dx)))
          nextPlacement.y = Math.round(this.placementDocumentY(Math.max(0, Math.min(window.innerHeight - nextPlacement.height, initialViewportY + dy))))
          nextPlacement.scrollY = Math.round(window.scrollY)
        }
        this.updatePlacementFrames()
      }
      const onUp = (): void => {
        window.removeEventListener('pointermove', onMove, true)
        window.removeEventListener('pointerup', onUp, true)
        this.clearSnapGuides()
        this.renderPlacements()
        this.renderToolbar()
        this.syncLayoutHints()
      }
      window.addEventListener('pointermove', onMove, true)
      window.addEventListener('pointerup', onUp, true)
    })
  }

  private selectPlacement(placementId: string, additive: boolean, render = true): void {
    if (additive) {
      if (this.selectedPlacementIds.has(placementId)) {
        this.selectedPlacementIds.delete(placementId)
      }
      else {
        this.selectedPlacementIds.add(placementId)
      }
    }
    else if (!this.selectedPlacementIds.has(placementId) || this.selectedPlacementIds.size > 1) {
      this.selectedPlacementIds = new Set([placementId])
    }
    if (render) {
      this.renderPlacements()
    }
  }

  private removePlacements(ids: Set<string>): void {
    if (ids.size === 0) {
      return
    }
    this.exitingPlacementIds = new Set([...this.exitingPlacementIds, ...ids])
    for (const id of ids) {
      this.selectedPlacementIds.delete(id)
    }
    this.renderPlacements()
    this.nativeSetTimeout(() => {
      this.placements = this.placements.filter(placement => !ids.has(placement.id))
      for (const id of ids) {
        this.exitingPlacementIds.delete(id)
      }
      this.renderPlacements()
      this.renderToolbar()
      this.syncLayoutHints()
    }, 180)
  }

  private updatePlacementFrames(): void {
    if (!this.placementLayer) {
      return
    }
    for (const placement of this.placements) {
      const frame = this.placementLayer.querySelector<HTMLElement>(`[data-placement-id="${CSS.escape(placement.id)}"]`)
      if (!frame) {
        continue
      }
      frame.style.left = `${placement.x}px`
      frame.style.top = `${this.placementViewportY(placement)}px`
      frame.style.width = `${placement.width}px`
      frame.style.height = `${placement.height}px`
      const size = frame.querySelector('small')
      if (size) {
        size.textContent = `${placement.width}x${placement.height} at ${placement.x}, ${Math.round(this.placementViewportY(placement))}`
      }
    }
  }

  private startPlacementResize(
    event: PointerEvent,
    frame: HTMLDivElement,
    placement: BrowserAnnotationLayoutPlacement,
    handle: BrowserAnnotationResizeHandle,
  ): void {
    event.preventDefault()
    event.stopPropagation()
    this.selectedPlacementIds = new Set([placement.id])
    frame.setPointerCapture(event.pointerId)
    const startX = event.clientX
    const startY = event.clientY
    const initial = this.placementViewportRect(placement)
    const onMove = (moveEvent: PointerEvent): void => {
      const dx = moveEvent.clientX - startX
      const dy = moveEvent.clientY - startY
      const rawRect = this.resizeRect(initial, handle, dx, dy)
      const snapped = this.snapResizeRect(rawRect, handle, new Set([placement.id]))
      placement.x = Math.round(snapped.rect.x)
      placement.y = Math.round(this.placementDocumentY(snapped.rect.y))
      placement.width = Math.round(snapped.rect.width)
      placement.height = Math.round(snapped.rect.height)
      placement.scrollY = Math.round(window.scrollY)
      this.showSnapGuides(snapped.guides)
      this.updatePlacementFrames()
    }
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove, true)
      window.removeEventListener('pointerup', onUp, true)
      this.clearSnapGuides()
      this.renderPlacements()
      this.renderToolbar()
      this.syncLayoutHints()
    }
    window.addEventListener('pointermove', onMove, true)
    window.addEventListener('pointerup', onUp, true)
  }

  private resizeRect(
    initial: { x: number, y: number, width: number, height: number },
    handle: BrowserAnnotationResizeHandle,
    dx: number,
    dy: number,
  ): { x: number, y: number, width: number, height: number } {
    const minWidth = 24
    const minHeight = 24
    const resizesLeft = handle === 'nw' || handle === 'sw' || handle === 'w'
    const resizesRight = handle === 'ne' || handle === 'se' || handle === 'e'
    const resizesTop = handle === 'nw' || handle === 'ne' || handle === 'n'
    const resizesBottom = handle === 'sw' || handle === 'se' || handle === 's'
    const left = resizesLeft
      ? Math.min(initial.x + initial.width - minWidth, initial.x + dx)
      : initial.x
    const top = resizesTop
      ? Math.min(initial.y + initial.height - minHeight, initial.y + dy)
      : initial.y
    const right = resizesRight
      ? Math.max(initial.x + minWidth, initial.x + initial.width + dx)
      : initial.x + initial.width
    const bottom = resizesBottom
      ? Math.max(initial.y + minHeight, initial.y + initial.height + dy)
      : initial.y + initial.height
    const width = Math.min(window.innerWidth - left, right - left)
    const height = Math.min(window.innerHeight - top, bottom - top)
    return {
      x: Math.max(0, left),
      y: Math.max(0, top),
      width: Math.max(minWidth, width),
      height: Math.max(minHeight, height),
    }
  }

  private snapRect(
    rect: { x: number, y: number, width: number, height: number },
    excludeIds: Set<string>,
    excludeRearrangeSelector?: string,
  ): { rect: { x: number, y: number, width: number, height: number }, guides: BrowserAnnotationSnapGuide[] } {
    const threshold = 6
    const horizontalTargets = [0, window.innerWidth / 2, window.innerWidth]
    const verticalTargets = [0, window.innerHeight / 2, window.innerHeight]
    for (const target of this.layoutSnapTargetRects(excludeIds, excludeRearrangeSelector)) {
      horizontalTargets.push(target.x, target.x + target.width / 2, target.x + target.width)
      verticalTargets.push(target.y, target.y + target.height / 2, target.y + target.height)
    }

    const rectXs = [rect.x, rect.x + rect.width / 2, rect.x + rect.width]
    const rectYs = [rect.y, rect.y + rect.height / 2, rect.y + rect.height]
    let snapDx = 0
    let snapDy = 0
    let bestX = threshold
    let bestY = threshold
    const guides: BrowserAnnotationSnapGuide[] = []

    for (const from of rectXs) {
      for (const target of horizontalTargets) {
        const delta = target - from
        if (Math.abs(delta) < Math.abs(bestX)) {
          bestX = delta
        }
      }
    }
    for (const from of rectYs) {
      for (const target of verticalTargets) {
        const delta = target - from
        if (Math.abs(delta) < Math.abs(bestY)) {
          bestY = delta
        }
      }
    }
    if (Math.abs(bestX) < threshold) {
      snapDx = bestX
      const guideX = rectXs.find(x => horizontalTargets.some(target => Math.abs(target - (x + snapDx)) < 0.5))
      if (typeof guideX === 'number') {
        guides.push({ axis: 'x', position: guideX + snapDx })
      }
    }
    if (Math.abs(bestY) < threshold) {
      snapDy = bestY
      const guideY = rectYs.find(y => verticalTargets.some(target => Math.abs(target - (y + snapDy)) < 0.5))
      if (typeof guideY === 'number') {
        guides.push({ axis: 'y', position: guideY + snapDy })
      }
    }

    const nextRect = {
      ...rect,
      x: Math.max(0, Math.min(window.innerWidth - rect.width, rect.x + snapDx)),
      y: Math.max(0, Math.min(window.innerHeight - rect.height, rect.y + snapDy)),
    }
    return { rect: nextRect, guides }
  }

  private layoutSnapTargetRects(
    excludePlacementIds: Set<string>,
    excludeRearrangeSelector?: string,
  ): Array<{ x: number, y: number, width: number, height: number }> {
    const targets: Array<{ x: number, y: number, width: number, height: number }> = []
    for (const placement of this.placements) {
      if (excludePlacementIds.has(placement.id)) {
        continue
      }
      targets.push(this.placementViewportRect(placement))
    }
    for (const rearrangement of this.rearrangements) {
      if (rearrangement.selector === excludeRearrangeSelector) {
        continue
      }
      targets.push(this.layoutViewportRect(rearrangement.to))
    }
    return targets
  }

  private snapResizeRect(
    rect: { x: number, y: number, width: number, height: number },
    handle: BrowserAnnotationResizeHandle,
    excludeIds: Set<string>,
  ): { rect: { x: number, y: number, width: number, height: number }, guides: BrowserAnnotationSnapGuide[] } {
    const threshold = 6
    const horizontalTargets = [0, window.innerWidth / 2, window.innerWidth]
    const verticalTargets = [0, window.innerHeight / 2, window.innerHeight]
    for (const target of this.layoutSnapTargetRects(excludeIds)) {
      horizontalTargets.push(target.x, target.x + target.width / 2, target.x + target.width)
      verticalTargets.push(target.y, target.y + target.height / 2, target.y + target.height)
    }

    const next = { ...rect }
    const guides: BrowserAnnotationSnapGuide[] = []
    const resizesLeft = handle === 'nw' || handle === 'sw' || handle === 'w'
    const resizesRight = handle === 'ne' || handle === 'se' || handle === 'e'
    const resizesTop = handle === 'nw' || handle === 'ne' || handle === 'n'
    const resizesBottom = handle === 'sw' || handle === 'se' || handle === 's'
    const activeX = resizesLeft ? rect.x : rect.x + rect.width
    const activeY = resizesTop ? rect.y : rect.y + rect.height
    const targetX = resizesLeft || resizesRight
      ? horizontalTargets.find(target => Math.abs(target - activeX) < threshold)
      : undefined
    const targetY = resizesTop || resizesBottom
      ? verticalTargets.find(target => Math.abs(target - activeY) < threshold)
      : undefined
    if (typeof targetX === 'number') {
      if (resizesLeft) {
        const right = rect.x + rect.width
        next.x = Math.max(0, Math.min(right - 24, targetX))
        next.width = right - next.x
      }
      else {
        next.width = Math.max(24, Math.min(window.innerWidth - next.x, targetX - next.x))
      }
      guides.push({ axis: 'x', position: targetX })
    }
    if (typeof targetY === 'number') {
      if (resizesTop) {
        const bottom = rect.y + rect.height
        next.y = Math.max(0, Math.min(bottom - 24, targetY))
        next.height = bottom - next.y
      }
      else {
        next.height = Math.max(24, Math.min(window.innerHeight - next.y, targetY - next.y))
      }
      guides.push({ axis: 'y', position: targetY })
    }
    return { rect: next, guides }
  }

  private showSnapGuides(guides: BrowserAnnotationSnapGuide[]): void {
    if (!this.placementLayer) {
      return
    }
    this.clearSnapGuides()
    for (const guide of guides) {
      const line = document.createElement('div')
      line.setAttribute('data-cradle-browser-comment-snap-guide', 'true')
      line.setAttribute('data-axis', guide.axis)
      if (guide.axis === 'x') {
        line.style.left = `${Math.round(guide.position)}px`
      }
      else {
        line.style.top = `${Math.round(guide.position)}px`
      }
      this.placementLayer.appendChild(line)
    }
  }

  private clearSnapGuides(): void {
    this.placementLayer
      ?.querySelectorAll('[data-cradle-browser-comment-snap-guide]')
      .forEach(guide => guide.remove())
  }

  private applyWireframeMode(): void {
    this.clearWireframeStyle()
    if (!this.layoutMode || !this.wireframeMode) {
      return
    }
    let style = document.getElementById('cradle-browser-comment-wireframe-style')
    if (!style) {
      style = document.createElement('style')
      style.id = 'cradle-browser-comment-wireframe-style'
      document.head.appendChild(style)
    }
    const opacity = Math.max(0, Math.min(0.75, this.wireframeOpacity))
    style.textContent = `
      body > *:not(#cradle-browser-comment-root) {
        opacity: ${opacity} !important;
        filter: grayscale(1) !important;
        transition: opacity 160ms ease, filter 160ms ease !important;
      }
    `
  }

  private clearWireframeStyle(): void {
    document.getElementById('cradle-browser-comment-wireframe-style')?.remove()
  }

  private toggleSettings(nextValue = !this.showSettings): void {
    this.showSettings = nextValue
    if (!this.root) {
      return
    }
    this.settingsPanel?.remove()
    this.settingsPanel = null
    if (this.showSettings) {
      this.renderSettingsPanel()
    }
    this.renderToolbar()
  }

  private renderSettingsPanel(): void {
    if (!this.root || !this.showSettings) {
      return
    }
    this.settingsPanel?.remove()
    const panel = document.createElement('div')
    panel.setAttribute('data-cradle-browser-comment-settings', 'true')
    const title = document.createElement('h3')
    title.textContent = 'Settings'
    panel.appendChild(title)

    panel.append(
      this.createSettingsSection('Output Detail', this.createSegment(
        [
          { label: 'Compact', value: 'compact' },
          { label: 'Standard', value: 'standard' },
          { label: 'Detailed', value: 'detailed' },
          { label: 'Forensic', value: 'forensic' },
        ],
        this.outputDetail,
        value => this.updateSettings({ outputDetail: value as BrowserAnnotationOutputDetail }),
      ), 'four'),
      this.createSettingsSection('Marker Colour', this.createColorRow()),
      this.createSettingsSection('Marker Click', this.createSegment(
        [
          { label: 'Delete', value: 'delete' },
          { label: 'Edit', value: 'edit' },
        ],
        this.markerClickBehavior,
        value => this.updateSettings({ markerClickBehavior: value as BrowserAnnotationMarkerClickBehavior }),
      )),
      this.createToggleRow('React Components', this.reactDetectionEnabled, (checked) => {
        this.updateSettings({ reactDetectionEnabled: checked })
      }),
      this.createToggleRow('Block page interactions', this.blockInteractions, (checked) => {
        this.updateSettings({ blockInteractions: checked })
      }),
      this.createToggleRow('Clear on copy/send', this.clearOnCopySend, (checked) => {
        this.updateSettings({ clearOnCopySend: checked })
      }),
    )

    this.root.appendChild(panel)
    this.settingsPanel = panel
    this.positionFloatingPanel(panel)
  }

  private createSettingsSection(title: string, content: HTMLElement, segmentMode?: string): HTMLDivElement {
    const section = document.createElement('div')
    section.setAttribute('data-cradle-browser-comment-settings-section', 'true')
    const heading = document.createElement('h3')
    heading.textContent = title
    if (segmentMode) {
      content.setAttribute('data-cradle-browser-comment-segment', segmentMode)
    }
    section.append(heading, content)
    return section
  }

  private createSegment(
    items: Array<{ label: string, value: string }>,
    activeValue: string,
    onSelect: (value: string) => void,
  ): HTMLDivElement {
    const segment = document.createElement('div')
    segment.setAttribute('data-cradle-browser-comment-segment', 'true')
    for (const item of items) {
      const button = document.createElement('button')
      button.type = 'button'
      button.textContent = item.label
      button.setAttribute('data-cradle-browser-comment-segment-button', 'true')
      if (item.value === activeValue) {
        button.setAttribute('data-active', 'true')
      }
      button.addEventListener('click', (event) => {
        event.preventDefault()
        event.stopPropagation()
        onSelect(item.value)
      })
      segment.appendChild(button)
    }
    return segment
  }

  private createColorRow(): HTMLDivElement {
    const row = document.createElement('div')
    row.setAttribute('data-cradle-browser-comment-color-row', 'true')
    for (const [colorId, color] of Object.entries(BROWSER_ANNOTATION_MARKER_COLORS)) {
      const button = document.createElement('button')
      button.type = 'button'
      button.title = colorId
      button.setAttribute('aria-label', colorId)
      button.setAttribute('data-cradle-browser-comment-color-button', 'true')
      button.style.background = color
      if (colorId === this.markerColorId) {
        button.setAttribute('data-active', 'true')
      }
      button.addEventListener('click', (event) => {
        event.preventDefault()
        event.stopPropagation()
        this.updateSettings({ markerColorId: colorId as BrowserAnnotationMarkerColorId })
      })
      row.appendChild(button)
    }
    return row
  }

  private createToggleRow(labelText: string, checked: boolean, onChange: (checked: boolean) => void): HTMLLabelElement {
    const label = document.createElement('label')
    const text = document.createElement('span')
    text.textContent = labelText
    const input = document.createElement('input')
    input.type = 'checkbox'
    input.checked = checked
    input.addEventListener('change', () => onChange(input.checked))
    label.append(text, input)
    return label
  }

  private clearAnnotations(): void {
    this.annotations = []
    this.placements = []
    this.rearrangements = []
    this.markerNumberByAnnotationId.clear()
    this.selectedPlacementIds.clear()
    this.renderMarkers()
    this.renderPlacements()
    this.renderToolbar()
    this.syncLayoutHints()
    this.emit({ type: 'clear' })
  }

  private async copyStructuredMarkdown(): Promise<void> {
    const output = this.formatStructuredMarkdown()
    const didCopy = await navigator.clipboard?.writeText(output).then(() => true).catch(() => false) ?? false
    this.showNotice(didCopy ? 'Copied markdown' : 'Copy unavailable', didCopy ? 'success' : 'error')
    this.emit({ type: 'copy', output, layoutHints: this.layoutHints() })
    if (this.clearOnCopySend) {
      this.clearAnnotations()
    }
  }

  private formatStructuredMarkdown(annotations = this.annotations): string {
    const lines = [
      '# Browser annotations',
      '',
      `URL: ${window.location.href}`,
      `Output detail: ${this.outputDetail}`,
      `Annotations: ${annotations.length}`,
      `Layout placements: ${this.placements.length}`,
      `Layout rearranges: ${this.rearrangements.length}`,
      '',
    ]
    annotations.forEach((annotation, index) => {
      lines.push(
        `## ${index + 1}. ${this.anchorLabelFor(annotation.anchor)}`,
        '',
        annotation.body ? annotation.body : '_No note_',
      )
      lines.push(...this.formatAnchorDetails(annotation.anchor))
      const design = this.designSummary(annotation.designChange)
      if (design) {
        lines.push('', `Design: ${design}`)
      }
      lines.push('')
    })
    if (this.placements.length > 0) {
      lines.push(...this.formatLayoutPlacements())
    }
    if (this.rearrangements.length > 0) {
      lines.push(...this.formatLayoutRearrangements())
    }
    return lines.join('\n').trimEnd()
  }

  private formatAnchorDetails(anchor: BrowserAnnotationAnchor): string[] {
    if (this.outputDetail === 'compact') {
      return []
    }
    const lines: string[] = ['']
    const rect = this.rectForAnchor(anchor)
    lines.push(`- Position: ${Math.round(rect.x)}, ${Math.round(rect.y)} / ${Math.round(rect.width)}x${Math.round(rect.height)}`)
    if (anchor.kind === 'element') {
      const { element } = anchor
      lines.push(`- Selector: \`${element.selector}\``)
      if (element.role) {
        lines.push(`- Role: ${element.role}`)
      }
      if (this.reactDetectionEnabled && element.reactComponents) {
        lines.push(`- React: ${element.reactComponents}`)
      }
      if (element.nearbyText && this.outputDetail !== 'standard') {
        lines.push(`- Nearby text: ${element.nearbyText}`)
      }
      if (this.outputDetail === 'detailed' || this.outputDetail === 'forensic') {
        lines.push(`- Computed styles: ${this.formatComputedStyles(element.styles)}`)
      }
      if (this.outputDetail === 'forensic' && element.attributes) {
        lines.push(`- Attributes: ${this.formatAttributes(element.attributes)}`)
      }
    }
    if (anchor.kind === 'text') {
      lines.push(`- Quote: "${anchor.text}"`)
    }
    return lines
  }

  private formatLayoutPlacements(): string[] {
    const lines = [
      '## Layout placements',
      '',
      this.wireframeMode
        ? `Mode: wireframe${this.wireframePurpose ? ` (${this.wireframePurpose})` : ''}`
        : 'Mode: current page layout',
      `Viewport: ${window.innerWidth}x${window.innerHeight}`,
      '',
    ]
    const placements = [...this.placements].sort((a, b) => Math.abs(a.y - b.y) < 20 ? a.x - b.x : a.y - b.y)
    placements.forEach((placement, index) => {
      const viewportY = this.placementViewportY(placement)
      lines.push(
        `${index + 1}. ${placement.label} (${placement.type})`,
        `   - Document position: ${placement.x}, ${placement.y}`,
        `   - Current viewport position: ${placement.x}, ${Math.round(viewportY)}`,
        `   - Size: ${placement.width}x${placement.height}`,
      )
      if (this.outputDetail !== 'compact') {
        lines.push(
          `   - Viewport percentages: x ${(placement.x / window.innerWidth * 100).toFixed(1)}%, y ${(viewportY / window.innerHeight * 100).toFixed(1)}%, width ${(placement.width / window.innerWidth * 100).toFixed(1)}%`,
          `   - ScrollY when placed: ${placement.scrollY}`,
        )
      }
    })
    lines.push('')
    return lines
  }

  private formatLayoutRearrangements(): string[] {
    const lines = [
      '## Layout rearrangements',
      '',
    ]
    const rearrangements = [...this.rearrangements].sort((a, b) => Math.abs(a.to.y - b.to.y) < 20 ? a.to.x - b.to.x : a.to.y - b.to.y)
    rearrangements.forEach((item, index) => {
      const dx = Math.round(item.to.x - item.from.x)
      const dy = Math.round(item.to.y - item.from.y)
      const viewportFrom = this.layoutViewportRect(item.from)
      const viewportTo = this.layoutViewportRect(item.to)
      lines.push(
        `${index + 1}. ${item.label}`,
        `   - Selector: \`${item.selector}\``,
        `   - From document: ${Math.round(item.from.x)}, ${Math.round(item.from.y)} / ${Math.round(item.from.width)}x${Math.round(item.from.height)}`,
        `   - To document: ${Math.round(item.to.x)}, ${Math.round(item.to.y)} / ${Math.round(item.to.width)}x${Math.round(item.to.height)}`,
        `   - Current viewport: ${Math.round(viewportFrom.x)}, ${Math.round(viewportFrom.y)} -> ${Math.round(viewportTo.x)}, ${Math.round(viewportTo.y)}`,
        `   - Delta: ${dx >= 0 ? '+' : ''}${dx}px, ${dy >= 0 ? '+' : ''}${dy}px`,
      )
      if (this.outputDetail !== 'compact') {
        lines.push(`   - ScrollY when moved: ${item.scrollY}`)
      }
    })
    lines.push('')
    return lines
  }

  private formatComputedStyles(styles: BrowserAnnotationElementStyle): string {
    return this.popupStyleRows({ styles } as BrowserAnnotationElement)
      .map(row => `${row.property}: ${row.value}`)
      .join('; ')
  }

  private formatAttributes(attributes: NonNullable<BrowserAnnotationElement['attributes']>): string {
    return Object.entries(attributes)
      .filter(([, value]) => typeof value === 'string' && value.trim().length > 0)
      .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
      .join(', ')
  }

  private designSummary(designChange: BrowserAnnotationDesignChange | null | undefined): string {
    if (!designChange) {
      return ''
    }
    return Object.entries(designChange)
      .filter(([, value]) => typeof value === 'string' && value.trim().length > 0)
      .map(([key, value]) => `${key}: ${value}`)
      .join('; ')
  }

  private popupStyleRows(element: BrowserAnnotationElement): Array<{ property: string, value: string }> {
    return BROWSER_ANNOTATION_POPUP_STYLE_FIELDS
      .map(({ key, property }) => ({
        property,
        value: element.styles[key],
      }))
      .filter((row): row is { property: string, value: string } => {
        return typeof row.value === 'string'
          && row.value.trim().length > 0
          && row.value !== 'rgba(0, 0, 0, 0)'
      })
  }

  private createStyleAccordion(
    rows: Array<{ property: string, value: string }>,
    promptRow: HTMLElement,
    textarea: HTMLTextAreaElement,
  ): HTMLDivElement {
    const wrapper = document.createElement('div')
    wrapper.setAttribute('data-cradle-browser-comment-styles-wrapper', 'true')
    wrapper.setAttribute('data-expanded', 'false')
    const inner = document.createElement('div')
    inner.setAttribute('data-cradle-browser-comment-styles-inner', 'true')
    const block = document.createElement('div')
    block.setAttribute('data-cradle-browser-comment-styles-block', 'true')

    for (const row of rows) {
      const line = document.createElement('div')
      line.setAttribute('data-cradle-browser-comment-style-line', 'true')
      const property = document.createElement('span')
      property.setAttribute('data-cradle-browser-comment-style-property', 'true')
      property.textContent = row.property
      const separator = document.createElement('span')
      separator.textContent = ': '
      const value = document.createElement('span')
      value.textContent = row.value
      const terminator = document.createElement('span')
      terminator.textContent = ';'
      line.append(property, separator, value, terminator)
      block.appendChild(line)
    }

    inner.appendChild(block)
    wrapper.appendChild(inner)
    promptRow.addEventListener('click', () => {
      const nextExpanded = wrapper.getAttribute('data-expanded') !== 'true'
      wrapper.setAttribute('data-expanded', String(nextExpanded))
      promptRow.setAttribute('aria-expanded', String(nextExpanded))
      promptRow
        .querySelector('[data-cradle-browser-comment-chevron]')
        ?.setAttribute('data-expanded', String(nextExpanded))
      if (!nextExpanded) {
        this.nativeSetTimeout(() => textarea.focus(), 0)
      }
    })
    return wrapper
  }

  private shakeEditor(): void {
    if (!this.root || !this.textarea) {
      return
    }
    if (this.shakeTimer !== null) {
      clearTimeout(this.shakeTimer)
    }
    this.root.setAttribute('data-cradle-browser-comment-shaking', 'true')
    this.shakeTimer = this.nativeSetTimeout(() => {
      this.root?.removeAttribute('data-cradle-browser-comment-shaking')
      this.shakeTimer = null
      this.textarea?.focus()
    }, 250)
  }

  private submit(type: 'save' | 'submit'): void {
    if (!this.selectedAnchor) {
      return
    }
    const body = this.textarea?.value.trim() ?? ''
    if (this.editingAnnotationId) {
      this.commitInlineEdit(body)
      return
    }
    const annotation: BrowserAnnotationRuntimeAnnotation = {
      id: `local-${Date.now()}`,
      anchor: this.selectedAnchor,
      body,
      designChange: this.designChange,
      status: type === 'submit' ? 'sent' : 'saved',
    }
    this.annotations = [...this.annotations, annotation]
    this.emit({
      type,
      runtimeAnnotationId: annotation.id,
      anchor: this.selectedAnchor,
      body,
      attachedImages: this.attachedImages,
      designChange: this.designChange,
      elements: this.scanElements(),
      surfaceSize: this.surfaceSize(),
    })
    this.clearActiveSelection()
    this.renderMarkers()
    this.renderToolbar()
  }

  private commitInlineEdit(body: string): void {
    if (!this.editingAnnotationId || !this.selectedAnchor) {
      return
    }
    const annotationId = this.editingAnnotationId
    const designChange = this.designChange
    this.annotations = this.annotations.map(annotation =>
      annotation.id === annotationId
        ? {
            ...annotation,
            anchor: this.selectedAnchor as BrowserAnnotationAnchor,
            body,
            designChange,
          }
        : annotation)
    this.emit({
      type: 'edit',
      annotationId,
      anchor: this.selectedAnchor,
      body,
      attachedImages: this.attachedImages,
      designChange,
      elements: this.scanElements(),
      surfaceSize: this.surfaceSize(),
    })
    this.closeInlineEditor()
    this.renderMarkers()
    this.renderToolbar()
  }

  private closeInlineEditor(): void {
    this.editor?.remove()
    this.editor = null
    this.textarea = null
    this.fileInput = null
    this.editingAnnotationId = null
    this.selectedAnchor = null
    this.selectedElement = null
    this.selectedElements = []
    this.attachedImages = []
    this.designChange = null
    this.stage = 'selecting'
    this.clearSelectionFrames()
    this.hideRegion()
    this.hideHighlight()
    this.emitSelection(null)
  }

  private async readAttachedFiles(files: FileList | null): Promise<BrowserPanelPromptAttachment[]> {
    if (!files) {
      return []
    }
    return (await Promise.all(Array.from(files).map(async file => ({
      filename: file.name,
      mediaType: file.type || 'application/octet-stream',
      url: await blobToDataUrl(file),
    })))).slice(0, 12)
  }

  private scanElements(): BrowserAnnotationElement[] {
    return Array.from(document.querySelectorAll('body *'))
      .map((element, index) => this.readElement(element, index))
      .filter(element => element !== null)
      .slice(0, 250)
  }

  private readElement(element: Element, index: number): BrowserAnnotationElement | null {
    if (element.closest('#cradle-browser-comment-root, script, style, meta, link, noscript')) {
      return null
    }
    const rect = element.getBoundingClientRect()
    const style = window.getComputedStyle(element)
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0
    if (
      rect.width <= 0
      || rect.height <= 0
      || rect.right < 0
      || rect.bottom < 0
      || rect.left > viewportWidth
      || rect.top > viewportHeight
      || style.visibility === 'hidden'
      || style.display === 'none'
      || Number(style.opacity) === 0
    ) {
      return null
    }

    const attributes = this.attributesFor(element)
    const label = this.labelFor(element)
    const role = this.roleFor(element)
    return {
      id: `element-${index}`,
      tagName: element.tagName,
      label,
      description: this.descriptionFor(attributes),
      role,
      selector: this.cssPath(element),
      attributes,
      pageUrl: window.location.href,
      nearbyText: this.nearbyTextFor(element),
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
      reactComponents: this.reactDetectionEnabled ? this.reactComponentsFor(element) : null,
    }
  }

  private applyDesign(selector: string | undefined, designChange: BrowserAnnotationDesignChange): void {
    if (!selector) {
      return
    }
    const element = document.querySelector(selector)
    if (!element) {
      return
    }

    this.clearDesign()
    this.designElement = element
    element.setAttribute('data-cradle-browser-design-group', 'active')
    this.designChange = designChange
    const rows = [
      this.cssDeclaration('color', designChange.color),
      this.cssDeclaration('background-color', designChange.backgroundColor),
      this.cssDeclaration('opacity', designChange.opacity),
      this.cssDeclaration('font-family', designChange.fontFamily),
      this.cssDeclaration('font-size', designChange.fontSize),
      this.cssDeclaration('font-weight', designChange.fontWeight),
      this.cssDeclaration('border-radius', designChange.borderRadius),
      this.cssDeclaration('border-color', designChange.borderColor),
      this.cssDeclaration('border-width', designChange.borderWidth),
      this.cssDeclaration('display', designChange.display),
      this.cssDeclaration('align-items', designChange.alignItems),
      this.cssDeclaration('justify-content', designChange.justifyContent),
      this.cssDeclaration('flex-direction', designChange.flexDirection),
      this.cssDeclaration('width', designChange.width),
      this.cssDeclaration('height', designChange.height),
      this.cssDeclaration('margin-top', designChange.marginTop),
      this.cssDeclaration('margin-right', designChange.marginRight),
      this.cssDeclaration('margin-bottom', designChange.marginBottom),
      this.cssDeclaration('margin-left', designChange.marginLeft),
      this.cssDeclaration('padding-top', designChange.paddingTop),
      this.cssDeclaration('padding-right', designChange.paddingRight),
      this.cssDeclaration('padding-bottom', designChange.paddingBottom),
      this.cssDeclaration('padding-left', designChange.paddingLeft),
      this.cssDeclaration('row-gap', designChange.rowGap),
      this.cssDeclaration('column-gap', designChange.columnGap),
    ].filter(row => row !== null)

    let style = document.getElementById('cradle-browser-design-draft-style')
    if (!style) {
      style = document.createElement('style')
      style.id = 'cradle-browser-design-draft-style'
      style.setAttribute('data-cradle-browser-runtime', 'annotation-design')
      document.head.appendChild(style)
    }
    style.textContent = rows.length > 0
      ? `[data-cradle-browser-design-group="active"] { ${rows.join(' ')} }`
      : ''

    const annotationElement = this.readElement(element, 0)
    if (annotationElement) {
      this.selectElements([element])
    }
  }

  private clearDesign(): void {
    this.designElement?.removeAttribute('data-cradle-browser-design-group')
    this.designElement = null
    this.designChange = null
    document.getElementById('cradle-browser-design-draft-style')?.remove()
  }

  private cssDeclaration(property: string, value: string | undefined): string | null {
    if (!value?.trim()) {
      return null
    }
    return `${property}: ${value.trim().replace(/[;{}]/g, '')} !important;`
  }

  private elementFromPoint(x: number, y: number): Element | null {
    return this.deepElementsFromPoint(document, x, y).find(element =>
      !element.closest('#cradle-browser-comment-root')
      && !['HTML', 'BODY'].includes(element.tagName)) ?? null
  }

  private deepElementsFromPoint(
    root: Document | ShadowRoot,
    x: number,
    y: number,
  ): Element[] {
    const elements = root.elementsFromPoint(x, y)
    const deepElements: Element[] = []
    for (const element of elements) {
      deepElements.push(element)
      if (element.shadowRoot) {
        deepElements.push(...this.deepElementsFromPoint(element.shadowRoot, x, y))
      }
    }
    return deepElements
  }

  private showHighlight(rect: DOMRect, element: BrowserAnnotationElement | null = null): void {
    if (!this.highlight) {
      return
    }
    this.highlight.hidden = false
    this.highlight.style.left = `${rect.left}px`
    this.highlight.style.top = `${rect.top}px`
    this.highlight.style.width = `${rect.width}px`
    this.highlight.style.height = `${rect.height}px`
    if (this.highlightLabel) {
      this.highlightLabel.hidden = false
      this.highlightLabel.style.left = `${Math.max(8, rect.left)}px`
      this.highlightLabel.style.top = `${Math.max(8, rect.top - 22)}px`
      this.highlightLabel.innerHTML = ''
      const label = document.createElement('span')
      label.textContent = element ? this.elementTokenLabel(element) : 'Element'
      this.highlightLabel.appendChild(label)
    }
  }

  private hideHighlight(): void {
    if (this.highlight) {
      this.highlight.hidden = true
    }
    if (this.highlightLabel) {
      this.highlightLabel.hidden = true
    }
  }

  private showRegion(rect: { x: number, y: number, width: number, height: number }): void {
    if (!this.region) {
      return
    }
    this.region.hidden = false
    this.region.style.left = `${rect.x}px`
    this.region.style.top = `${rect.y}px`
    this.region.style.width = `${rect.width}px`
    this.region.style.height = `${rect.height}px`
  }

  private hideRegion(): void {
    if (this.region) {
      this.region.hidden = true
    }
  }

  private selectPoint(x: number, y: number): void {
    this.stage = 'editing'
    this.selectedElement = null
    this.selectedElements = []
    this.selectedAnchor = { kind: 'point', x, y, scrollY: Math.round(window.scrollY) }
    this.clearSelectionFrames()
    this.hideHighlight()
  }

  private selectRegion(rect: { x: number, y: number, width: number, height: number }): void {
    this.stage = 'editing'
    this.selectedElement = null
    this.selectedElements = []
    this.selectedAnchor = { kind: 'region', ...rect, scrollY: Math.round(window.scrollY) }
    this.clearSelectionFrames()
    this.hideHighlight()
  }

  private selectText(anchor: { text: string, x: number, y: number, width: number, height: number }): void {
    this.stage = 'editing'
    this.selectedElement = null
    this.selectedElements = []
    this.selectedAnchor = { kind: 'text', ...anchor, scrollY: Math.round(window.scrollY) }
    this.clearSelectionFrames()
    this.hideHighlight()
  }

  private selectTextRangeFromPoints(
    start: { x: number, y: number },
    end: { x: number, y: number },
  ): boolean {
    const startRange = this.caretRangeFromPoint(start.x, start.y)
    const endRange = this.caretRangeFromPoint(end.x, end.y)
    if (!startRange || !endRange) {
      return false
    }

    const range = document.createRange()
    const isReverseSelection = startRange.compareBoundaryPoints(Range.START_TO_START, endRange) > 0
    const rangeStart = isReverseSelection ? endRange : startRange
    const rangeEnd = isReverseSelection ? startRange : endRange
    range.setStart(rangeStart.startContainer, rangeStart.startOffset)
    range.setEnd(rangeEnd.startContainer, rangeEnd.startOffset)
    if (range.collapsed) {
      return false
    }
    return this.selectTextRange(range)
  }

  private selectTextRange(range: Range): boolean {
    const text = range.toString().replace(/\s+/g, ' ').trim()
    if (text.length === 0) {
      return false
    }
    const rect = range.getBoundingClientRect()
    const fallbackRect = this.rectFromPoints(
      { x: rect.left, y: rect.top },
      { x: rect.right, y: rect.bottom },
    )
    const anchorRect = rect.width > 0 && rect.height > 0
      ? {
          x: rect.left,
          y: rect.top,
          width: rect.width,
          height: rect.height,
        }
      : fallbackRect

    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    this.selectText({
      text,
      ...anchorRect,
    })
    this.showRegion(anchorRect)
    this.openEditor(anchorRect, this.anchorLabel())
    if (this.textarea && !this.textarea.value) {
      this.textarea.placeholder = 'Describe the copy change...'
    }
    this.emitSelection(null)
    return true
  }

  private caretRangeFromPoint(x: number, y: number): Range | null {
    const documentWithCaretRange = document as Document & {
      caretRangeFromPoint?: (x: number, y: number) => Range | null
      caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node, offset: number } | null
    }
    const caretRange = documentWithCaretRange.caretRangeFromPoint?.(x, y)
    if (caretRange) {
      return caretRange
    }
    const caretPosition = documentWithCaretRange.caretPositionFromPoint?.(x, y)
    if (!caretPosition) {
      return null
    }
    const range = document.createRange()
    range.setStart(caretPosition.offsetNode, caretPosition.offset)
    range.collapse(true)
    return range
  }

  private selectElements(elements: Element[]): {
    anchor: BrowserAnnotationAnchor
    element: BrowserAnnotationElement
  } | null {
    const uniqueElements = Array.from(new Set(elements)).filter(element => this.readElement(element, 0))
    if (uniqueElements.length === 0) {
      return null
    }

    const primaryElement = uniqueElements.at(-1)
    if (!primaryElement) {
      return null
    }
    const annotationElement = this.readElement(primaryElement, 0)
    if (!annotationElement) {
      return null
    }

    this.selectedElement = primaryElement
    this.selectedElements = uniqueElements
    this.stage = 'editing'
    if (uniqueElements.length === 1) {
      this.selectedAnchor = { kind: 'element', element: annotationElement }
      this.hideHighlight()
      this.renderSelectionFrames(uniqueElements)
      return {
        anchor: this.selectedAnchor,
        element: annotationElement,
      }
    }

    const region = this.boundsForElements(uniqueElements)
    this.selectedAnchor = { kind: 'region', ...region }
    this.hideHighlight()
    this.renderSelectionFrames(uniqueElements)
    return {
      anchor: this.selectedAnchor,
      element: annotationElement,
    }
  }

  private boundsForElements(elements: Element[]): { x: number, y: number, width: number, height: number } {
    const rects = elements.map(element => element.getBoundingClientRect())
    const left = Math.min(...rects.map(rect => rect.left))
    const top = Math.min(...rects.map(rect => rect.top))
    const right = Math.max(...rects.map(rect => rect.right))
    const bottom = Math.max(...rects.map(rect => rect.bottom))
    return {
      x: Math.max(0, left),
      y: Math.max(0, top),
      width: Math.max(1, Math.min(window.innerWidth, right) - Math.max(0, left)),
      height: Math.max(1, Math.min(window.innerHeight, bottom) - Math.max(0, top)),
    }
  }

  private renderSelectionFrames(elements: Element[]): void {
    this.clearSelectionFrames()
    if (!this.root) {
      return
    }
    elements.forEach((element, index) => {
      const rect = element.getBoundingClientRect()
      const frame = document.createElement('div')
      frame.setAttribute('data-cradle-browser-comment-selection-frame', 'true')
      if (elements.length > 1) {
        frame.setAttribute('data-multi', 'true')
      }
      frame.style.left = `${rect.left}px`
      frame.style.top = `${rect.top}px`
      frame.style.width = `${rect.width}px`
      frame.style.height = `${rect.height}px`
      this.root?.appendChild(frame)
      this.selectionFrames.push(frame)
      if (index === elements.length - 1) {
        const annotationElement = this.readElement(element, 0)
        const label = document.createElement('div')
        label.setAttribute('data-cradle-browser-comment-selection-label', 'true')
        if (elements.length > 1) {
          label.setAttribute('data-multi', 'true')
        }
        label.style.left = `${Math.max(8, rect.left)}px`
        label.style.top = `${Math.max(8, rect.top - 22)}px`
        const labelText = document.createElement('span')
        labelText.textContent = annotationElement
          ? `${elements.length} selected · ${this.elementTokenLabel(annotationElement)}`
          : `${elements.length} selected`
        label.appendChild(labelText)
        this.root?.appendChild(label)
        this.selectionFrames.push(label)
      }
    })
  }

  private clearSelectionFrames(): void {
    for (const frame of this.selectionFrames) {
      frame.remove()
    }
    this.selectionFrames = []
  }

  private anchorLabelFor(anchor: BrowserAnnotationAnchor): string {
    if (anchor.kind === 'point') {
      return `point (${Math.round(anchor.x)}, ${Math.round(anchor.y)})`
    }
    if (anchor.kind === 'element') {
      return this.elementTokenLabel(anchor.element)
    }
    if (anchor.kind === 'text') {
      return `"${anchor.text.slice(0, 72)}${anchor.text.length > 72 ? '...' : ''}"`
    }
    return `region (${Math.round(anchor.x)}, ${Math.round(anchor.y)}, ${Math.round(anchor.width)} x ${Math.round(anchor.height)})`
  }

  private isTypingTarget(target: EventTarget | null): boolean {
    if (!(target instanceof Element)) {
      return false
    }
    return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'))
  }

  private isInteractiveElement(element: Element): boolean {
    return Boolean(element.closest([
      'button',
      'a',
      'input',
      'select',
      'textarea',
      'summary',
      '[role="button"]',
      '[role="link"]',
      '[onclick]',
      '[contenteditable="true"]',
    ].join(',')))
  }

  private isTextSelectionElement(element: Element): boolean {
    if (element.closest('input, textarea, select, [contenteditable="true"]')) {
      return false
    }
    const textElement = element.closest([
      'p',
      'span',
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'li',
      'td',
      'th',
      'label',
      'blockquote',
      'figcaption',
      'caption',
      'legend',
      'dt',
      'dd',
      'pre',
      'code',
      'em',
      'strong',
      'b',
      'i',
      'u',
      's',
      'a',
      'time',
      'address',
      'cite',
      'q',
      'abbr',
      'dfn',
      'mark',
      'small',
      'sub',
      'sup',
    ].join(','))
    return Boolean(textElement?.textContent?.trim())
  }

  private rectForAnchor(anchor: BrowserAnnotationAnchor): { x: number, y: number, width: number, height: number } {
    if (anchor.kind === 'point') {
      return { x: anchor.x, y: this.viewportYForAnchor(anchor), width: 1, height: 1 }
    }
    if (anchor.kind === 'element') {
      const liveRect = this.liveRectForElementAnchor(anchor)
      if (liveRect) {
        return liveRect
      }
      return anchor.element.rect
    }
    if (anchor.kind === 'text') {
      return {
        x: anchor.x,
        y: this.viewportYForAnchor(anchor),
        width: anchor.width,
        height: anchor.height,
      }
    }
    return {
      ...anchor,
      y: this.viewportYForAnchor(anchor),
    }
  }

  private viewportYForAnchor(
    anchor: Extract<BrowserAnnotationAnchor, { kind: 'point' | 'region' | 'text' }>,
  ): number {
    return typeof anchor.scrollY === 'number'
      ? anchor.y + anchor.scrollY - window.scrollY
      : anchor.y
  }

  private liveRectForElementAnchor(
    anchor: Extract<BrowserAnnotationAnchor, { kind: 'element' }>,
  ): { x: number, y: number, width: number, height: number } | null {
    try {
      const element = document.querySelector(anchor.element.selector)
      if (!element || element.closest('#cradle-browser-comment-root')) {
        return null
      }
      const rect = element.getBoundingClientRect()
      return {
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
      }
    }
    catch {
      return null
    }
  }

  private anchorLabel(): string {
    if (!this.selectedAnchor) {
      return 'selection'
    }
    if (this.selectedElements.length > 1) {
      return `${this.selectedElements.length} elements`
    }
    if (this.selectedAnchor.kind === 'element') {
      return this.elementTokenLabel(this.selectedAnchor.element)
    }
    if (this.selectedAnchor.kind === 'region') {
      return 'region'
    }
    if (this.selectedAnchor.kind === 'text') {
      return `"${this.selectedAnchor.text.slice(0, 40)}${this.selectedAnchor.text.length > 40 ? '...' : ''}"`
    }
    return 'point'
  }

  private elementTokenLabel(element: BrowserAnnotationElement): string {
    const name = (this.reactDetectionEnabled ? element.reactComponents : null)
      || element.label
      || element.attributes?.id
      || element.role
      || this.shortSelectorLabel(element.selector)
    const trimmed = (name || 'Element').replace(/\s+/g, ' ').trim()
    const concise = trimmed.length > 48 ? `${trimmed.slice(0, 47)}…` : trimmed
    return `${concise} <${element.tagName.toLowerCase()}>`
  }

  /** The visible token is a human handle, not a machine path — keep only the leaf segment. */
  private shortSelectorLabel(selector: string): string {
    const segment = selector.split('>').pop()?.trim() ?? selector
    return segment.replace(/:nth-of-type\(\d+\)/g, '')
  }

  private reactComponentsFor(element: Element): string | null {
    const mode = this.reactDetectionMode()
    if (mode === 'off') {
      return null
    }
    const fiber = this.reactFiberFor(element)
    if (!fiber) {
      return null
    }
    const names: Array<{ name: string, depth: number }> = []
    let current: unknown = fiber
    let depth = 0
    while (current && typeof current === 'object' && depth < 30) {
      const record = current as {
        tag?: number
        type?: unknown
        elementType?: unknown
        return?: unknown
      }
      const name = this.reactComponentName(record.elementType) ?? this.reactComponentName(record.type)
      if (name && !names.some(item => item.name === name)) {
        names.unshift({ name, depth })
      }
      current = record.return
      depth += 1
    }
    const filtered = names
      .filter(item => this.shouldIncludeReactComponentName(item.name, item.depth, mode, element))
      .slice(mode === 'all' ? -8 : -4)
      .map(item => `<${item.name}>`)
    return filtered.length > 0 ? filtered.join(' ') : null
  }

  private reactDetectionMode(): BrowserAnnotationReactDetectionMode {
    if (!this.reactDetectionEnabled || this.outputDetail === 'compact') {
      return 'off'
    }
    if (this.outputDetail === 'forensic') {
      return 'all'
    }
    if (this.outputDetail === 'detailed') {
      return 'smart'
    }
    return 'filtered'
  }

  private reactFiberFor(element: Element): unknown {
    const keys = Object.keys(element)
    const fiberKey = keys.find(key =>
      key.startsWith('__reactFiber$')
      || key.startsWith('__reactInternalInstance$')
      || key.startsWith('__reactProps$'))
    if (!fiberKey) {
      return null
    }
    const value = (element as unknown as Record<string, unknown>)[fiberKey]
    if (!fiberKey.startsWith('__reactProps$')) {
      return value
    }
    const fallbackKey = keys.find(key =>
      key.startsWith('__reactFiber$') || key.startsWith('__reactInternalInstance$'))
    return fallbackKey ? (element as unknown as Record<string, unknown>)[fallbackKey] : null
  }

  private reactComponentName(type: unknown): string | null {
    if (!type) {
      return null
    }
    if (typeof type === 'string') {
      return null
    }
    if (typeof type === 'function') {
      const fn = type as { displayName?: string, name?: string }
      return fn.displayName || fn.name || null
    }
    if (typeof type !== 'object') {
      return null
    }
    const record = type as {
      displayName?: unknown
      name?: unknown
      render?: { displayName?: unknown, name?: unknown }
      type?: unknown
      _result?: unknown
    }
    if (typeof record.displayName === 'string') {
      return record.displayName
    }
    if (typeof record.name === 'string') {
      return record.name
    }
    if (typeof record.render?.displayName === 'string') {
      return record.render.displayName
    }
    if (typeof record.render?.name === 'string') {
      return record.render.name
    }
    return this.reactComponentName(record.type) ?? this.reactComponentName(record._result)
  }

  private shouldIncludeReactComponentName(
    name: string,
    depth: number,
    mode: BrowserAnnotationReactDetectionMode,
    element: Element,
  ): boolean {
    if (mode === 'all') {
      return true
    }
    if (this.shouldSkipReactComponentName(name)) {
      return false
    }
    if (mode === 'filtered') {
      return true
    }
    return this.reactComponentMatchesElement(name, element) || this.looksLikeUserComponentName(name) || depth < 4
  }

  private shouldSkipReactComponentName(name: string): boolean {
    return name === 'Component'
      || name === 'PureComponent'
      || name === 'Fragment'
      || name === 'StrictMode'
      || name === 'Suspense'
      || name === 'Profiler'
      || name === 'Provider'
      || name === 'Consumer'
      || name === 'Root'
      || /^(Inner|Outer)/.test(name)
      || /^(React|Dev).*Overlay/.test(name)
      || /Boundary(Handler)?$/.test(name)
      || name.endsWith('Provider')
      || name.endsWith('Consumer')
      || name.endsWith('Router')
      || /^Client(Page|Segment|Root)/.test(name)
      || /^Segment(ViewNode|Node)$/.test(name)
      || name.startsWith('LayoutSegment')
      || /^Server(Root|Component|Render)/.test(name)
      || name.startsWith('RSC')
      || name.endsWith('Context')
      || /^With[A-Z]/.test(name)
      || name.endsWith('Wrapper')
  }

  private reactComponentMatchesElement(name: string, element: Element): boolean {
    const normalizedName = this.normalizeReactComponentName(name)
    let current: Element | null = element
    let depth = 0
    while (current && depth < 10) {
      if (typeof current.className === 'string') {
        const classNames = current.className.toLowerCase().split(/\s+/)
        if (classNames.some(className => className.includes(normalizedName) || normalizedName.includes(className))) {
          return true
        }
      }
      current = current.parentElement
      depth += 1
    }
    return false
  }

  private normalizeReactComponentName(name: string): string {
    return name
      .replace(/([a-z])([A-Z])/g, '$1-$2')
      .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
      .toLowerCase()
  }

  private looksLikeUserComponentName(name: string): boolean {
    return /(?:Page|View|Screen|Section|Card|List|Item|Form|Modal|Dialog|Button|Nav|Header|Footer|Layout|Panel|Tab|Menu)$/.test(name)
  }

  private firstNavigableChild(element: Element): Element | null {
    return Array.from(element.children).find(child => this.readElement(child, 0)) ?? null
  }

  private navigableParent(element: Element): Element | null {
    let parent = element.parentElement
    while (parent && parent !== document.body) {
      if (this.readElement(parent, 0)) {
        return parent
      }
      parent = parent.parentElement
    }
    return null
  }

  private nextNavigableSibling(element: Element): Element | null {
    let sibling = element.nextElementSibling
    while (sibling) {
      if (this.readElement(sibling, 0)) {
        return sibling
      }
      sibling = sibling.nextElementSibling
    }
    return null
  }

  private previousNavigableSibling(element: Element): Element | null {
    let sibling = element.previousElementSibling
    while (sibling) {
      if (this.readElement(sibling, 0)) {
        return sibling
      }
      sibling = sibling.previousElementSibling
    }
    return null
  }

  private rectFromPoints(
    start: { x: number, y: number },
    end: { x: number, y: number },
  ): { x: number, y: number, width: number, height: number } {
    const x = Math.min(start.x, end.x)
    const y = Math.min(start.y, end.y)
    return {
      x,
      y,
      width: Math.abs(end.x - start.x),
      height: Math.abs(end.y - start.y),
    }
  }

  private cssPath(element: Element): string {
    const parts: string[] = []
    let current: Element | null = element
    while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.body) {
      const tag = current.tagName.toLowerCase()
      if (current.id) {
        parts.unshift(`${tag}#${CSS.escape(current.id)}`)
        break
      }
      const classes = Array.from(current.classList || [])
        .slice(0, 2)
        .map(name => `.${CSS.escape(name)}`)
        .join('')
      let index = 1
      let sibling = current.previousElementSibling
      while (sibling) {
        if (sibling.tagName === current.tagName) {
          index += 1
        }
        sibling = sibling.previousElementSibling
      }
      parts.unshift(`${tag}${classes}:nth-of-type(${index})`)
      current = current.parentElement
    }
    return parts.join(' > ')
  }

  private labelFor(element: Element): string {
    const inputValue = 'value' in element && typeof element.value === 'string' ? element.value : ''
    const text = element.getAttribute('aria-label')
      || element.getAttribute('alt')
      || element.getAttribute('title')
      || element.getAttribute('placeholder')
      || inputValue
      || element.textContent
      || ''
    return text.replace(/\s+/g, ' ').trim().slice(0, 140)
  }

  private nearbyTextFor(element: Element): string {
    return (element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 400)
  }

  private roleFor(element: Element): string {
    const explicit = element.getAttribute('role')
    if (explicit) {
      return explicit
    }
    switch (element.tagName) {
      case 'A':
        return element.hasAttribute('href') ? 'link' : ''
      case 'BUTTON':
        return 'button'
      case 'IMG':
        return 'img'
      case 'INPUT': {
        const type = (element.getAttribute('type') || 'text').toLowerCase()
        if (type === 'checkbox') {
          return 'checkbox'
        }
        if (type === 'radio') {
          return 'radio'
        }
        if (type === 'range') {
          return 'slider'
        }
        if (type === 'submit' || type === 'button' || type === 'reset') {
          return 'button'
        }
        return 'textbox'
      }
      case 'TEXTAREA':
        return 'textbox'
      case 'SELECT':
        return 'combobox'
      default:
        return ''
    }
  }

  private attributesFor(element: Element): BrowserAnnotationElement['attributes'] {
    const inputValue = 'value' in element && typeof element.value === 'string' ? element.value : ''
    return {
      id: element.id || undefined,
      className: element.className && typeof element.className === 'string'
        ? element.className.slice(0, 160)
        : undefined,
      ariaLabel: element.getAttribute('aria-label') || undefined,
      title: element.getAttribute('title') || undefined,
      alt: element.getAttribute('alt') || undefined,
      href: element instanceof HTMLAnchorElement ? element.href : element.getAttribute('href') || undefined,
      type: element.getAttribute('type') || undefined,
      name: element.getAttribute('name') || undefined,
      placeholder: element.getAttribute('placeholder') || undefined,
      value: inputValue ? inputValue.slice(0, 120) : undefined,
      testId: element.getAttribute('data-testid') || element.getAttribute('data-test-id') || undefined,
    }
  }

  private descriptionFor(attributes: BrowserAnnotationElement['attributes']): string {
    const parts = [
      attributes?.href ? `href=${attributes.href}` : null,
      attributes?.placeholder ? `placeholder=${attributes.placeholder}` : null,
      attributes?.name ? `name=${attributes.name}` : null,
      attributes?.type ? `type=${attributes.type}` : null,
      attributes?.testId ? `testid=${attributes.testId}` : null,
    ].filter(part => part !== null)
    return parts.join(' · ').slice(0, 220)
  }

  private surfaceSize(): { width: number, height: number } {
    return {
      width: window.innerWidth || document.documentElement.clientWidth || 0,
      height: window.innerHeight || document.documentElement.clientHeight || 0,
    }
  }

  private emit(event: BrowserAnnotationRuntimeEvent): void {
    void ipcRenderer.invoke(BROWSER_ANNOTATION_RUNTIME_EVENT_CHANNEL, event).catch(() => {})
  }
}
