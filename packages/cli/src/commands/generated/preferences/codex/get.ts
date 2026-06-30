import { registerOperationCommand } from '../../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "preferences",
    "codex",
    "get"
  ],
  "description": "Get Codex preferences",
  "flags": [],
  "method": "get",
  "path": "/preferences/codex"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
