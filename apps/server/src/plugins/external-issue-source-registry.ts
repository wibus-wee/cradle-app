import { createHash } from 'node:crypto'

import type { Disposable } from '@cradle/plugin-sdk'
import type { ExternalIssueSource } from '@cradle/plugin-sdk/server'

import { registerPluginCapability, unregisterPluginCapability } from './runtime-registry'

export interface RegisteredExternalIssueSource {
  key: string
  owner: string
  source: ExternalIssueSource
  registeredAt: number
}

const sources = new Map<string, RegisteredExternalIssueSource>()

export function deriveExternalIssueSourceKey(owner: string, sourceId: string): string {
  const hash = createHash('sha256').update(`${owner}\0${sourceId}`).digest('hex').slice(0, 24)
  return `external_issue_source_${hash}`
}

export function registerExternalIssueSource(owner: string, source: ExternalIssueSource): Disposable {
  const id = source.id.trim()
  if (!id) {
    throw new Error('External issue source id is required')
  }
  if (!source.label.trim()) {
    throw new Error(`External issue source ${id} label is required`)
  }

  const key = deriveExternalIssueSourceKey(owner, id)
  if (sources.has(key)) {
    throw new Error(`External issue source already registered: ${owner}:${id}`)
  }

  const record = registerPluginCapability(owner, 'external-issue-source', 'server', id, source.label, {
    description: source.description,
    capabilities: source.capabilities,
  }, [`external-issue-source.${id}`])
  sources.set(key, {
    key,
    owner,
    source: { ...source, id },
    registeredAt: Math.floor(Date.now() / 1000),
  })
  let disposed = false
  return {
    dispose() {
      if (disposed) { return }
      disposed = true
      sources.delete(key)
      unregisterPluginCapability(owner, record.id)
    },
  }
}

export function listExternalIssueSources(): RegisteredExternalIssueSource[] {
  return Array.from(sources.values()).sort((a, b) => a.source.label.localeCompare(b.source.label))
}

export function getExternalIssueSource(sourceKey: string): RegisteredExternalIssueSource | null {
  return sources.get(sourceKey) ?? null
}

export function resetExternalIssueSourceRegistry(): void {
  sources.clear()
}
