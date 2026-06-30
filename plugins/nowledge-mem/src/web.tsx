/* Web plugin entry — registers the Nowledge Mem settings panel. */

import type { WebPluginContext } from '@cradle/plugin-sdk/web'
import { BrainLine as BrainIcon } from '@mingcute/react'

import { ConfigTab } from './web/tabs/config-tab'

export function activate(ctx: WebPluginContext): void {
  ctx.panels.register({
    id: 'config',
    title: 'Nowledge Mem Settings',
    icon: BrainIcon,
    component: () => <ConfigTab ctx={ctx} />,
    location: 'sidebar',
  })

  ctx.logger.info('Nowledge Mem plugin (web) activated')
}
