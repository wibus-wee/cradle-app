import { registerOperationCommand } from '../../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "chronicle",
    "privacy",
    "export"
  ],
  "description": "Export Chronicle data with privacy redaction",
  "flags": [
    {
      "description": "Defaults to the workspace for your current directory, then CRADLE_WORKSPACE_ID.",
      "name": "workspaceId",
      "required": false,
      "target": "body.workspaceId",
      "type": "string",
      "flagName": "workspace",
      "resolver": "workspace",
      "resolverAmbient": true
    },
    {
      "name": "limit",
      "required": false,
      "target": "body.limit",
      "type": "number"
    },
    {
      "name": "includeMemories",
      "required": false,
      "target": "body.includeMemories",
      "type": "boolean"
    },
    {
      "name": "includeMessages",
      "required": false,
      "target": "body.includeMessages",
      "type": "boolean"
    },
    {
      "name": "includeAudioTranscripts",
      "required": false,
      "target": "body.includeAudioTranscripts",
      "type": "boolean"
    },
    {
      "name": "includeSnapshots",
      "required": false,
      "target": "body.includeSnapshots",
      "type": "boolean"
    },
    {
      "name": "outputFormat",
      "required": false,
      "target": "body.outputFormat",
      "type": "string",
      "values": [
        "markdown",
        "json"
      ]
    }
  ],
  "method": "post",
  "path": "/chronicle/privacy/export"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
