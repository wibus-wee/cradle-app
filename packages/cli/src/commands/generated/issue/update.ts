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
    "issue",
    "update"
  ],
  "description": "Update issue",
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
      "name": "title",
      "required": false,
      "target": "body.title",
      "type": "string"
    },
    {
      "name": "description",
      "required": false,
      "target": "body.description",
      "type": "string"
    },
    {
      "name": "priority",
      "required": false,
      "target": "body.priority",
      "type": "string",
      "values": [
        "none",
        "low",
        "medium",
        "high",
        "urgent"
      ]
    },
    {
      "name": "labels",
      "required": false,
      "target": "body.labels",
      "type": "string[]"
    },
    {
      "name": "milestoneId",
      "required": false,
      "target": "body.milestoneId",
      "type": "string"
    },
    {
      "name": "parentIssueId",
      "required": false,
      "target": "body.parentIssueId",
      "type": "string"
    },
    {
      "name": "statusId",
      "required": false,
      "target": "body.statusId",
      "type": "string"
    },
    {
      "name": "statusName",
      "required": false,
      "target": "body.statusName",
      "type": "string"
    },
    {
      "name": "assigneeKind",
      "required": false,
      "target": "body.assigneeKind",
      "type": "string"
    },
    {
      "name": "assigneeId",
      "required": false,
      "target": "body.assigneeId",
      "type": "string"
    },
    {
      "name": "dueDate",
      "required": false,
      "target": "body.dueDate",
      "type": "number"
    },
    {
      "name": "order",
      "required": false,
      "target": "body.order",
      "type": "number"
    }
  ],
  "method": "patch",
  "path": "/issues/{id}"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
