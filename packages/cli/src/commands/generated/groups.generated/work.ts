import type { Command } from 'commander'

import { register as registerWorkArchive } from '../work/archive'
import { register as registerWorkCreate } from '../work/create'
import { register as registerWorkGet } from '../work/get'
import { register as registerWorkList } from '../work/list'
import { register as registerWorkPrepare } from '../work/prepare'
import { register as registerWorkRenameBranch } from '../work/rename-branch'
import { register as registerWorkSubmit } from '../work/submit'

export function registerGeneratedCommands(program: Command): void {
  registerWorkArchive(program)
  registerWorkCreate(program)
  registerWorkGet(program)
  registerWorkList(program)
  registerWorkPrepare(program)
  registerWorkRenameBranch(program)
  registerWorkSubmit(program)
}
