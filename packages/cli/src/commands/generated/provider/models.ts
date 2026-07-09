import { registerOperationCommand } from '../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "provider",
    "models"
  ],
  "description": "List models for a provider",
  "flags": [
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
      "name": "label",
      "required": true,
      "target": "body.label",
      "type": "string"
    },
    {
      "name": "config",
      "required": true,
      "target": "body.config",
      "type": "json"
    },
    {
      "name": "secretRef",
      "required": false,
      "target": "body.secretRef",
      "type": "string"
    },
    {
      "name": "profileId",
      "required": false,
      "target": "body.profileId",
      "type": "string"
    },
    {
      "name": "providerTargetKind",
      "required": false,
      "target": "body.providerTargetKind",
      "type": "string",
      "values": [
        "manual",
        "external"
      ]
    },
    {
      "name": "providerTargetId",
      "required": false,
      "target": "body.providerTargetId",
      "type": "string"
    },
    {
      "description": "Defaults to the workspace for your current directory, then CRADLE_WORKSPACE_ID.",
      "name": "workspaceId",
      "required": false,
      "target": "body.workspaceId",
      "type": "string",
      "flagName": "workspace",
      "resolver": "workspace",
      "resolverAmbient": true
    }
  ],
  "method": "post",
  "path": "/providers/models"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
