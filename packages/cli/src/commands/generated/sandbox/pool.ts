import { registerOperationCommand } from '../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "sandbox",
    "pool"
  ],
  "description": "Show sandbox pool status",
  "flags": [],
  "method": "get",
  "path": "/sandboxes/pool"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
