import type { Command } from 'commander'

import { register as registerProviderDelete } from '../provider/delete'
import { register as registerProviderList } from '../provider/list'
import { register as registerProviderModels } from '../provider/models'
import { register as registerProviderPresets } from '../provider/presets'
import { register as registerProviderScanLocal } from '../provider/scan-local'
import { register as registerProviderSet } from '../provider/set'
import { register as registerProviderTest } from '../provider/test'

export function registerGeneratedCommands(program: Command): void {
  registerProviderDelete(program)
  registerProviderList(program)
  registerProviderModels(program)
  registerProviderPresets(program)
  registerProviderScanLocal(program)
  registerProviderSet(program)
  registerProviderTest(program)
}
