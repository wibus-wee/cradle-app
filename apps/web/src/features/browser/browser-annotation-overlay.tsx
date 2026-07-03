import type { FileUIPart } from 'ai'
import {
  ArrowUpLine as ArrowUpIcon,
  CheckLine as CheckIcon,
  RightSmallLine as ChevronRightIcon,
  PicLine as ImagePlusIcon,
  FullscreenLine as Maximize2Icon,
  PlusLine as PlusIcon,
  CloseLine as XIcon
} from '@mingcute/react'
import type {
  ChangeEvent,
  ClipboardEvent as ReactClipboardEvent,
  DragEvent as ReactDragEvent,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from 'react'
import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react'

import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Textarea } from '~/components/ui/textarea'
import { cn } from '~/lib/cn'
import type {
  BrowserAnnotationAnchor,
  BrowserAnnotationDesignChange,
  BrowserAnnotationElement,
  BrowserAnnotationRecord,
  BrowserAnnotationRegion,
} from '~/store/browser-panel'
import { useBrowserPanelStore } from '~/store/browser-panel'
import { useLayoutStore } from '~/store/layout'

export interface BrowserAnnotationSurfaceSize {
  width: number
  height: number
}

interface BrowserAnnotationOverlayProps {
  ownerId: string
  tabId: string
  imageDataUrl: string
  elements: BrowserAnnotationElement[]
  surfaceSize: BrowserAnnotationSurfaceSize
  submitting: boolean
  initialAnnotation?: BrowserAnnotationRecord | null
  onCancel: () => void
  onSave: (input: BrowserAnnotationOverlaySubmitInput) => void
  onSubmit: (input: BrowserAnnotationOverlaySubmitInput) => void
}

export interface BrowserAnnotationOverlaySubmitInput {
  body: string
  anchor: BrowserAnnotationAnchor
  attachedImages: FileUIPart[]
  designChange: BrowserAnnotationDesignChange | null
}

interface DragState {
  startX: number
  startY: number
  currentX: number
  currentY: number
}

interface EditorDragState {
  startClientX: number
  startClientY: number
  startLeft: number
  startTop: number
}

interface BrowserAnnotationAttachedImage {
  id: string
  filePart: FileUIPart
}

const MIN_REGION_SIZE = 12
const PANEL_WIDTH = 280
const PANEL_MIN_VISIBLE = 72
const POPUP_ENTER_MS = 200
const POPUP_EXIT_MS = 150
const POPUP_FOCUS_DELAY_MS = 50
const POPUP_SHAKE_MS = 250
let nextAttachedImageId = 0

type PopupAnimationState = 'initial' | 'enter' | 'entered' | 'exit'

