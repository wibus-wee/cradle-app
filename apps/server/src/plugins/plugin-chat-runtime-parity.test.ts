/**
 * Runtime registration typing parity for the published plugin SDK.
 *
 * IPC web/desktop service interface duplication (`apps/web/src/lib/electron.ts`
 * CradleIpcServices vs `apps/desktop/src/main/native-services.ts`) is large and
 * not mostly done — defer a shared extracted interface; prefer a later
 * ExtractServiceMethods-based parity pass rather than a 300+ line refactor now.
 */

import type { PluginChatRuntime } from '@cradle/plugin-sdk/server'
import { describe, expectTypeOf, it } from 'vitest'

import type { ChatRuntime } from '../modules/chat-runtime/runtime-provider-types'
import type { ChatRuntimeSatisfiesPluginChatRuntime } from './plugin-chat-runtime-parity'

describe('pluginChatRuntime host parity', () => {
  it('keeps host ChatRuntime assignable to the SDK PluginChatRuntime contract', () => {
    expectTypeOf<ChatRuntimeSatisfiesPluginChatRuntime>().toEqualTypeOf<true>()
    expectTypeOf<ChatRuntime>().toMatchTypeOf<PluginChatRuntime>()
  })
})
