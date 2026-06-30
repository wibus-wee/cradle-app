import { registerOperationCommand } from '../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [
    {
      "name": "id",
      "required": true,
      "target": "path.id",
      "type": "string"
    }
  ],
  "command": [
    "profile",
    "custom-models"
  ],
  "description": "Update custom models for a profile",
  "flags": [
    {
      "name": "models",
      "required": true,
      "target": "body.models",
      "type": "json"
    }
  ],
  "method": "patch",
  "path": "/profiles/{id}/custom-models"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
