import type { Command } from 'commander'

import { register as registerAgentCreate } from '../agent/create'
import { register as registerAgentDelete } from '../agent/delete'
import { register as registerAgentGet } from '../agent/get'
import { register as registerAgentList } from '../agent/list'
import { register as registerAgentUpdate } from '../agent/update'

export function registerGeneratedCommands(program: Command): void {
  registerAgentCreate(program)
  registerAgentDelete(program)
  registerAgentGet(program)
  registerAgentList(program)
  registerAgentUpdate(program)
}
