import { isElectron, isTearoffWindow, nativeIpc, subscribeTearoffSurfaceClosed } from '~/lib/electron'

import { closeSurfaceById, navigateToSurface } from './navigation-commands'
import type { AppSurface } from './surface-identity'
import { chatSurfaceId } from './surface-identity'

/**
 * Registry of surfaces currently living in their own tear-off window.
 *
 * The full surface snapshot is retained so the surface can be restored in the
 * main window when its tear-off window closes — including non-chat surfaces,
 * whose route cannot be reconstructed from a session id alone.
 */
const activeTearoffSurfaces = new Map<string, AppSurface>()

export function reserveTearoffSurface(surface: AppSurface): boolean {
  if (activeTearoffSurfaces.has(surface.id)) {
    return false
  }
  activeTearoffSurfaces.set(surface.id, surface)
  return true
}

export function releaseTearoffSurface(surfaceId: string): void {
  activeTearoffSurfaces.delete(surfaceId)
}

interface OpenTearoffOptions {
  screenX?: number
  screenY?: number
  /** Close the surface in the main window after tearing it off. */
  detachSurface?: boolean
}

/**
 * Tear a surface off into its own Electron window. Works for every surface kind
 * (chat, workspace, diffs, kanban, plugin, …), not just chat sessions.
 */
export async function openTearoffSurfaceWindow(
  surface: AppSurface,
  options: OpenTearoffOptions = {},
): Promise<boolean> {
  if (!isElectron || !nativeIpc) {
    return false
  }

  const screenX = options.screenX ?? window.screenX + Math.round(window.outerWidth / 2)
  const screenY = options.screenY ?? window.screenY + Math.round(window.outerHeight / 2)
  if (!reserveTearoffSurface(surface)) {
    // Already torn off — focus it.
    void nativeIpc.window.focusSurface(surface.id).catch(() => {})
    return true
  }

  try {
    await nativeIpc.window.tearOffSurface(surface.id, surface.route, screenX, screenY)
    if (options.detachSurface && !isTearoffWindow) {
      closeSurfaceById(surface.id)
    }
    return true
  }
  catch {
    releaseTearoffSurface(surface.id)
    return false
  }
}

/**
 * Convenience for the common case of tearing off a chat session by id.
 * Kept as a thin wrapper so existing chat call sites read naturally.
 */
export async function openTearoffChatSessionWindow(
  sessionId: string,
  options: OpenTearoffOptions = {},
): Promise<boolean> {
  return openTearoffSurfaceWindow(
    {
      id: chatSurfaceId(sessionId),
      kind: 'chat',
      title: 'Chat',
      route: { to: '/chat/$sessionId', params: { sessionId } },
      order: 0,
      closable: true,
    },
    options,
  )
}

export function installTearoffSurfaceRestore(): () => void {
  return subscribeTearoffSurfaceClosed((surfaceId) => {
    const surface = activeTearoffSurfaces.get(surfaceId)
    releaseTearoffSurface(surfaceId)
    if (surface) {
      navigateToSurface(surface)
    }
  })
}
