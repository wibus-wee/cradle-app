import { registerOperationCommand } from '../../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "preferences",
    "keybindings",
    "get"
  ],
  "description": "Get keybindings configuration",
  "flags": [],
  "method": "get",
  "path": "/preferences/keybindings"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
