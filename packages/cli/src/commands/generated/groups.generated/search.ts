import type { Command } from 'commander'

import { register as registerSearchChronicle } from '../search/chronicle'
import { register as registerSearchThreads } from '../search/threads'

export function registerGeneratedCommands(program: Command): void {
  registerSearchChronicle(program)
  registerSearchThreads(program)
}
