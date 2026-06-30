import { registerOperationCommand } from '../../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "preferences",
    "desktop",
    "get"
  ],
  "description": "Get desktop preferences",
  "flags": [],
  "method": "get",
  "path": "/preferences/desktop"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
