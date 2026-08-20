import type { Command } from 'commander'

import { register as registerBackgroundJobCancel } from '../background-job/cancel'
import { register as registerBackgroundJobGet } from '../background-job/get'
import { register as registerBackgroundJobList } from '../background-job/list'

export function registerGeneratedCommands(program: Command): void {
  registerBackgroundJobCancel(program)
  registerBackgroundJobGet(program)
  registerBackgroundJobList(program)
}
