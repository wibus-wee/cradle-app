/* Registers the CC Switch provider mirror as a host-rendered external provider source. */

import type { ServerPluginContext } from '@cradle/plugin-sdk/server'

import { createCcSwitchExternalProviderSource } from './cc-switch-source'

export function activate(ctx: ServerPluginContext): void {
  ctx.providers.externalSources.register(createCcSwitchExternalProviderSource())
  ctx.logger.info('CC Switch plugin activated')
}
