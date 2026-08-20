import type { Command } from 'commander'

import { register as registerHealth } from '../health'

export function registerGeneratedCommands(program: Command): void {
  registerHealth(program)
}
