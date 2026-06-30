import type { ServerPluginContext } from '@cradle/plugin-sdk/server'

import { createGitHubIssuesSource } from './source'

export function activate(ctx: ServerPluginContext): void {
  ctx.issues.externalSources.register(createGitHubIssuesSource())
  ctx.logger.info('GitHub Issues plugin activated')
}
