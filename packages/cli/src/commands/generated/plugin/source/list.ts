import { registerOperationCommand } from '../../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "plugin",
    "source",
    "list"
  ],
  "description": "List plugin sources",
  "flags": [],
  "method": "get",
  "path": "/plugins/sources"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
