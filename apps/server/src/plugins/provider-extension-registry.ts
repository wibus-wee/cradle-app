import { createHash } from 'node:crypto'

import type { Disposable } from '@cradle/plugin-sdk'
import type { ProviderExtension } from '@cradle/plugin-sdk/server'

import { registerPluginCapability, unregisterPluginCapability } from './runtime-registry'

export interface RegisteredProviderExtension {
  key: string
  owner: string
  extension: ProviderExtension
  registeredAt: number
}

const extensions = new Map<string, RegisteredProviderExtension>()

export function deriveProviderExtensionKey(owner: string, extensionId: string): string {
  const hash = createHash('sha256').update(`${owner}\0${extensionId}`).digest('hex').slice(0, 24)
  return `provider_extension_${hash}`
}

function normalizeProviderExtension(extension: ProviderExtension): ProviderExtension {
  const id = extension.id.trim()
  if (!id) {
    throw new Error('Provider extension id is required')
  }
  const label = extension.label.trim()
  if (!label) {
    throw new Error(`Provider extension ${id} label is required`)
  }
  if (extension.conversions.length === 0) {
    throw new Error(`Provider extension ${id} must declare at least one conversion`)
  }

  for (const conversion of extension.conversions) {
    if (conversion.routedProviderKinds.length === 0) {
      throw new Error(
        `Provider extension ${id} conversion from ${conversion.fromProviderKind} must route at least one Provider kind`,
      )
    }
  }

  return { ...extension, id, label }
}

export function registerProviderExtension(owner: string, extension: ProviderExtension): Disposable {
  const normalized = normalizeProviderExtension(extension)
  const key = deriveProviderExtensionKey(owner, normalized.id)
  if (extensions.has(key)) {
    throw new Error(`Provider extension already registered: ${owner}:${normalized.id}`)
  }

  const capability = registerPluginCapability(
    owner,
    'provider-extension',
    'server',
    normalized.id,
    normalized.label,
    {
      description: normalized.description,
      conversions: normalized.conversions,
    },
    [`provider-extension.${normalized.id}`],
    ['provider.credentials.use'],
  )
  extensions.set(key, {
    key,
    owner,
    extension: normalized,
    registeredAt: Math.floor(Date.now() / 1000),
  })

  let disposed = false
  return {
    dispose() {
      if (disposed) { return }
      disposed = true
      extensions.delete(key)
      unregisterPluginCapability(owner, capability.id)
    },
  }
}

export function listProviderExtensions(): RegisteredProviderExtension[] {
  return [...extensions.values()].sort((a, b) => a.extension.label.localeCompare(b.extension.label))
}

export function getProviderExtension(key: string): RegisteredProviderExtension | null {
  return extensions.get(key) ?? null
}

export function findProviderExtension(owner: string, extensionId: string): RegisteredProviderExtension | null {
  return getProviderExtension(deriveProviderExtensionKey(owner, extensionId))
}

export function resetProviderExtensionRegistry(): void {
  extensions.clear()
}
