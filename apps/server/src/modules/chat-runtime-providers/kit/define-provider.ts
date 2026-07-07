/**
 * Compile-time capability/hook consistency for `ChatRuntime` registration.
 *
 * `chat-runtime-provider-registry.ts`'s `assertChatRuntime` already enforces the
 * capability-implies-hook rule (e.g. `capabilities.supportsShellExecution: true` requires
 * `executeShellCommand`) at *runtime*, when a provider registers. `defineChatRuntime` is a
 * lighter, earlier-failing complement: it makes the exact same rule a *type* error at the
 * provider's own definition site, so a missing hook is caught by `tsc`/the editor instead of by
 * a thrown error the first time the runtime is registered (or never, if that registration path
 * isn't exercised in tests).
 *
 * Providers can adopt this opportunistically — it's a drop-in replacement for writing out a
 * `ChatRuntime`-shaped object literal directly (`export const fooRuntime = defineChatRuntime({ ... })`
 * instead of `export const fooRuntime: ChatRuntime = { ... }`). Adoption is not required and
 * `assertChatRuntime` remains the source of truth at registration time.
 */

import type { ChatRuntime, ChatRuntimeCapabilities } from '../../chat-runtime/runtime-provider-types'

type CapabilityGatedHookKeys
  = | 'steerTurn'
    | 'executeShellCommand'
    | 'rollbackLastTurn'
    | 'updateRuntimeSettings'
    | 'getUiSlotStates'
    | 'getDynamicCapabilities'
    | 'generateSessionTitle'

type RequireWhen<T, Key extends keyof T, Required_> = Required_ extends true
  ? T & { [K in Key]-?: NonNullable<T[K]> }
  : T

type CapabilityHookRequirements<C extends ChatRuntimeCapabilities>
  = (C['steer'] extends 'native' ? { steerTurn: NonNullable<ChatRuntime['steerTurn']> } : unknown)
    & (C['supportsShellExecution'] extends true ? { executeShellCommand: NonNullable<ChatRuntime['executeShellCommand']> } : unknown)
    & (C['supportsLastTurnRollback'] extends true ? { rollbackLastTurn: NonNullable<ChatRuntime['rollbackLastTurn']> } : unknown)
    & (C['supportsRuntimeSettings'] extends true ? { updateRuntimeSettings: NonNullable<ChatRuntime['updateRuntimeSettings']> } : unknown)
    & (C['supportsUiSlotStates'] extends true ? { getUiSlotStates: NonNullable<ChatRuntime['getUiSlotStates']> } : unknown)
    & (C['supportsDynamicCapabilities'] extends true ? { getDynamicCapabilities: NonNullable<ChatRuntime['getDynamicCapabilities']> } : unknown)
    & (C['supportsTitleGeneration'] extends true ? { generateSessionTitle: NonNullable<ChatRuntime['generateSessionTitle']> } : unknown)

/**
 * Given a specific (literal) `ChatRuntimeCapabilities`, computes the `ChatRuntime` shape with
 * each capability-gated hook narrowed from optional to required exactly when its governing
 * capability flag says the hook must be implemented — mirroring `assertCapabilityHook` in
 * `chat-runtime-provider-registry.ts` one-to-one.
 */
export type ChatRuntimeDefinition<C extends ChatRuntimeCapabilities> = RequireWhen<
  RequireWhen<
    RequireWhen<
      RequireWhen<
        RequireWhen<
          RequireWhen<
            RequireWhen<
              Omit<ChatRuntime, 'capabilities' | CapabilityGatedHookKeys>
              & Pick<ChatRuntime, CapabilityGatedHookKeys> & { capabilities: C },
              'steerTurn',
              C['steer'] extends 'native' ? true : false
            >,
            'executeShellCommand',
            C['supportsShellExecution']
          >,
          'rollbackLastTurn',
          C['supportsLastTurnRollback']
        >,
        'updateRuntimeSettings',
        C['supportsRuntimeSettings']
      >,
      'getUiSlotStates',
      C['supportsUiSlotStates']
    >,
    'getDynamicCapabilities',
    C['supportsDynamicCapabilities']
  >,
  'generateSessionTitle',
  C['supportsTitleGeneration']
>

/**
 * Define a `ChatRuntime` with compile-time capability/hook consistency checking. `C` is inferred
 * from the literal `capabilities` object passed in (via the `const` type parameter), so e.g.
 * `capabilities: { supportsShellExecution: true, ... }` without an `executeShellCommand` hook is
 * a type error at this call site, not just a runtime assertion when the provider registers.
 */
export function defineChatRuntime<const C extends ChatRuntimeCapabilities>(
  definition: Omit<ChatRuntime, 'capabilities'> & { capabilities: C } & CapabilityHookRequirements<C>,
): ChatRuntime {
  return definition as ChatRuntime
}
