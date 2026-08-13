import type { Command } from 'commander'

import { register as registerMcpServerDelete } from '../mcp-server/delete'
import { register as registerMcpServerList } from '../mcp-server/list'
import { register as registerMcpServerSetEnabled } from '../mcp-server/set-enabled'

export function registerGeneratedCommands(program: Command): void {
  registerMcpServerDelete(program)
  registerMcpServerList(program)
  registerMcpServerSetEnabled(program)
}
