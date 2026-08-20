import { registerOperationCommand } from '../../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../../runtime/types'
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
    "extension",
    "set"
  ],
  "description": "Enable or disable a Provider extension",
  "flags": [
    {
      "name": "owner",
      "required": true,
      "target": "body.owner",
      "type": "string"
    },
    {
      "name": "id",
      "required": true,
      "target": "body.id",
      "type": "string"
    },
    {
      "name": "enabled",
      "required": true,
      "target": "body.enabled",
      "type": "boolean"
    }
  ],
  "method": "put",
  "path": "/provider-targets/{providerTargetId}/extensions/"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
