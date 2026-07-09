import { registerOperationCommand } from '../../../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [
    {
      "description": "Defaults to the workspace for your current directory, then CRADLE_WORKSPACE_ID.",
      "name": "workspaceId",
      "required": true,
      "target": "path.workspaceId",
      "type": "string",
      "flagName": "workspace",
      "resolver": "workspace",
      "resolverAmbient": true
    },
    {
      "name": "reviewId",
      "required": true,
      "target": "path.reviewId",
      "type": "string"
    }
  ],
  "command": [
    "workspace",
    "diffs",
    "guide",
    "generate"
  ],
  "description": "Generate a diff change walkthrough",
  "flags": [
    {
      "name": "providerTargetId",
      "required": true,
      "target": "body.providerTargetId",
      "type": "string"
    },
    {
      "name": "runtimeKind",
      "required": false,
      "target": "body.runtimeKind",
      "type": "string"
    },
    {
      "name": "modelId",
      "required": false,
      "target": "body.modelId",
      "type": "string"
    },
    {
      "name": "force",
      "required": false,
      "target": "body.force",
      "type": "boolean"
    },
    {
      "name": "outputLocale",
      "required": false,
      "target": "body.outputLocale",
      "type": "string",
      "values": [
        "en-US",
        "zh-CN",
        "ja-JP",
        "es-ES"
      ]
    }
  ],
  "method": "post",
  "path": "/workspaces/{workspaceId}/diff-reviews/{reviewId}/guide/generate"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
