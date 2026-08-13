import type { Command } from 'commander'

import { register as registerRelayServerCreate } from '../relay-server/create'
import { register as registerRelayServerDelete } from '../relay-server/delete'
import { register as registerRelayServerList } from '../relay-server/list'
import { register as registerRelayServerUpdate } from '../relay-server/update'

export function registerGeneratedCommands(program: Command): void {
  registerRelayServerCreate(program)
  registerRelayServerDelete(program)
  registerRelayServerList(program)
  registerRelayServerUpdate(program)
}
