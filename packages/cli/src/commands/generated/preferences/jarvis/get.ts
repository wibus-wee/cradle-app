import { registerOperationCommand } from '../../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "preferences",
    "jarvis",
    "get"
  ],
  "description": "Get Jarvis preferences",
  "flags": [],
  "method": "get",
  "path": "/preferences/jarvis"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
