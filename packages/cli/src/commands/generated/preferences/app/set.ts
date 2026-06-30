import { registerOperationCommand } from '../../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "preferences",
    "app",
    "set"
  ],
  "description": "Set app preferences",
  "flags": [
    {
      "name": "featureFlags",
      "required": true,
      "target": "body.featureFlags",
      "type": "json"
    }
  ],
  "method": "put",
  "path": "/preferences/app"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
