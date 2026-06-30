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
    "set"
  ],
  "description": "Create or update profile",
  "flags": [
    {
      "name": "name",
      "required": true,
      "target": "body.name",
      "type": "string"
    },
    {
      "name": "providerKind",
      "required": true,
      "target": "body.providerKind",
      "type": "string",
      "values": [
        "openai-compatible",
        "anthropic",
        "universal"
      ]
    },
    {
      "name": "enabled",
      "required": true,
      "target": "body.enabled",
      "type": "boolean"
    },
    {
      "name": "config",
      "required": true,
      "target": "body.config",
      "type": "json"
    },
    {
      "name": "credentialRef",
      "required": false,
      "target": "body.credentialRef",
      "type": "string"
    },
    {
      "name": "iconSlug",
      "required": false,
      "target": "body.iconSlug",
      "type": "string"
    }
  ],
  "method": "put",
  "path": "/profiles/{id}"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
