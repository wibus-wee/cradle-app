import type { Command } from 'commander'

import { register as registerSecretDelete } from '../secret/delete'
import { register as registerSecretList } from '../secret/list'

export function registerGeneratedCommands(program: Command): void {
  registerSecretDelete(program)
  registerSecretList(program)
}
