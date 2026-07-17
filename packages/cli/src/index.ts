import { Command } from 'commander'

import { registerGeneratedCommands } from './commands/generated/index.generated'
import { registerJavascriptCommand } from './commands/javascript'
import { registerSessionAwaitCommand } from './commands/session-await'
import { registerPluginDevCommand } from './commands/plugin-dev'
import { createCommandContext } from './runtime/context'
import { registerManualCommand } from './runtime/manual-command'
import { resolveServerUrl } from './runtime/server-locator'

const program = new Command()
  .name('cradle')
  .description('Cradle CLI')
  .version('0.1.0')
  .option('--server <url>', 'Cradle server URL')

registerGeneratedCommands(program)
registerSessionAwaitCommand(program)
registerJavascriptCommand(program)
registerPluginDevCommand(program)
registerManualCommand(program)

program.hook('preAction', (root) => {
  const opts = root.opts<{ server?: string }>()
  root.setOptionValue('__context', createCommandContext({ serverUrl: resolveServerUrl({ explicitServerUrl: opts.server }) }))
})

program.parseAsync().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(message)
  process.exit(1)
})
