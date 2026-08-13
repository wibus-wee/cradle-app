import type { ProviderExtensionLifecycleEvent } from './types'

export type ProviderExtensionLifecycleListener = (event: ProviderExtensionLifecycleEvent) => void

const listeners = new Set<ProviderExtensionLifecycleListener>()

export function subscribeProviderExtensionLifecycle(
  listener: ProviderExtensionLifecycleListener,
): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function publishProviderExtensionLifecycle(event: ProviderExtensionLifecycleEvent): void {
  for (const listener of listeners) {
    try {
      listener(event)
    }
    catch {
      // Notifications run after the durable lifecycle transition and cannot roll it back.
    }
  }
}

export function resetProviderExtensionLifecycleListenersForTests(): void {
  listeners.clear()
}
