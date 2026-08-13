import type { Command } from 'commander'

import { register as registerProfileCustomModels } from '../profile/custom-models'
import { register as registerProfileDelete } from '../profile/delete'
import { register as registerProfileGet } from '../profile/get'
import { register as registerProfileList } from '../profile/list'
import { register as registerProfileSet } from '../profile/set'

export function registerGeneratedCommands(program: Command): void {
  registerProfileCustomModels(program)
  registerProfileDelete(program)
  registerProfileGet(program)
  registerProfileList(program)
  registerProfileSet(program)
}
