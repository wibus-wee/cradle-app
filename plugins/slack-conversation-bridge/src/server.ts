import type { ServerPluginContext } from '@cradle/plugin-sdk/server'

import { createSlackConversationAdapter } from './adapter'

export function activate(ctx: ServerPluginContext): void {
  ctx.conversation.adapters.register(createSlackConversationAdapter())
  ctx.logger.info('Slack conversation bridge adapter registered')
}
