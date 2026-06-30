import type { FileUIPart } from 'ai'
import { useCallback, useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'

import { toastManager } from '~/components/ui/toast'
import type { MacAppshotCaptureResponse, MacAppshotHotkeyEvent } from '~/lib/electron'
import { nativeIpc } from '~/lib/electron'

import { createCradleAppshotFilePart } from './appshot-attachment-model'
import type { ComposerSlashCommandActionTools } from './composer-action-context'
import { readComposerActionContext } from './composer-action-context'
import type { PendingAppshotAttachment } from './composer-attachments'

export interface ComposerAppshotRuntime {
  hasNativeCapture: boolean
  pendingAppshots: PendingAppshotAttachment[]
  externalFileParts: FileUIPart[]
  externalFilePartsKey: number
  setActionTargetElement: (element: HTMLDivElement | null) => void
  appendFileParts: (fileParts: FileUIPart[]) => void
  capture: (options?: ComposerAppshotCaptureOptions) => Promise<void>
}

interface UseComposerAppshotCaptureOptions {
  active: boolean
  supportsAttachments: boolean
}

interface ComposerAppshotCaptureOptions {
  bundleIdentifier?: string
  targetWindow?: MacAppshotHotkeyEvent['targetWindow']
  tools?: ComposerSlashCommandActionTools
}

interface AppshotCaptureInstance {
  id: number
  active: boolean
  supportsAttachments: boolean
  capture: ComposerAppshotRuntime['capture'] | null
  activationOrder: number
}

const APPSHOT_CAPTURE_ANIMATION_DURATION = 0.88
const APPSHOT_NATIVE_HANDOFF_DELAY = 0
const APPSHOT_ATTACHMENT_SLOT_HEIGHT = 140
const PATH_SEGMENT_RE = /[\\/]/

let nextAppshotCaptureInstanceId = 1
let nextAppshotCaptureActivationOrder = 1
let appshotHotkeyUnsubscribe: (() => void) | null = null

const appshotCaptureInstances = new Map<number, AppshotCaptureInstance>()

function createAppshotCaptureActivationOrder(): number {
  return nextAppshotCaptureActivationOrder++
}

function updateAppshotCaptureInstance(
  id: number,
  update: (instance: AppshotCaptureInstance) => void,
) {
  const instance = appshotCaptureInstances.get(id)
  if (!instance) {
    return
  }
  update(instance)
}

function readAppshotHotkeyTarget(): AppshotCaptureInstance | null {
  let target: AppshotCaptureInstance | null = null
  for (const instance of appshotCaptureInstances.values()) {
    if (!instance.active || !instance.supportsAttachments || !instance.capture) {
      continue
    }
    if (
      !target
      || instance.activationOrder > target.activationOrder
      || (instance.activationOrder === target.activationOrder && instance.id > target.id)
    ) {
      target = instance
    }
  }
  return target
}

function handleAppshotHotkey(payload: unknown) {
  const target = readAppshotHotkeyTarget()
  if (!target || !nativeIpc) {
    console.warn('[appshot] hotkey capture skipped:', {
      hasActiveCaptureTarget: Boolean(target),
      hasNativeIpc: Boolean(nativeIpc),
      registeredCaptureTargets: appshotCaptureInstances.size,
    })
    return
  }

  const event = payload as MacAppshotHotkeyEvent | undefined
  void (async () => {
    try {
      const targetWindow = event?.targetWindow
      if (targetWindow) {
        await nativeIpc.window.focusCurrent()
      }
      await target.capture?.({
        targetWindow,
        bundleIdentifier: event?.bundleIdentifier ?? event?.context?.bundleIdentifier ?? undefined,
      })
    }
    catch (error) {
      toastManager.add({
        type: 'error',
        title: 'Appshot capture failed',
        description: error instanceof Error ? error.message : 'Unknown Appshot capture error.',
      })
    }
  })()
}

function ensureAppshotHotkeyListener() {
  if (appshotHotkeyUnsubscribe) {
    return
  }
  appshotHotkeyUnsubscribe = window.cradle?.ipc.on('capture:appshot-hotkey', handleAppshotHotkey) ?? null
}

function releaseAppshotHotkeyListenerIfIdle() {
  if (appshotCaptureInstances.size > 0) {
    return
  }
  appshotHotkeyUnsubscribe?.()
  appshotHotkeyUnsubscribe = null
}

function readAppshotCaptureAsset(response: MacAppshotCaptureResponse) {
  return response.asset
}

function readFileNameFromPath(path: string, fallback: string): string {
  return path.split(PATH_SEGMENT_RE).filter(Boolean).at(-1) ?? fallback
}

function createAppshotRequestId(): string {
  return `cradle-appshot-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function createPendingAppshot(requestId: string): PendingAppshotAttachment {
  return {
    requestId,
    transitionSnapshotHeight: null,
    transitionSnapshotHeightResolved: false,
    transitionSpringDampingFraction: null,
    transitionSpringResponse: null,
  }
}

function serializeDomRect(rect: DOMRect | null | undefined) {
  if (!rect) {
    return null
  }
  return {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    left: rect.left,
  }
}

function readPositiveMetric(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

function readAppshotTransitionMetrics(
  response: MacAppshotCaptureResponse,
  _transitionSnapshotScale: number | undefined,
): Omit<PendingAppshotAttachment, 'requestId'> {
  return {
    transitionSnapshotHeight: readPositiveMetric(response.capture.appshot.transitionSnapshotHeight),
    transitionSnapshotHeightResolved: true,
    transitionSpringDampingFraction: readPositiveMetric(response.capture.appshot.transitionSpringDampingFraction),
    transitionSpringResponse: readPositiveMetric(response.capture.appshot.transitionSpringResponse),
  }
}

function readAppshotAnimationDuration(response: MacAppshotCaptureResponse): number {
  return readPositiveMetric(response.capture.appshot.animationDuration) ?? APPSHOT_CAPTURE_ANIMATION_DURATION
}

function waitForAppshotAnimation(response: MacAppshotCaptureResponse): Promise<void> {
  return new Promise(resolve => window.setTimeout(
    resolve,
    (readAppshotAnimationDuration(response) + APPSHOT_NATIVE_HANDOFF_DELAY) * 1000,
  ))
}

async function decodeImageDataUrl(dataUrl: string | null | undefined): Promise<void> {
  if (!dataUrl) {
    return
  }
  await new Promise<void>((resolve) => {
    const image = new Image()
    image.decoding = 'sync'
    image.onload = () => {
      const decode = image.decode?.()
      if (!decode) {
        resolve()
        return
      }
      decode.then(resolve, resolve)
    }
    image.onerror = () => resolve()
    image.src = dataUrl
  })
}

export function useComposerAppshotCapture({
  active,
  supportsAttachments,
}: UseComposerAppshotCaptureOptions): ComposerAppshotRuntime {
  const [externalFileParts, setExternalFileParts] = useState<FileUIPart[]>([])
  const [externalFilePartsKey, setExternalFilePartsKey] = useState(0)
  const [pendingAppshots, setPendingAppshots] = useState<PendingAppshotAttachment[]>([])
  const actionTargetRef = useRef<HTMLDivElement | null>(null)
  const activeRef = useRef(active)
  const supportsAttachmentsRef = useRef(supportsAttachments)
  const captureRef = useRef<ComposerAppshotRuntime['capture'] | null>(null)
  const [appshotCaptureInstanceId] = useState(() => nextAppshotCaptureInstanceId++)

  useEffect(() => {
    const wasActive = activeRef.current
    activeRef.current = active
    updateAppshotCaptureInstance(appshotCaptureInstanceId, (instance) => {
      instance.active = active
      if (active && !wasActive) {
        instance.activationOrder = createAppshotCaptureActivationOrder()
      }
    })
  }, [active, appshotCaptureInstanceId])

  useEffect(() => {
    const previouslySupportedAttachments = supportsAttachmentsRef.current
    supportsAttachmentsRef.current = supportsAttachments
    updateAppshotCaptureInstance(appshotCaptureInstanceId, (instance) => {
      instance.supportsAttachments = supportsAttachments
      if (activeRef.current && supportsAttachments && !previouslySupportedAttachments) {
        instance.activationOrder = createAppshotCaptureActivationOrder()
      }
    })
  }, [appshotCaptureInstanceId, supportsAttachments])

  const setActionTargetElement = useCallback((element: HTMLDivElement | null) => {
    actionTargetRef.current = element
  }, [])

  const appendFileParts = useCallback((fileParts: FileUIPart[]) => {
    if (fileParts.length === 0) {
      return
    }
    flushSync(() => {
      setExternalFileParts(fileParts)
      setExternalFilePartsKey(key => key + 1)
    })
  }, [])

  const capture = useCallback(async ({
    bundleIdentifier,
    targetWindow,
    tools,
  }: ComposerAppshotCaptureOptions = {}) => {
    if (!nativeIpc) {
      throw new Error('Appshot capture requires the Electron desktop app.')
    }

    const requestId = createAppshotRequestId()
    // The native transition needs the pending slot in the DOM before measuring destination geometry.
    flushSync(() => {
      setPendingAppshots(current => [createPendingAppshot(requestId), ...current])
    })

    const transitionSnapshotHeight = APPSHOT_ATTACHMENT_SLOT_HEIGHT
    const contextOptions = {
      attachmentTrayGrowthDirection: 'up' as const,
      pendingAppshotRequestId: requestId,
      transitionSnapshotHeight,
    }
    try {
      const context = tools?.readActionContext(contextOptions)
        ?? readComposerActionContext(actionTargetRef.current, contextOptions)
      if (!context.animationTarget) {
        throw new Error('Appshot animation target is unavailable.')
      }
      if (import.meta.env.DEV) {
        const composerTarget = actionTargetRef.current
        const pendingTarget = composerTarget?.querySelector<HTMLElement>(
          `[data-pending-appshot-capture-request-id="${requestId}"]`,
        )
        const attachmentsContainer = composerTarget?.querySelector<HTMLElement>('[data-composer-attachments-container]')
        const attachmentsRow = composerTarget?.querySelector<HTMLElement>('[data-composer-attachments-row]')
        console.debug('[appshot] renderer target measured:', {
          requestId,
          hasToolsContext: Boolean(tools),
          hasComposerActionTarget: Boolean(composerTarget),
          composerActionTargetRect: serializeDomRect(composerTarget?.getBoundingClientRect()),
          attachmentsContainerRect: serializeDomRect(attachmentsContainer?.getBoundingClientRect()),
          attachmentsRowRect: serializeDomRect(attachmentsRow?.getBoundingClientRect()),
          attachmentsRowScrollLeft: attachmentsRow?.scrollLeft ?? null,
          pendingTargetRect: serializeDomRect(pendingTarget?.getBoundingClientRect()),
          animationTarget: context.animationTarget,
          devicePixelRatio: window.devicePixelRatio,
          innerSize: {
            width: window.innerWidth,
            height: window.innerHeight,
          },
          screen: {
            left: window.screenLeft,
            top: window.screenTop,
            width: window.screen.width,
            height: window.screen.height,
            availLeft: (window.screen as Screen & { availLeft?: number }).availLeft ?? null,
            availTop: (window.screen as Screen & { availTop?: number }).availTop ?? null,
            availWidth: window.screen.availWidth,
            availHeight: window.screen.availHeight,
          },
        })
      }
      const response = await nativeIpc.macCapture.captureAppshot({
        sink: 'file',
        strategy: 'cradle-native',
        requestId,
        animationTarget: context.animationTarget,
        targetWindow,
        transitionSnapshotHeight: transitionSnapshotHeight * (context.animationTarget.transitionSnapshotScale ?? 1),
      })
      if (import.meta.env.DEV) {
        console.debug('[appshot] native transition geometry:', {
          requestId,
          strategy: response.strategy,
          captureWindow: response.capture.window,
          appshot: response.capture.appshot,
          destinationSnapshotHeight: transitionSnapshotHeight,
        })
      }

      setPendingAppshots(current => current.map(pending => pending.requestId === requestId
        ? {
            requestId,
            ...readAppshotTransitionMetrics(response, context.animationTarget?.transitionSnapshotScale),
          }
        : pending))

      if (import.meta.env.DEV) {
        toastManager.add({
          type: 'info',
          title: 'Appshot strategy',
          description: response.strategy,
        })
      }

      const asset = readAppshotCaptureAsset(response)
      if (!asset) {
        throw new Error('Appshot capture did not return an image asset.')
      }
      const transitionMetrics = readAppshotTransitionMetrics(response, context.animationTarget?.transitionSnapshotScale)
      const captureWindow = response.capture.window
      const filename = readFileNameFromPath(asset.path, 'appshot.png')
      const transitionSnapshotAsset = response.transitionSnapshotAsset
      const appIconDataUrl = captureWindow?.appIconDataUrl ?? null

      await Promise.all([
        waitForAppshotAnimation(response),
        decodeImageDataUrl(transitionSnapshotAsset?.dataURL ?? null),
        decodeImageDataUrl(appIconDataUrl),
      ])
      // Keep placeholder removal and final card insertion in the same frame to avoid a visible gap.
      flushSync(() => {
        setPendingAppshots(current => current.filter(pending => pending.requestId !== requestId))
        setExternalFileParts([createCradleAppshotFilePart({
          mediaType: asset.mimeType,
          filename,
          imageDataUrl: asset.dataURL,
          imagePath: asset.path,
          transitionSnapshotDataUrl: transitionSnapshotAsset?.dataURL ?? null,
          transitionSnapshotHeight: transitionMetrics.transitionSnapshotHeight,
          appName: captureWindow?.appName ?? null,
          windowTitle: captureWindow?.title ?? null,
          bundleIdentifier: captureWindow?.bundleId ?? bundleIdentifier ?? null,
          appIconDataUrl,
          axTree: captureWindow?.axTree ?? '',
        })])
        setExternalFilePartsKey(key => key + 1)
      })
    }
    catch (error) {
      setPendingAppshots(current => current.filter(pending => pending.requestId !== requestId))
      throw error
    }
  }, [])

  useEffect(() => {
    captureRef.current = capture
    updateAppshotCaptureInstance(appshotCaptureInstanceId, (instance) => {
      instance.capture = capture
    })
  }, [appshotCaptureInstanceId, capture])

  useEffect(() => {
    const id = appshotCaptureInstanceId
    appshotCaptureInstances.set(id, {
      id,
      active: activeRef.current,
      supportsAttachments: supportsAttachmentsRef.current,
      capture: captureRef.current,
      activationOrder: activeRef.current ? createAppshotCaptureActivationOrder() : 0,
    })
    ensureAppshotHotkeyListener()
    return () => {
      appshotCaptureInstances.delete(id)
      releaseAppshotHotkeyListenerIfIdle()
    }
  }, [appshotCaptureInstanceId])

  return {
    hasNativeCapture: Boolean(nativeIpc),
    pendingAppshots,
    externalFileParts,
    externalFilePartsKey,
    setActionTargetElement,
    appendFileParts,
    capture,
  }
}
