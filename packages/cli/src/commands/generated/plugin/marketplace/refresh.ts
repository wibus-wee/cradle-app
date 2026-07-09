import { registerOperationCommand } from '../../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "plugin",
    "marketplace",
    "refresh"
  ],
  "description": "Force-refresh marketplace catalog",
  "flags": [],
  "method": "post",
  "path": "/plugins/marketplace/refresh"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
