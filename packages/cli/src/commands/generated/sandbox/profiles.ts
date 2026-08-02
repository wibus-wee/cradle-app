import { registerOperationCommand } from '../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "sandbox",
    "profiles"
  ],
  "description": "List sandbox profiles",
  "flags": [],
  "method": "get",
  "path": "/sandboxes/profiles"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
