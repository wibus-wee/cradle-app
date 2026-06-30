import type { AfterResponseHandler, BeforeQueryHandler, Disposable, QueryHookContext, ResponseHookContext } from '@cradle/plugin-sdk/server'

import { createChildLogger } from '../logging/logger'
import { registerPluginCapability, unregisterPluginCapability } from './runtime-registry'

const beforeQueryHandlers: BeforeQueryHandler[] = []
const afterResponseHandlers: AfterResponseHandler[] = []
const logger = createChildLogger({ module: 'plugin-hooks' })

export function registerBeforeQueryHook(handler: BeforeQueryHandler): Disposable {
  beforeQueryHandlers.push(handler)
  return {
    dispose() {
      const idx = beforeQueryHandlers.indexOf(handler)
      if (idx >= 0) { beforeQueryHandlers.splice(idx, 1) }
    },
  }
}

export function registerAfterResponseHook(handler: AfterResponseHandler): Disposable {
  afterResponseHandlers.push(handler)
  return {
    dispose() {
      const idx = afterResponseHandlers.indexOf(handler)
      if (idx >= 0) { afterResponseHandlers.splice(idx, 1) }
    },
  }
}

export function registerOwnedBeforeQueryHook(owner: string, handler: BeforeQueryHandler): Disposable {
  const record = registerPluginCapability(owner, 'hook', 'server', 'before-query', 'Before query hook', undefined, [
    'hook.before-query',
  ])
  const disposable = registerBeforeQueryHook(handler)
  return {
    dispose() {
      disposable.dispose()
      unregisterPluginCapability(owner, record.id)
    },
  }
}

export function registerOwnedAfterResponseHook(owner: string, handler: AfterResponseHandler): Disposable {
  const record = registerPluginCapability(owner, 'hook', 'server', 'after-response', 'After response hook', undefined, [
    'hook.after-response',
  ])
  const disposable = registerAfterResponseHook(handler)
  return {
    dispose() {
      disposable.dispose()
      unregisterPluginCapability(owner, record.id)
    },
  }
}

/** Run all before-query hooks in sequence. Returns the (possibly modified) context. */
export async function runBeforeQueryHooks(ctx: QueryHookContext): Promise<QueryHookContext> {
  let current = ctx
  for (const handler of beforeQueryHandlers) {
    current = await handler(current)
  }
  return current
}

/** Run all after-response hooks (fire-and-forget, errors logged). */
export async function runAfterResponseHooks(ctx: ResponseHookContext): Promise<void> {
  for (const handler of afterResponseHandlers) {
    try {
      await handler(ctx)
    }
 catch (err) {
      logger.error('after response hook failed', { err })
    }
  }
}
