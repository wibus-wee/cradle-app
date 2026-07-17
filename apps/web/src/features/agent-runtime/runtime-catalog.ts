import type { ChatRuntimeCatalogItem, ProviderKind, RuntimeKind } from './types'

export type RuntimeCatalogSurface = NonNullable<ChatRuntimeCatalogItem['surfaces']>[number]
export type RuntimeCatalogCapabilities = NonNullable<ChatRuntimeCatalogItem['capabilities']>
export type RuntimeCatalogStability = NonNullable<ChatRuntimeCatalogItem['stability']>
export type RuntimeCatalogCapabilityDegradation = NonNullable<ChatRuntimeCatalogItem['degradations']>[number]
export type RuntimeCatalogComposer = ChatRuntimeCatalogItem['composer']
export type RuntimeCatalogSlot = ChatRuntimeCatalogItem['slots'][number]
export type RuntimeCatalogSlotSurface = RuntimeCatalogSlot['surfaces'][number]

export const DEFAULT_RUNTIME_CATALOG_COMPOSER: RuntimeCatalogComposer = {
  inputMode: 'rich',
  modelSelection: 'provider-model',
  thinking: 'per-model',
}

export interface RuntimeCatalogItem extends Omit<ChatRuntimeCatalogItem, 'providerKinds' | 'surfaces' | 'providerBinding'> {
  runtimeKind: RuntimeKind
  label: string
  description?: string
  providerKinds: ProviderKind[]
  providerBinding?: 'required' | 'runtime-owned' | 'none'
  iconKey?: string
  surfaces: RuntimeCatalogSurface[]
}

export function listRuntimeCatalogForSurface(
  runtimes: RuntimeCatalogItem[],
  surface: RuntimeCatalogSurface,
): RuntimeCatalogItem[] {
  return runtimes.filter(runtime => runtime.surfaces.includes(surface))
}

export function runtimeComposerUsesModelSelection(composer: RuntimeCatalogComposer): boolean {
  return composer.modelSelection !== 'none'
}

export function runtimeCatalogItemUsesModelSelection(runtime: Pick<RuntimeCatalogItem, 'composer'>): boolean {
  return runtimeComposerUsesModelSelection(runtime.composer)
}

export function runtimeCatalogItemUsesCliLaunchConfig(runtime: Pick<RuntimeCatalogItem, 'sessionLaunchMode'>): boolean {
  return runtime.sessionLaunchMode === 'agent-terminal'
}

export function runtimeCatalogItemRequiresProviderTarget(
  runtime: Pick<RuntimeCatalogItem, 'composer' | 'providerBinding'>,
): boolean {
  return runtimeCatalogItemUsesModelSelection(runtime) && (runtime.providerBinding ?? 'required') === 'required'
}

export function runtimeComposerUsesAliasMatrixModelSelection(composer: RuntimeCatalogComposer): boolean {
  return composer.modelSelection === 'alias-matrix'
}

export function runtimeCatalogItemUsesAliasMatrixModelSelection(runtime: Pick<RuntimeCatalogItem, 'composer'>): boolean {
  return runtimeComposerUsesAliasMatrixModelSelection(runtime.composer)
}

export function runtimeCatalogItemHasSlotId(
  runtime: Pick<RuntimeCatalogItem, 'slots'> | null | undefined,
  slotId: string,
  surface?: RuntimeCatalogSlotSurface,
): boolean {
  return runtimeCatalogItemHasSlot(runtime, slot => slot.id === slotId, surface)
}

export function runtimeCatalogItemHasSlotName(
  runtime: Pick<RuntimeCatalogItem, 'slots'> | null | undefined,
  slotName: string,
  surface?: RuntimeCatalogSlotSurface,
): boolean {
  return runtimeCatalogItemHasSlot(runtime, slot => slot.name === slotName, surface)
}

function runtimeCatalogItemHasSlot(
  runtime: Pick<RuntimeCatalogItem, 'slots'> | null | undefined,
  predicate: (slot: RuntimeCatalogSlot) => boolean,
  surface?: RuntimeCatalogSlotSurface,
): boolean {
  return Boolean(runtime?.slots.some(slot => predicate(slot) && (!surface || slot.surfaces.includes(surface))))
}

export function runtimeComposerUsesCollapsedInput(composer: RuntimeCatalogComposer): boolean {
  return composer.inputMode === 'collapsed'
}

export function runtimeComposerSupportsSlashCommands(composer: RuntimeCatalogComposer): boolean {
  return composer.inputMode === 'rich'
}

export function runtimeComposerAllowsEmptySubmit(composer: RuntimeCatalogComposer): boolean {
  return composer.allowEmptySubmit === true || runtimeComposerUsesCollapsedInput(composer)
}

export function runtimeComposerSupportsThinking(composer: RuntimeCatalogComposer): boolean {
  return composer.thinking !== 'unsupported'
}
