import { registerOperationCommand } from '../../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "plugin",
    "marketplace",
    "list"
  ],
  "description": "List marketplace plugin catalog",
  "flags": [],
  "method": "get",
  "path": "/plugins/marketplace"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
