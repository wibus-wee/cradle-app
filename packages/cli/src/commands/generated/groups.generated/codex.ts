import type { Command } from 'commander'

import { register as registerCodexAppServerResources } from '../codex/app-server/resources'
import { register as registerCodexConfigSchema } from '../codex/config-schema'

export function registerGeneratedCommands(program: Command): void {
  registerCodexAppServerResources(program)
  registerCodexConfigSchema(program)
}
