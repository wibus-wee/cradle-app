import type { Command } from 'commander'

import { register as registerKimiServerResources } from '../kimi/server/resources'

export function registerGeneratedCommands(program: Command): void {
  registerKimiServerResources(program)
}
