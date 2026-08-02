export const BROWSER_SEND_PROMPT_CHANNEL = 'desktop:browser-send-prompt'
export const BROWSER_ANNOTATION_RUNTIME_COMMAND_CHANNEL = 'desktop:browser-annotation-runtime-command'
export const BROWSER_ANNOTATION_RUNTIME_EVENT_CHANNEL = 'desktop:browser-annotation-runtime-event'

export interface BrowserPanelPromptAttachment {
  filename?: string
  mediaType?: string
  url: string
}

export type BrowserPanelAttachmentInput
  = | string
    | Blob
    | {
        dataURL?: string
        dataUrl?: string
        filename?: string
        mediaType?: string
        mimeType?: string
        name?: string
        type?: string
        url?: string
      }

export type BrowserPanelSendPromptInput
  = | string
    | {
        attachments?: BrowserPanelAttachmentInput[]
        files?: BrowserPanelAttachmentInput[]
        prompt?: string
        text?: string
      }

export interface BrowserPanelSendPromptPayload {
  text: string
  attachments: BrowserPanelPromptAttachment[]
}

export interface BrowserAnnotationElementStyle {
  color: string
  backgroundColor: string
  opacity: string
  fontFamily: string
  fontSize: string
  fontWeight: string
  fontStyle?: string
  lineHeight: string
  letterSpacing?: string
  textAlign?: string
  textTransform?: string
  textDecorationLine?: string
  borderRadius: string
  borderColor?: string
  borderWidth?: string
  borderStyle?: string
  boxShadow?: string
  display?: string
  alignItems?: string
  justifyContent?: string
  flexDirection?: string
  flexWrap?: string
  overflow?: string
  position?: string
  zIndex?: string
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
      componentType: BrowserAnnotationLayoutComponentType
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
  fontStyle?: string
  lineHeight?: string
  letterSpacing?: string
  textAlign?: string
  textTransform?: string
  textDecorationLine?: string
  borderRadius?: string
  borderColor?: string
  borderWidth?: string
  borderStyle?: string
  boxShadow?: string
  display?: string
  alignItems?: string
  justifyContent?: string
  flexDirection?: string
  flexWrap?: string
  overflow?: string
  position?: string
  zIndex?: string
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

/** Canonical draft-style key → CSS property mapping shared by the runtime and hosts. */
export const BROWSER_ANNOTATION_DESIGN_CSS_PROPERTIES: ReadonlyArray<{
  key: Exclude<keyof BrowserAnnotationDesignChange, 'comment'>
  property: string
}> = [
  { key: 'color', property: 'color' },
  { key: 'backgroundColor', property: 'background-color' },
  { key: 'opacity', property: 'opacity' },
  { key: 'fontFamily', property: 'font-family' },
  { key: 'fontSize', property: 'font-size' },
  { key: 'fontWeight', property: 'font-weight' },
  { key: 'fontStyle', property: 'font-style' },
  { key: 'lineHeight', property: 'line-height' },
  { key: 'letterSpacing', property: 'letter-spacing' },
  { key: 'textAlign', property: 'text-align' },
  { key: 'textTransform', property: 'text-transform' },
  { key: 'textDecorationLine', property: 'text-decoration-line' },
  { key: 'borderRadius', property: 'border-radius' },
  { key: 'borderColor', property: 'border-color' },
  { key: 'borderWidth', property: 'border-width' },
  { key: 'borderStyle', property: 'border-style' },
  { key: 'boxShadow', property: 'box-shadow' },
  { key: 'display', property: 'display' },
  { key: 'alignItems', property: 'align-items' },
  { key: 'justifyContent', property: 'justify-content' },
  { key: 'flexDirection', property: 'flex-direction' },
  { key: 'flexWrap', property: 'flex-wrap' },
  { key: 'overflow', property: 'overflow' },
  { key: 'position', property: 'position' },
  { key: 'zIndex', property: 'z-index' },
  { key: 'width', property: 'width' },
  { key: 'height', property: 'height' },
  { key: 'marginTop', property: 'margin-top' },
  { key: 'marginRight', property: 'margin-right' },
  { key: 'marginBottom', property: 'margin-bottom' },
  { key: 'marginLeft', property: 'margin-left' },
  { key: 'paddingTop', property: 'padding-top' },
  { key: 'paddingRight', property: 'padding-right' },
  { key: 'paddingBottom', property: 'padding-bottom' },
  { key: 'paddingLeft', property: 'padding-left' },
  { key: 'rowGap', property: 'row-gap' },
  { key: 'columnGap', property: 'column-gap' },
]

export interface BrowserAnnotationRuntimeCommand {
  type: 'start' | 'stop' | 'apply-design' | 'clear-design' | 'notify'
  selector?: string
  designChange?: BrowserAnnotationDesignChange
  annotations?: BrowserAnnotationRuntimeAnnotation[]
  editAnnotationId?: string | null
  layoutHints?: BrowserAnnotationLayoutHint[]
  notification?: BrowserAnnotationRuntimeNotification
}

export interface BrowserAnnotationRuntimeNotification {
  message: string
  tone?: 'neutral' | 'success' | 'error'
}

export interface BrowserAnnotationRuntimeEvent {
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
  attachedImages?: BrowserPanelPromptAttachment[]
  designChange?: BrowserAnnotationDesignChange | null
  elements?: BrowserAnnotationElement[]
  surfaceSize?: {
    width: number
    height: number
  }
}

export type BrowserAnnotationRuntimeStage = 'selecting' | 'editing'
export type BrowserAnnotationOutputDetail = 'compact' | 'standard' | 'detailed' | 'forensic'
export type BrowserAnnotationMarkerClickBehavior = 'delete' | 'edit'
export type BrowserAnnotationMarkerColorId = 'blue' | 'green' | 'purple' | 'orange' | 'red'
export type BrowserAnnotationReactDetectionMode = 'off' | 'filtered' | 'smart' | 'all'
export type BrowserAnnotationResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'
export type BrowserAnnotationLayoutComponentType
  = | 'navigation'
    | 'hero'
    | 'card'
    | 'button'
    | 'sidebar'
    | 'table'
    | 'form'
    | 'input'
    | 'modal'
    | 'footer'
    | 'avatar'
    | 'badge'
    | 'text'
    | 'image'
    | 'list'
    | 'tabs'
    | 'header'
    | 'section'
    | 'grid'
    | 'dropdown'
    | 'toggle'
    | 'breadcrumb'
    | 'pagination'
    | 'progress'
    | 'divider'
    | 'accordion'
    | 'carousel'
    | 'chart'
    | 'video'
    | 'search'
    | 'toast'
    | 'tooltip'
    | 'pricing'
    | 'testimonial'
    | 'cta'
    | 'alert'
    | 'banner'
    | 'stat'
    | 'stepper'
    | 'tag'
    | 'rating'
    | 'map'
    | 'timeline'
    | 'fileUpload'
    | 'codeBlock'
    | 'calendar'
    | 'notification'
    | 'productCard'
    | 'profile'
    | 'drawer'
    | 'popover'
    | 'logo'
    | 'faq'
    | 'gallery'
    | 'checkbox'
    | 'radio'
    | 'slider'
    | 'datePicker'
    | 'skeleton'
    | 'chip'
    | 'icon'
    | 'spinner'
    | 'feature'
    | 'team'
    | 'login'
    | 'contact'

export interface BrowserAnnotationRuntimeSettings {
  blockInteractions: boolean
  clearOnCopySend: boolean
  markerClickBehavior: BrowserAnnotationMarkerClickBehavior
  markerColorId: BrowserAnnotationMarkerColorId
  outputDetail: BrowserAnnotationOutputDetail
  reactDetectionEnabled: boolean
  toolbarPosition: { x: number, y: number } | null
}
