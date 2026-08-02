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
    "set"
  ],
  "description": "Create or update a manual provider target",
  "flags": [
    {
      "name": "displayName",
      "required": true,
      "target": "body.displayName",
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
      "required": false,
      "target": "body.enabled",
      "type": "boolean"
    },
    {
      "name": "connectionConfig",
      "required": true,
      "target": "body.connectionConfig",
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
  "path": "/provider-targets/{providerTargetId}"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
