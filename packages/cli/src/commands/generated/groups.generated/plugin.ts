import type { Command } from 'commander'

import { register as registerPluginGet } from '../plugin/get'
import { register as registerPluginList } from '../plugin/list'
import { register as registerPluginMarketplaceList } from '../plugin/marketplace/list'
import { register as registerPluginMarketplaceRefresh } from '../plugin/marketplace/refresh'
import { register as registerPluginSetEnabled } from '../plugin/set-enabled'
import { register as registerPluginSourceAdd } from '../plugin/source/add'
import { register as registerPluginSourceGet } from '../plugin/source/get'
import { register as registerPluginSourceList } from '../plugin/source/list'
import { register as registerPluginSourceRefresh } from '../plugin/source/refresh'
import { register as registerPluginSourceRemove } from '../plugin/source/remove'
import { register as registerPluginSourceUninstallPlan } from '../plugin/source/uninstall-plan'

export function registerGeneratedCommands(program: Command): void {
  registerPluginGet(program)
  registerPluginList(program)
  registerPluginMarketplaceList(program)
  registerPluginMarketplaceRefresh(program)
  registerPluginSetEnabled(program)
  registerPluginSourceAdd(program)
  registerPluginSourceGet(program)
  registerPluginSourceList(program)
  registerPluginSourceRefresh(program)
  registerPluginSourceRemove(program)
  registerPluginSourceUninstallPlan(program)
}
