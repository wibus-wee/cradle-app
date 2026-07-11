import type { BackgroundJobOwnerProjector, BackgroundJobSourceAdapter } from './types'

const sourceAdapters = new Map<string, BackgroundJobSourceAdapter>()
const ownerProjectors = new Map<string, BackgroundJobOwnerProjector>()

function projectorKey(ownerNamespace: string, kind: string): string {
  return `${ownerNamespace}:${kind}`
}

export function registerSourceAdapter(adapter: BackgroundJobSourceAdapter): void {
  sourceAdapters.set(adapter.sourceKind, adapter)
}

export function unregisterSourceAdapter(sourceKind: string): void {
  sourceAdapters.delete(sourceKind)
}

export function getSourceAdapter(sourceKind: string): BackgroundJobSourceAdapter | undefined {
  return sourceAdapters.get(sourceKind)
}

export function registerOwnerProjector(projector: BackgroundJobOwnerProjector): void {
  ownerProjectors.set(projectorKey(projector.ownerNamespace, projector.kind), projector)
}

export function unregisterOwnerProjector(ownerNamespace: string, kind: string): void {
  ownerProjectors.delete(projectorKey(ownerNamespace, kind))
}

export function getOwnerProjector(
  ownerNamespace: string,
  kind: string,
): BackgroundJobOwnerProjector | undefined {
  return ownerProjectors.get(projectorKey(ownerNamespace, kind))
}
