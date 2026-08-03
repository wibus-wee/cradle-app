/**
 * Host-side compile-time guard: the full ChatRuntime contract must remain
 * assignable to the published SDK PluginChatRuntime surface so plugins and
 * builtins share one registration path without `runtime: unknown`.
 */

import type { PluginChatRuntime } from '@cradle/plugin-sdk/server'

import type { ChatRuntime } from '../modules/chat-runtime/runtime-provider-types'

type AssertExtends<T, U> = [T] extends [U] ? true : { expected: U, actual: T }

export type ChatRuntimeSatisfiesPluginChatRuntime = AssertExtends<ChatRuntime, PluginChatRuntime>

const _chatRuntimeSatisfiesPluginChatRuntime: ChatRuntimeSatisfiesPluginChatRuntime = true
void _chatRuntimeSatisfiesPluginChatRuntime
