import type { FileUIPart } from 'ai'

export interface ComposerSlashCommandActionResult {
  insertText?: string
  fileParts?: FileUIPart[]
}

export interface ComposerSlashCommandActionTools {
  readActionContext: (options?: ComposerActionContextOptions) => ComposerSlashCommandActionContext
}

export interface ComposerSlashCommandRect {
  x: number
  y: number
  width: number
  height: number
}

export interface ComposerSlashCommandDisplay {
  id: number
  scaleFactor: number
  bounds: ComposerSlashCommandRect
  workArea: ComposerSlashCommandRect
}

export interface ComposerSlashCommandAnimationTarget {
  coordinateSpace?: 'viewportPixels'
  codexDisplay: ComposerSlashCommandDisplay
  destinationBackgroundColor: string
  destinationCornerRadius: number
  destinationFrame: ComposerSlashCommandRect
  destinationPrimaryTextColor: string
  transitionSnapshotScale?: number
}

export interface ComposerSlashCommandActionContext {
  animationTarget?: ComposerSlashCommandAnimationTarget
}

export interface ComposerActionContextOptions {
  pendingAppshotRequestId?: string | null
  attachmentTrayGrowthDirection?: 'up' | 'down'
  transitionSnapshotHeight?: number | null
}

const HEX_COLOR_RE = /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i
const RGB_COLOR_RE = /^rgba?\(([^)]+)\)$/i
const FALLBACK_APPSHOT_BACKGROUND = '#ffffff'
const FALLBACK_APPSHOT_TEXT = '#111111'
const APPSHOT_IMAGE_ATTACHMENT_STEP = 88
const APPSHOT_ATTACHMENT_SLOT_WIDTH = 232
const APPSHOT_ATTACHMENT_SLOT_HEIGHT = 140
const APPSHOT_ANIMATION_TARGET_CORNER_RADIUS = 0
const APPSHOT_ATTACHMENT_SLOT_STEP = 240

function readFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function readPositiveNumber(value: unknown): number | null {
  const parsed = readFiniteNumber(value)
  return parsed != null && parsed > 0 ? parsed : null
}

function readHexPair(value: number): string {
  return Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0')
}

function readCssHexColor(value: string, fallback: string): string {
  const trimmed = value.trim()
  if (HEX_COLOR_RE.test(trimmed)) {
    return trimmed
  }

  const match = trimmed.match(RGB_COLOR_RE)
  if (!match) {
    return fallback
  }

  const channels = match[1]
    .split(',')
    .map(channel => Number.parseFloat(channel.trim()))

  if (channels.length < 3 || channels.slice(0, 3).some(channel => !Number.isFinite(channel))) {
    return fallback
  }
  if (channels.length >= 4 && Number.isFinite(channels[3]) && channels[3] <= 0) {
    return fallback
  }

  return `#${readHexPair(channels[0])}${readHexPair(channels[1])}${readHexPair(channels[2])}`
}

function readBrowserScreenRect(scaleFactor: number): { bounds: ComposerSlashCommandRect, workArea: ComposerSlashCommandRect } {
  const browserScreen = window.screen as Screen & {
    availLeft?: number
    availTop?: number
  }
  const originX = (readFiniteNumber(browserScreen.availLeft) ?? 0) * scaleFactor
  const originY = (readFiniteNumber(browserScreen.availTop) ?? 0) * scaleFactor
  const width = (readPositiveNumber(browserScreen.width) ?? readPositiveNumber(window.innerWidth) ?? 1) * scaleFactor
  const height = (readPositiveNumber(browserScreen.height) ?? readPositiveNumber(window.innerHeight) ?? 1) * scaleFactor
  const workAreaWidth = (readPositiveNumber(browserScreen.availWidth) ?? width / scaleFactor) * scaleFactor
  const workAreaHeight = (readPositiveNumber(browserScreen.availHeight) ?? height / scaleFactor) * scaleFactor

  return {
    bounds: { x: originX, y: originY, width, height },
    workArea: { x: originX, y: originY, width: workAreaWidth, height: workAreaHeight },
  }
}

