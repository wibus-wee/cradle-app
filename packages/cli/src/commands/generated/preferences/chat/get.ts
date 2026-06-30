import { registerOperationCommand } from '../../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "preferences",
    "chat",
    "get"
  ],
  "description": "Get chat preferences",
  "flags": [],
  "method": "get",
  "path": "/preferences/chat"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