const POPUP_COMPUTED_STYLE_FIELDS: ReadonlyArray<{
  key: keyof BrowserAnnotationElement['styles']
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function buildRegion(drag: DragState): BrowserAnnotationRegion {
  const x = Math.min(drag.startX, drag.currentX)
  const y = Math.min(drag.startY, drag.currentY)
  return {
    kind: 'region',
    x,
    y,
    width: Math.abs(drag.currentX - drag.startX),
    height: Math.abs(drag.currentY - drag.startY),
  }
}

function anchorSummary(anchor: BrowserAnnotationAnchor | null): string {
  if (!anchor) {
    return 'Click an element or drag a region'
  }
  if (anchor.kind === 'point') {
    return `Point at ${Math.round(anchor.x)}, ${Math.round(anchor.y)}`
  }
  if (anchor.kind === 'element') {
    return `<${anchor.element.tagName.toLowerCase()}> ${anchor.element.label || anchor.element.role}`
  }
  if (anchor.kind === 'text') {
    return `Text "${anchor.text.slice(0, 80)}${anchor.text.length > 80 ? '...' : ''}"`
  }
  return `Region ${Math.round(anchor.width)} x ${Math.round(anchor.height)}`
}

function anchorTokenLabel(anchor: BrowserAnnotationAnchor | null): string {
  if (!anchor) {
    return 'Selection'
  }
  if (anchor.kind === 'point') {
    return 'Point'
  }
  if (anchor.kind === 'region') {
    return 'Area selection'
  }
  if (anchor.kind === 'text') {
    return 'Text selection'
  }
  return `<${anchor.element.tagName.toLowerCase()}> ${anchor.element.label || anchor.element.role || anchor.element.selector}`
}

function computedStyleRows(element: BrowserAnnotationElement) {
  return POPUP_COMPUTED_STYLE_FIELDS
    .map(({ key, property }) => ({
      property,
      value: element.styles[key],
    }))
    .filter((row) => {
      return typeof row.value === 'string'
        && row.value.trim().length > 0
        && row.value !== 'rgba(0, 0, 0, 0)'
    })
}

function editorPosition(anchor: BrowserAnnotationAnchor | null, surface: BrowserAnnotationSurfaceSize) {
  const fallback = {
    left: Math.max(12, surface.width - PANEL_WIDTH - 12),
    top: Math.max(12, surface.height - 180 - 12),
  }
  if (!anchor) {
    return fallback
  }

  const anchorRight = anchor.kind === 'region'
    ? anchor.x + anchor.width
    : anchor.kind === 'element'
      ? anchor.element.rect.x + anchor.element.rect.width
      : anchor.x
  const anchorBottom = anchor.kind === 'region'
    ? anchor.y + anchor.height
    : anchor.kind === 'element'
      ? anchor.element.rect.y + anchor.element.rect.height
      : anchor.y
  return {
    left: clamp(anchorRight + 12, 12, Math.max(12, surface.width - PANEL_WIDTH - 12)),
    top: clamp(anchorBottom + 12, 12, Math.max(12, surface.height - 300 - 12)),
  }
}

function elementAtPoint(
  elements: BrowserAnnotationElement[],
  point: { x: number, y: number },
): BrowserAnnotationElement | null {
  let best: BrowserAnnotationElement | null = null
  let bestArea = Number.POSITIVE_INFINITY
  for (const element of elements) {
    const rect = element.rect
    if (
      point.x < rect.x
      || point.y < rect.y
      || point.x > rect.x + rect.width
      || point.y > rect.y + rect.height
    ) {
      continue
    }
    const area = rect.width * rect.height
    if (area < bestArea) {
      best = element
      bestArea = area
    }
  }
  return best
}

function initialAttachedImageId(filePart: FileUIPart, index: number): string {
  const label = filePart.filename ?? filePart.mediaType ?? 'file'
  return `browser-annotation-image-initial-${index}-${label}`
}

function readImageFilePart(file: File): Promise<BrowserAnnotationAttachedImage | null> {
  if (!file.type.startsWith('image/')) {
    return Promise.resolve(null)
  }

  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        resolve(null)
        return
      }
      resolve({
        id: `browser-annotation-image-${nextAttachedImageId++}`,
        filePart: {
          type: 'file',
          filename: file.name,
          mediaType: file.type,
          url: reader.result,
        },
      })
    }
    reader.onerror = () => resolve(null)
    reader.readAsDataURL(file)
  })
}

function hasDesignChanges(designChange: BrowserAnnotationDesignChange | null): boolean {
  return designChange !== null
    && Object.values(designChange).some(value => typeof value === 'string' && value.trim())
}

function focusBypassingTraps(element: HTMLElement | null) {
  if (!element) {
    return
  }
  const trap = (event: Event) => event.stopImmediatePropagation()
  document.addEventListener('focusin', trap, true)
  document.addEventListener('focusout', trap, true)
  try {
    element.focus()
  }
  finally {
    document.removeEventListener('focusin', trap, true)
    document.removeEventListener('focusout', trap, true)
  }
}

