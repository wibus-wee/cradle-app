import { registerOperationCommand } from '../../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "preferences",
    "codex",
    "set"
  ],
  "description": "Set Codex preferences",
  "flags": [
    {
      "name": "useCradleUserAgent",
      "required": true,
      "target": "body.useCradleUserAgent",
      "type": "boolean"
    }
  ],
  "method": "put",
  "path": "/preferences/codex"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
