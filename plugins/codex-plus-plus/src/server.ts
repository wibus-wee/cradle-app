/* 注册 Codex++ provider 镜像，由宿主渲染为 external provider source。 */

import type { ServerPluginContext } from '@cradle/plugin-sdk/server'

import { createCodexPlusPlusExternalProviderSource } from './codex-plus-plus-source'

export function activate(ctx: ServerPluginContext): void {
  ctx.providers.externalSources.register(createCodexPlusPlusExternalProviderSource())
  ctx.logger.info('Codex++ plugin activated')
}