export function BrowserAnnotationOverlay({
  ownerId,
  tabId,
  imageDataUrl,
  elements,
  surfaceSize,
  submitting,
  initialAnnotation = null,
  onCancel,
  onSave,
  onSubmit,
}: BrowserAnnotationOverlayProps) {
  const surfaceRef = useRef<HTMLDivElement | null>(null)
  const imageInputRef = useRef<HTMLInputElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const previewDialogRef = useRef<HTMLDialogElement | null>(null)
  const cancelTimerRef = useRef<number | null>(null)
  const shakeTimerRef = useRef<number | null>(null)
  const setAnnotationAdjustmentSession = useBrowserPanelStore(state => state.setAnnotationAdjustmentSession)
  const openAsideTab = useLayoutStore(state => state.openAsideTab)
  const setAsideOpen = useLayoutStore(state => state.setAsideOpen)

  const [anchor, setAnchor] = useState<BrowserAnnotationAnchor | null>(
    () => initialAnnotation?.anchor ?? null,
  )
  const [draft, setDraft] = useState(() => initialAnnotation?.body ?? '')
  const [attachedImages, setAttachedImages] = useState<BrowserAnnotationAttachedImage[]>(
    () =>
      initialAnnotation?.attachedImages.map((filePart, index) => ({
        id: initialAttachedImageId(filePart, index),
        filePart,
      })) ?? [],
  )
  const [drag, setDrag] = useState<DragState | null>(null)
  const [isDraggingImages, setIsDraggingImages] = useState(false)
  const [editorOverride, setEditorOverride] = useState<{ left: number, top: number } | null>(null)
  const [editorDrag, setEditorDrag] = useState<EditorDragState | null>(null)
  const [hoveredElement, setHoveredElement] = useState<BrowserAnnotationElement | null>(null)
  const [previewImage, setPreviewImage] = useState<BrowserAnnotationAttachedImage | null>(null)
  const [popupAnimationState, setPopupAnimationState] = useState<PopupAnimationState>('initial')
  const [isShaking, setIsShaking] = useState(false)
  const [isStylesExpanded, setIsStylesExpanded] = useState(false)
  const [popupAnchor, setPopupAnchor] = useState(anchor)

  if (anchor !== popupAnchor) {
    setPopupAnchor(anchor)
    if (anchor) {
      setIsShaking(false)
      setPopupAnimationState('initial')
    }
  }

  const visibleRegion = drag ? buildRegion(drag) : anchor?.kind === 'region' ? anchor : null
  const selectedElement = anchor?.kind === 'element' ? anchor.element : null
  const adjustmentSession = useBrowserPanelStore(state => state.annotationAdjustmentSession)
  const activeDesignChange = adjustmentSession?.ownerId === ownerId
    && adjustmentSession.tabId === tabId
    && selectedElement
    && adjustmentSession.selectedElement?.selector === selectedElement.selector
    ? adjustmentSession.designChanges
    : null
  const framedElement = selectedElement ?? hoveredElement
  const anchoredEditor = editorPosition(anchor, surfaceSize)
  const editor = editorOverride ?? anchoredEditor
  const styleRows = selectedElement ? computedStyleRows(selectedElement) : []

  const readSurfacePoint = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = surfaceRef.current?.getBoundingClientRect()
    if (!rect) {
      return null
    }
    return {
      x: clamp(event.clientX - rect.left, 0, rect.width),
      y: clamp(event.clientY - rect.top, 0, rect.height),
    }
  }

  const clearOwnedAdjustmentSession = useCallback(() => {
    const currentSession = useBrowserPanelStore.getState().annotationAdjustmentSession
    if (
      currentSession?.ownerId === ownerId
      && currentSession.tabId === tabId
      && currentSession.annotationId === (initialAnnotation?.id ?? null)
    ) {
      setAnnotationAdjustmentSession(null)
    }
  }, [initialAnnotation?.id, ownerId, setAnnotationAdjustmentSession, tabId])

  const focusTextarea = useCallback(() => {
    const textarea = textareaRef.current
    focusBypassingTraps(textarea)
    if (textarea) {
      textarea.selectionStart = textarea.selectionEnd = textarea.value.length
      textarea.scrollTop = textarea.scrollHeight
    }
  }, [])

  const shakeEditor = useCallback(() => {
    if (shakeTimerRef.current !== null) {
      window.clearTimeout(shakeTimerRef.current)
    }
    setIsShaking(true)
    shakeTimerRef.current = window.setTimeout(() => {
      setIsShaking(false)
      focusTextarea()
    }, POPUP_SHAKE_MS)
  }, [focusTextarea])

  const cancelWithExit = useCallback(() => {
    if (cancelTimerRef.current !== null) {
      return
    }
    setPopupAnimationState('exit')
    cancelTimerRef.current = window.setTimeout(() => {
      onCancel()
    }, POPUP_EXIT_MS)
  }, [onCancel])

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!event.isPrimary || event.button !== 0) {
      return
    }
    if (anchor) {
      event.preventDefault()
      shakeEditor()
      return
    }
    const point = readSurfacePoint(event)
    if (!point) {
      return
    }
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    setDrag({
      startX: point.x,
      startY: point.y,
      currentX: point.x,
      currentY: point.y,
    })
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const point = readSurfacePoint(event)
    if (!point) {
      return
    }
    if (!drag) {
      setHoveredElement(elementAtPoint(elements, point))
      return
    }
    event.preventDefault()
    setDrag({
      ...drag,
      currentX: point.x,
      currentY: point.y,
    })
  }

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag) {
      return
    }
    event.preventDefault()
    event.currentTarget.releasePointerCapture(event.pointerId)
    const region = buildRegion(drag)
    if (region.width >= MIN_REGION_SIZE && region.height >= MIN_REGION_SIZE) {
      setAnchor(region)
      clearOwnedAdjustmentSession()
      setEditorOverride(null)
    }
    else {
      const element = elementAtPoint(elements, { x: drag.startX, y: drag.startY })
      setAnchor(element
        ? { kind: 'element', element }
        : {
            kind: 'point',
            x: drag.startX,
            y: drag.startY,
          })
      if (element) {
        setAnnotationAdjustmentSession({
          ownerId,
          tabId,
          annotationId: null,
          selectedElement: element,
          designChanges: {},
        })
        openAsideTab('adjustment')
        setAsideOpen(true)
      }
      else {
        clearOwnedAdjustmentSession()
      }
      setEditorOverride(null)
    }
    setDrag(null)
  }

  const handleEditorPointerMove = (event: ReactPointerEvent<HTMLFormElement>) => {
    if (!editorDrag) {
      return
    }
    event.preventDefault()
    const nextLeft = editorDrag.startLeft + event.clientX - editorDrag.startClientX
    const nextTop = editorDrag.startTop + event.clientY - editorDrag.startClientY
    setEditorOverride({
      left: clamp(nextLeft, 8, Math.max(8, surfaceSize.width - PANEL_MIN_VISIBLE)),
      top: clamp(nextTop, 8, Math.max(8, surfaceSize.height - PANEL_MIN_VISIBLE)),
    })
  }

  const handleEditorPointerUp = (event: ReactPointerEvent<HTMLFormElement>) => {
    if (!editorDrag) {
      return
    }
    event.preventDefault()
    event.currentTarget.releasePointerCapture(event.pointerId)
    setEditorDrag(null)
  }

  const canSubmit = Boolean(anchor)
    && (draft.trim().length > 0 || attachedImages.length > 0 || hasDesignChanges(activeDesignChange))
    && !submitting
  const buildSubmitInput = useCallback((): BrowserAnnotationOverlaySubmitInput | null => {
    if (!anchor || !canSubmit) {
      return null
    }
    return {
      body: draft.trim(),
      anchor,
      attachedImages: attachedImages.map(image => image.filePart),
      designChange: activeDesignChange,
    }
  }, [activeDesignChange, anchor, attachedImages, canSubmit, draft])

  const handleTextareaKeyDown = useCallback((event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    event.stopPropagation()
    if (event.nativeEvent.isComposing) {
      return
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      const input = buildSubmitInput()
      if (!input) {
        shakeEditor()
        return
      }
      onSubmit(input)
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      cancelWithExit()
    }
  }, [buildSubmitInput, cancelWithExit, onSubmit, shakeEditor])

  const appendImageFiles = async (files: File[]) => {
    if (files.length === 0) {
      return
    }
    const nextImages = (await Promise.all(files.map(readImageFilePart)))
      .filter((image): image is BrowserAnnotationAttachedImage => image !== null)
    if (nextImages.length === 0) {
      return
    }
    setAttachedImages(previous => [...previous, ...nextImages])
  }

  const handleImagesSelected = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    await appendImageFiles(files)
  }

  const handlePaste = (event: ReactClipboardEvent<HTMLFormElement>) => {
    const files = Array.from(event.clipboardData.files).filter(file => file.type.startsWith('image/'))
    if (files.length === 0) {
      return
    }
    event.preventDefault()
    void appendImageFiles(files)
  }

  const handleDrag = (event: ReactDragEvent<HTMLFormElement>) => {
    const hasImages = Array.from(event.dataTransfer.items)
      .some(item => item.kind === 'file' && item.type.startsWith('image/'))
    if (!hasImages) {
      return false
    }
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'copy'
    return true
  }

  const handleOverlayShortcut = useEffectEvent((event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      cancelWithExit()
      return
    }
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault()
      const input = buildSubmitInput()
      if (!input) {
        shakeEditor()
        return
      }
      onSubmit(input)
    }
  })

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      handleOverlayShortcut(event)
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [])

  useEffect(() => {
    if (!anchor) {
      return
    }
    if (cancelTimerRef.current !== null) {
      window.clearTimeout(cancelTimerRef.current)
      cancelTimerRef.current = null
    }
    const enterTimer = window.setTimeout(() => {
      setPopupAnimationState('enter')
    }, 0)
    const enteredTimer = window.setTimeout(() => {
      setPopupAnimationState('entered')
    }, POPUP_ENTER_MS)
    const focusTimer = window.setTimeout(focusTextarea, POPUP_FOCUS_DELAY_MS)
    return () => {
      window.clearTimeout(enterTimer)
      window.clearTimeout(enteredTimer)
      window.clearTimeout(focusTimer)
    }
  }, [anchor, focusTextarea])

  useEffect(() => {
    return () => {
      if (cancelTimerRef.current !== null) {
        window.clearTimeout(cancelTimerRef.current)
      }
      if (shakeTimerRef.current !== null) {
        window.clearTimeout(shakeTimerRef.current)
      }
      clearOwnedAdjustmentSession()
    }
  }, [clearOwnedAdjustmentSession])

  useEffect(() => {
    const dialog = previewDialogRef.current
    if (!previewImage || !dialog || dialog.open) {
      return
    }
    dialog.showModal()
  }, [previewImage])

  return (
    <div
      className="absolute inset-0 z-30 overflow-hidden bg-background"
      data-testid="browser-annotation-overlay"
    >
      <img
        src={imageDataUrl}
        alt=""
        aria-hidden="true"
        className="absolute inset-0 size-full select-none object-fill"
        draggable={false}
      />
      <div
        ref={surfaceRef}
        className="absolute inset-0 cursor-crosshair touch-none"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={() => setDrag(null)}
      >
        {framedElement && (
          <span
            className={cn(
              'pointer-events-none absolute rounded border-2 bg-primary/10 transition-[left,top,width,height,border-color] duration-200 ease-out',
              selectedElement ? 'border-primary' : 'border-primary/70',
            )}
            data-testid="browser-annotation-selected-frame"
            style={{
              left: framedElement.rect.x,
              top: framedElement.rect.y,
              width: framedElement.rect.width,
              height: framedElement.rect.height,
            }}
            aria-hidden="true"
          />
        )}
        {anchor?.kind === 'point' && (
          <span
            className="pointer-events-none absolute flex size-[22px] -translate-x-1/2 -translate-y-1/2 animate-[browser-annotation-marker-in_250ms_cubic-bezier(0.22,1,0.36,1)_both] items-center justify-center rounded-full bg-primary text-primary-foreground text-[11px] font-semibold shadow-[0_2px_6px_rgba(0,0,0,0.20),inset_0_0_0_1px_rgba(0,0,0,0.04)] transition-[left,top,transform] duration-150 ease-out motion-reduce:animate-none"
            style={{ left: anchor.x, top: anchor.y }}
            aria-hidden="true"
          >
            <PlusIcon className="size-3" />
          </span>
        )}
        {visibleRegion && (
          <span
            className="pointer-events-none absolute rounded border-2 border-primary bg-primary/10 transition-[left,top,width,height] duration-200 ease-out"
            style={{
              left: visibleRegion.x,
              top: visibleRegion.y,
              width: visibleRegion.width,
              height: visibleRegion.height,
            }}
            aria-hidden="true"
          />
        )}
      </div>

      {anchor && (
        <form
          className={cn(
            'absolute w-[280px] origin-top-left rounded-2xl bg-popover/95 p-3.5 text-popover-foreground opacity-0 shadow-[0_4px_24px_rgba(0,0,0,0.18),0_0_0_1px_rgba(0,0,0,0.06)] backdrop-blur-md dark:bg-[#1a1a1a]/95 dark:shadow-[0_4px_24px_rgba(0,0,0,0.34),0_0_0_1px_rgba(255,255,255,0.08)]',
            'motion-reduce:animate-none motion-reduce:opacity-100',
            popupAnimationState === 'enter'
            && 'animate-[browser-annotation-popup-enter_200ms_cubic-bezier(0.34,1.56,0.64,1)_forwards]',
            popupAnimationState === 'entered' && 'opacity-100',
            popupAnimationState === 'exit'
            && 'animate-[browser-annotation-popup-exit_150ms_ease-in_forwards]',
            popupAnimationState === 'entered' && isShaking
            && 'animate-[browser-annotation-popup-shake_250ms_ease-out]',
          )}
          data-testid="browser-annotation-editor"
          style={{ left: editor.left, top: editor.top }}
          onPointerMove={handleEditorPointerMove}
          onPointerUp={handleEditorPointerUp}
          onPointerCancel={() => setEditorDrag(null)}
          onPaste={handlePaste}
          onDragEnter={(event) => {
            if (handleDrag(event)) {
              setIsDraggingImages(true)
            }
          }}
          onDragOver={handleDrag}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
              setIsDraggingImages(false)
            }
          }}
          onDrop={(event) => {
            if (!handleDrag(event)) {
              return
            }
            setIsDraggingImages(false)
            void appendImageFiles(Array.from(event.dataTransfer.files))
          }}
          onSubmit={(event) => {
            event.preventDefault()
            const input = buildSubmitInput()
            if (!input) {
              shakeEditor()
              return
            }
            onSubmit(input)
          }}
        >
          {isDraggingImages && (
            <div className="pointer-events-none absolute inset-2 z-10 flex items-center justify-center rounded-md bg-primary/10 text-xs font-medium text-primary ring-1 ring-primary/30 backdrop-blur-sm">
              Drop images to attach
            </div>
          )}
          <div
            className="mb-2 flex cursor-grab items-start justify-between gap-2 active:cursor-grabbing"
            onPointerDown={(event) => {
              if (!event.isPrimary || event.button !== 0) {
                return
              }
              if (event.target instanceof Element && event.target.closest('button,input,textarea,label')) {
                return
              }
              const form = event.currentTarget.closest('form')
              if (!form) {
                return
              }
              event.preventDefault()
              form.setPointerCapture(event.pointerId)
              setEditorDrag({
                startClientX: event.clientX,
                startClientY: event.clientY,
                startLeft: editor.left,
                startTop: editor.top,
              })
            }}
          >
            {selectedElement && styleRows.length > 0
              ? (
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-auto min-w-0 !shrink flex-1 justify-start gap-1.5 px-0 py-0 text-left text-xs leading-5 text-muted-foreground hover:bg-transparent hover:text-foreground"
                    onClick={() => setIsStylesExpanded(expanded => !expanded)}
                    aria-expanded={isStylesExpanded}
                  >
                    <ChevronRightIcon
                      className={cn(
                        'mt-0.5 size-3.5 shrink-0 transition-[transform] duration-250 ease-[cubic-bezier(0.16,1,0.3,1)]',
                        isStylesExpanded && 'rotate-90',
                      )}
                      aria-hidden="true"
                    />
                    <span className="shrink-0">Add more detail to</span>
                    <span className="inline-flex min-w-0 max-w-[104px] items-center rounded-full bg-primary px-1.5 py-0.5 text-[11px] font-medium text-primary-foreground">
                      <span className="truncate">
                        {anchorTokenLabel(anchor)}
                      </span>
                    </span>
                  </Button>
                )
              : (
                  <div className="flex min-w-0 flex-1 items-baseline gap-1.5 text-xs leading-5 text-muted-foreground">
                    <span className="shrink-0">Add more detail to</span>
                    <span className="inline-flex min-w-0 max-w-[126px] items-center rounded-full bg-primary px-1.5 py-0.5 text-[11px] font-medium text-primary-foreground">
                      <span className="truncate">
                        {anchorTokenLabel(anchor)}
                      </span>
                    </span>
                  </div>
                )}
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="-mr-1 text-muted-foreground"
              onClick={cancelWithExit}
              aria-label="Close"
            >
              <XIcon className="size-3.5" />
            </Button>
          </div>
          {selectedElement && styleRows.length > 0 && (
            <div
              className={cn(
                'grid transition-[grid-template-rows] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]',
                isStylesExpanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
              )}
            >
              <div className="overflow-hidden">
                <div className="mb-2 rounded-md bg-white/[0.05] px-2.5 py-2 font-mono text-[11px] leading-5 text-foreground/85 dark:bg-white/[0.05]">
                  {styleRows.map(row => (
                    <div key={row.property} className="break-words">
                      <span className="text-primary">
                        {row.property}
                      </span>
                      <span className="text-muted-foreground">
                        :
                      </span>
                      {' '}
                      <span>
                        {row.value}
                      </span>
                      <span className="text-muted-foreground">
                        ;
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
          <Textarea
            ref={textareaRef}
            value={draft}
            onChange={event => setDraft(event.target.value)}
            placeholder="What should change?"
            rows={2}
            className="min-h-16 resize-none rounded-lg bg-background/70 text-sm shadow-none transition-[border-color,box-shadow] duration-150 focus-visible:ring-primary/45 dark:bg-white/5"
            onKeyDown={handleTextareaKeyDown}
          />
          {attachedImages.length > 0 && (
            <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
              {attachedImages.map((image) => {
                const label = image.filePart.filename ?? image.filePart.mediaType
                return (
                  <div
                    key={image.id}
                    className="group relative size-14 shrink-0 overflow-hidden rounded-md bg-muted shadow-[inset_0_0_0_1px_rgba(0,0,0,0.10)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.10)]"
                  >
                    <Button
                      type="button"
                      variant="ghost"
                      className="size-full rounded-none p-0 text-left hover:bg-transparent"
                      onClick={() => setPreviewImage(image)}
                      aria-label={`Preview ${label}`}
                    >
                      <img src={image.filePart.url} alt={label} className="size-full object-cover" />
                    </Button>
                    <span className="pointer-events-none absolute bottom-1 left-1 flex size-5 items-center justify-center rounded-sm bg-background/90 text-muted-foreground opacity-0 shadow-sm transition-opacity group-hover:opacity-100">
                      <Maximize2Icon className="size-3" />
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      className="absolute right-1 top-1 size-5 rounded-sm bg-background/90 text-muted-foreground opacity-0 shadow-sm transition-opacity hover:bg-background/90 hover:text-foreground group-hover:opacity-100"
                      onClick={(event) => {
                        event.stopPropagation()
                        setAttachedImages(previous => previous.filter(item => item.id !== image.id))
                      }}
                      aria-label={`Remove ${label}`}
                    >
                      <XIcon className="size-3" />
                    </Button>
                  </div>
                )
              })}
            </div>
          )}
          <div className="mt-2 flex items-center gap-1.5">
            <Input
              ref={imageInputRef}
              type="file"
              aria-label="Attached images"
              accept="image/*"
              multiple
              className="hidden"
              onChange={handleImagesSelected}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 min-w-7 rounded-full px-2 text-[11px] text-muted-foreground transition-[background-color,color,scale] duration-150 ease-out active:scale-[0.96]"
              onClick={() => imageInputRef.current?.click()}
              aria-label="Attach images"
              title={anchorSummary(anchor)}
            >
              <ImagePlusIcon className="size-3.5" />
              Attach
            </Button>
            <span className="min-w-0 flex-1 truncate text-[11px] leading-4 text-muted-foreground/70">
              {attachedImages.length === 0
                ? 'No files'
                : `${attachedImages.length} file${attachedImages.length === 1 ? '' : 's'}`}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 rounded-full bg-foreground/6 px-2.5 text-[11px] text-muted-foreground transition-[background-color,color,scale] duration-150 ease-out hover:bg-foreground/10 active:scale-[0.96]"
              onClick={cancelWithExit}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 rounded-full bg-foreground/6 px-2.5 text-[11px] text-muted-foreground transition-[background-color,color,scale] duration-150 ease-out hover:bg-foreground/10 active:scale-[0.96]"
              disabled={!canSubmit}
              onClick={() => {
                const input = buildSubmitInput()
                if (input) {
                  onSave(input)
                  return
                }
                shakeEditor()
              }}
            >
              Save
            </Button>
            <Button
              type="submit"
              size="icon-sm"
              disabled={!canSubmit}
              className="ml-auto size-7 rounded-full bg-primary p-0 text-primary-foreground shadow-none transition-[background-color,color,scale,opacity] duration-150 ease-out hover:bg-primary/90 active:scale-[0.96]"
              aria-label={submitting ? 'Sending browser annotation' : 'Send browser annotation'}
            >
              {submitting
                ? <CheckIcon className="size-3.5 animate-pulse motion-reduce:animate-none" />
                : <ArrowUpIcon className="size-4" />}
            </Button>
          </div>
        </form>
      )}

      <Button
        type="button"
        variant="ghost"
        className={cn(
          'absolute bottom-3 left-3 h-auto rounded-md bg-background/90 px-2.5 py-1.5 text-xs text-muted-foreground shadow-lg ring-1 ring-border/70 backdrop-blur',
          'hover:bg-background hover:text-foreground',
        )}
        onClick={cancelWithExit}
      >
        Exit annotate
      </Button>
      {previewImage && (
        <dialog
          ref={previewDialogRef}
          className="fixed inset-0 z-40 m-0 h-dvh max-h-none w-dvw max-w-none border-0 bg-transparent p-0 backdrop:bg-black/70"
          aria-label={`Preview ${previewImage.filePart.filename ?? previewImage.filePart.mediaType}`}
          onCancel={() => setPreviewImage(null)}
        >
          <div className="relative flex h-full w-full items-center justify-center p-6">
            <Button
              type="button"
              variant="ghost"
              className="absolute inset-0 h-auto w-auto cursor-default rounded-none p-0 hover:bg-transparent"
              onClick={() => setPreviewImage(null)}
              aria-label="Close image preview"
            />
            <div className="relative max-h-full max-w-full">
            <img
              src={previewImage.filePart.url}
              alt={previewImage.filePart.filename ?? 'Attached image'}
              className="max-h-[calc(100vh-96px)] max-w-[calc(100vw-96px)] rounded-lg object-contain shadow-2xl ring-1 ring-white/20"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute right-2 top-2 size-8 rounded-md bg-background/90 text-muted-foreground shadow-sm hover:bg-background/90 hover:text-foreground"
              onClick={() => setPreviewImage(null)}
              aria-label="Close image preview"
            >
              <XIcon className="size-4" />
            </Button>
            </div>
          </div>
        </dialog>
      )}
    </div>
  )
}
