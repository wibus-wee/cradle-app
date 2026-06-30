import type { BuiltinRuntimeKind, ProviderKind, RuntimeKind } from './types'

export type RuntimeProviderBinding = 'required' | 'runtime-owned'

const RUNTIME_PROVIDER_KINDS: Record<BuiltinRuntimeKind, ProviderKind[]> = {
  'standard': ['openai-compatible', 'universal'],
  'claude-agent': ['anthropic', 'universal'],
  'codex': ['openai-compatible', 'universal'],
  'opencode': ['openai-compatible', 'anthropic', 'universal'],
  'jar-core': ['openai-compatible', 'anthropic', 'universal'],
  'acp-chat': ['openai-compatible', 'anthropic', 'universal'],
  'cli-tui': [],
}

const RUNTIME_PROVIDER_BINDINGS: Record<BuiltinRuntimeKind, RuntimeProviderBinding> = {
  'standard': 'required',
  'claude-agent': 'required',
  'codex': 'required',
  'opencode': 'runtime-owned',
  'jar-core': 'required',
  'acp-chat': 'required',
  'cli-tui': 'runtime-owned',
}

const runtimeProviderKinds = new Map<RuntimeKind, readonly ProviderKind[]>(
  Object.entries(RUNTIME_PROVIDER_KINDS),
)
const runtimeProviderBindings = new Map<RuntimeKind, RuntimeProviderBinding>(
  Object.entries(RUNTIME_PROVIDER_BINDINGS),
)

export function registerRuntimeProviderKinds(runtimeKind: RuntimeKind, providerKinds: readonly ProviderKind[]): void {
  runtimeProviderKinds.set(runtimeKind, [...providerKinds])
}

export function registerRuntimeProviderBinding(runtimeKind: RuntimeKind, providerBinding: RuntimeProviderBinding): void {
  runtimeProviderBindings.set(runtimeKind, providerBinding)
}

export function listProviderKindsForRuntime(runtimeKind: RuntimeKind): readonly ProviderKind[] {
  return runtimeProviderKinds.get(runtimeKind) ?? []
}

export function readRuntimeProviderBinding(runtimeKind: RuntimeKind): RuntimeProviderBinding {
  return runtimeProviderBindings.get(runtimeKind) ?? 'required'
}

export function runtimeOwnsProviderBinding(runtimeKind: RuntimeKind): boolean {
  return readRuntimeProviderBinding(runtimeKind) === 'runtime-owned'
}

export function runtimeSupportsProviderKind(runtimeKind: RuntimeKind, providerKind: ProviderKind): boolean {
  return listProviderKindsForRuntime(runtimeKind).includes(providerKind)
}
