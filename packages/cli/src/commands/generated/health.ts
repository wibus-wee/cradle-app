import { registerOperationCommand } from '../../runtime/operation-command'
import type { CliOperationSpec } from '../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "health"
  ],
  "description": "Health check",
  "flags": [],
  "method": "get",
  "path": "/health"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
