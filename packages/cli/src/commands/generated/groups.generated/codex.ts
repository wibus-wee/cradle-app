import type { Command } from 'commander'

import { register as registerCodexAppServerResources } from '../codex/app-server/resources'

export function registerGeneratedCommands(program: Command): void {
  registerCodexAppServerResources(program)
}
