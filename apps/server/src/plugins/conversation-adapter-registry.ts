import type { Disposable } from '@cradle/plugin-sdk'
import type { ConversationBridgeAdapterRegistration } from '@cradle/plugin-sdk/server'

import { registerPluginCapability, unregisterPluginCapability } from './runtime-registry'

export interface RegisteredConversationBridgeAdapter {
  key: string
  owner: string
  adapter: ConversationBridgeAdapterRegistration
  registeredAt: number
}

const adapters = new Map<string, RegisteredConversationBridgeAdapter>()

export function deriveConversationBridgeAdapterKey(owner: string, adapterId: string): string {
  return `${owner}:${adapterId}`
}

export function registerConversationBridgeAdapter(
  owner: string,
  adapter: ConversationBridgeAdapterRegistration,
): Disposable {
  const id = adapter.id.trim()
  const platform = adapter.platform.trim()
  const label = adapter.label.trim()
  if (!id) {
    throw new Error('Conversation bridge adapter id is required')
  }
  if (!platform) {
    throw new Error(`Conversation bridge adapter ${id} platform is required`)
  }
  if (!label) {
    throw new Error(`Conversation bridge adapter ${id} label is required`)
  }

  const key = deriveConversationBridgeAdapterKey(owner, id)
  if (adapters.has(key)) {
    throw new Error(`Conversation bridge adapter already registered: ${owner}:${id}`)
  }

  const record = registerPluginCapability(owner, 'conversation-adapter', 'server', id, label, {
    platform,
    description: adapter.description,
    capabilities: adapter.capabilities,
  }, [`conversation-adapter.${id}`])

  adapters.set(key, {
    key,
    owner,
    adapter: {
      ...adapter,
      id,
      platform,
      label,
    },
    registeredAt: Math.floor(Date.now() / 1000),
  })

  let disposed = false
  return {
    dispose() {
      if (disposed) { return }
      disposed = true
      adapters.delete(key)
      unregisterPluginCapability(owner, record.id)
    },
  }
}

export function listConversationBridgeAdapters(): RegisteredConversationBridgeAdapter[] {
  return [...adapters.values()].sort((a, b) => a.adapter.label.localeCompare(b.adapter.label))
}

export function getConversationBridgeAdapter(
  owner: string,
  adapterId: string,
): RegisteredConversationBridgeAdapter | null {
  return adapters.get(deriveConversationBridgeAdapterKey(owner, adapterId)) ?? null
}

export function resetConversationBridgeAdapterRegistry(): void {
  adapters.clear()
}
