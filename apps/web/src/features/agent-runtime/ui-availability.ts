import type { RuntimeKind } from './types'

const HIDDEN_UI_RUNTIME_KINDS = new Set<RuntimeKind>(['standard'])

export function isUiRuntimeKindEnabled(runtimeKind: RuntimeKind): boolean {
  return !HIDDEN_UI_RUNTIME_KINDS.has(runtimeKind)
}
