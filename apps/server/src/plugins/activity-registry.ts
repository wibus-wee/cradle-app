import type { Disposable } from '@cradle/plugin-sdk'
import type { PluginActivityHandler } from '@cradle/plugin-sdk/server'

import { createChildLogger } from '../logging/logger'
import { subscribeChatRunActivity } from '../modules/chat-runtime/es/activity-tail'
import { registerPluginCapability, unregisterPluginCapability } from './runtime-registry'

const logger = createChildLogger({ module: 'plugin-activity' })

export function registerPluginActivitySubscription(
  owner: string,
  handler: PluginActivityHandler,
): Disposable {
  const capability = registerPluginCapability(
    owner,
    'activity-subscription',
    'server',
    'chat-runs',
    'Chat run activity subscription',
    undefined,
    ['chat-runs'],
    ['activity.read'],
  )
  let disposed = false
  const unsubscribe = subscribeChatRunActivity((activity) => {
    try {
      Promise.resolve(handler(activity)).catch((error) => {
        logger.error('plugin activity handler failed', { plugin: owner, error })
      })
    }
    catch (error) {
      logger.error('plugin activity handler failed', { plugin: owner, error })
    }
  })

  return {
    dispose() {
      if (disposed) {
        return
      }
      disposed = true
      unsubscribe()
      unregisterPluginCapability(owner, capability.id)
    },
  }
}
