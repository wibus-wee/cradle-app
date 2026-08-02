import { registerOperationCommand } from '../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [
    {
      "name": "providerTargetId",
      "required": true,
      "target": "path.providerTargetId",
      "type": "string"
    }
  ],
  "command": [
    "provider",
    "delete"
  ],
  "description": "Delete provider target",
  "flags": [],
  "method": "delete",
  "path": "/provider-targets/{providerTargetId}"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
