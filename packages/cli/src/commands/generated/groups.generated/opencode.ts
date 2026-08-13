import type { Command } from 'commander'

import { register as registerOpencodeServerResources } from '../opencode/server/resources'

export function registerGeneratedCommands(program: Command): void {
  registerOpencodeServerResources(program)
}
