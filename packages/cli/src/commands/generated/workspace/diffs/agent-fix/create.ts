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
    "agent-fix",
    "create"
  ],
  "description": "Create diff review agent fix work order",
  "flags": [
    {
      "name": "threadId",
      "required": false,
      "target": "body.threadId",
      "type": "string"
    },
    {
      "name": "anchor",
      "required": false,
      "target": "body.anchor",
      "type": "json"
    },
    {
      "name": "instruction",
      "required": true,
      "target": "body.instruction",
      "type": "string"
    },
    {
      "name": "agentId",
      "required": false,
      "target": "body.agentId",
      "type": "string"
    },
    {
      "name": "expectedOutput",
      "required": true,
      "target": "body.expectedOutput",
      "type": "string",
      "values": [
        "commit",
        "working-tree-change",
        "patch-artifact"
      ]
    }
  ],
  "method": "post",
  "path": "/workspaces/{workspaceId}/diff-reviews/{reviewId}/agent-fixes"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
