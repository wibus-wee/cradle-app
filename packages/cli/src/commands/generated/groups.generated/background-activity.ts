import type { Command } from 'commander'

import { register as registerBackgroundActivityList } from '../background-activity/list'
import { register as registerBackgroundActivityRun } from '../background-activity/run'

export function registerGeneratedCommands(program: Command): void {
  registerBackgroundActivityList(program)
  registerBackgroundActivityRun(program)
}