function readAppshotDestinationFrame(
  targetElement: HTMLElement,
  scaleFactor: number,
  options: ComposerActionContextOptions = {},
): ComposerSlashCommandRect | null {
  const composerRect = targetElement.getBoundingClientRect()
  const composerStyle = window.getComputedStyle(targetElement)
  const attachmentsContainer = targetElement.querySelector<HTMLElement>('[data-composer-attachments-container]')
  const containerRect = attachmentsContainer?.getBoundingClientRect() ?? composerRect
  const containerStyle = attachmentsContainer ? window.getComputedStyle(attachmentsContainer) : composerStyle
  const attachmentsRow = targetElement.querySelector<HTMLElement>('[data-composer-attachments-row]')
  const pendingElement = options.pendingAppshotRequestId
    ? Array.from(targetElement.querySelectorAll<HTMLElement>('[data-pending-appshot-capture-request-id]'))
        .find(element => element.dataset.pendingAppshotCaptureRequestId === options.pendingAppshotRequestId) ?? null
    : null
  const rawPendingRect = pendingElement?.getBoundingClientRect() ?? null
  const pendingRect = rawPendingRect && (
    rawPendingRect.left !== 0
    || rawPendingRect.top !== 0
    || rawPendingRect.width > 0
    || rawPendingRect.height > 0
  )
    ? rawPendingRect
    : null
  const rowRect = attachmentsRow?.getBoundingClientRect() ?? null
  const scrollLeft = attachmentsRow?.scrollLeft ?? 0
  const pendingIds = Array.from(targetElement.querySelectorAll<HTMLElement>('[data-pending-appshot-capture-request-id]'))
    .map(element => element.dataset.pendingAppshotCaptureRequestId)
    .filter((requestId): requestId is string => Boolean(requestId))
  const pendingIndex = options.pendingAppshotRequestId
    ? Math.max(0, pendingIds.indexOf(options.pendingAppshotRequestId))
    : 0
  const imageAttachmentCount = targetElement.querySelectorAll('[data-chat-image-attachment-chip]').length
  const appshotContextCount = targetElement.querySelectorAll('[data-chat-appshot-card]').length
  const paddingLeft = readFiniteNumber(Number.parseFloat(containerStyle.paddingLeft)) ?? 0
  const paddingTop = readFiniteNumber(Number.parseFloat(containerStyle.paddingTop)) ?? 0
  const fallbackLeft = containerRect.left
    + paddingLeft
    - scrollLeft
    + imageAttachmentCount * APPSHOT_IMAGE_ATTACHMENT_STEP
    + appshotContextCount * APPSHOT_ATTACHMENT_SLOT_STEP
    + pendingIndex * APPSHOT_ATTACHMENT_SLOT_STEP
  const left = pendingRect?.left ?? fallbackLeft
  const rowTop = containerRect.top + paddingTop
  const targetHeight = APPSHOT_ATTACHMENT_SLOT_HEIGHT
  const transitionSnapshotHeight = readPositiveNumber(options.transitionSnapshotHeight)
    ?? targetHeight
  const targetWidth = APPSHOT_ATTACHMENT_SLOT_WIDTH
  const renderedCardHeight = transitionSnapshotHeight
  const fallbackTop = rowRect
    ? rowRect.bottom - renderedCardHeight
    : rowTop
  const pendingTop = pendingRect
    ? (pendingRect.height > 0 ? pendingRect.bottom - renderedCardHeight : fallbackTop)
    : null
  const targetTop = pendingTop ?? fallbackTop

  return {
    x: left * scaleFactor,
    y: targetTop * scaleFactor,
    width: targetWidth * scaleFactor,
    height: targetHeight * scaleFactor,
  }
}

export function readComposerActionContext(
  targetElement: HTMLElement | null,
  options: ComposerActionContextOptions = {},
): ComposerSlashCommandActionContext {
  if (!targetElement) {
    return {}
  }

  const rect = targetElement.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) {
    return {}
  }

  const computed = window.getComputedStyle(targetElement)
  const scaleFactor = Math.max(window.devicePixelRatio || 1, 1)
  const screenRect = readBrowserScreenRect(scaleFactor)
  const destinationFrame = readAppshotDestinationFrame(targetElement, scaleFactor, options)
  if (!destinationFrame) {
    return {}
  }
  return {
    animationTarget: {
      coordinateSpace: 'viewportPixels',
      codexDisplay: {
        id: 0,
        scaleFactor,
        bounds: screenRect.bounds,
        workArea: screenRect.workArea,
      },
      destinationBackgroundColor: readCssHexColor(computed.backgroundColor, FALLBACK_APPSHOT_BACKGROUND),
      destinationCornerRadius: APPSHOT_ANIMATION_TARGET_CORNER_RADIUS,
      destinationFrame,
      destinationPrimaryTextColor: readCssHexColor(computed.color, FALLBACK_APPSHOT_TEXT),
      transitionSnapshotScale: scaleFactor,
    },
  }
}
