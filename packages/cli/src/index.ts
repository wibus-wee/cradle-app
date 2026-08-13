import { Command } from 'commander'

import {
  generatedCommandGroups,
  registerGeneratedCommandGroup,
  registerGeneratedCommandPlaceholders,
} from './commands/generated/index.generated'
import { registerJavascriptCommand } from './commands/javascript'
import { applyOpenPathSugar, registerOpenCommand } from './commands/open'
import { registerSessionAwaitCommand } from './commands/session-await'
import { registerPluginDevCommand } from './commands/plugin-dev'
import { createCommandContext } from './runtime/context'
import { resolveGeneratedCommandGroup } from './runtime/generated-command-selection'
import { registerManualCommand } from './runtime/manual-command'
import { resolveServerUrl } from './runtime/server-locator'

const generatedGroupSet = new Set<string>(generatedCommandGroups)

async function main(): Promise<void> {
  const program = new Command()
    .name('cradle')
    .description('Cradle CLI')
    .version('0.1.0')
    .option('--server <url>', 'Cradle server URL')

  const loadedGroup = resolveGeneratedCommandGroup(process.argv, generatedGroupSet)
  await registerGeneratedCommandGroup(program, loadedGroup)
  registerOpenCommand(program)
  registerSessionAwaitCommand(program)
  registerJavascriptCommand(program)
  registerPluginDevCommand(program)
  registerManualCommand(program)
  registerGeneratedCommandPlaceholders(program, loadedGroup)

  program.hook('preAction', (root) => {
    const opts = root.opts<{ server?: string }>()
    root.setOptionValue('__context', createCommandContext({ serverUrl: resolveServerUrl({ explicitServerUrl: opts.server }) }))
  })

  const knownTopLevelCommands = new Set(program.commands.map(command => command.name()))
  const argv = applyOpenPathSugar(process.argv, knownTopLevelCommands)
  await program.parseAsync(argv)
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(message)
  process.exit(1)
})
