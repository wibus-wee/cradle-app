import { registerOperationCommand } from '../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "download-center",
    "list"
  ],
  "description": "List download tasks",
  "flags": [
    {
      "name": "status",
      "required": false,
      "target": "query.status",
      "type": "string",
      "values": [
        "queued",
        "downloading",
        "verifying",
        "completed",
        "failed",
        "cancelled"
      ]
    },
    {
      "name": "ownerNamespace",
      "required": false,
      "target": "query.ownerNamespace",
      "type": "string"
    },
    {
      "name": "ownerResourceType",
      "required": false,
      "target": "query.ownerResourceType",
      "type": "string"
    },
    {
      "name": "ownerResourceId",
      "required": false,
      "target": "query.ownerResourceId",
      "type": "string"
    },
    {
      "name": "limit",
      "required": false,
      "target": "query.limit",
      "type": "string"
    }
  ],
  "method": "get",
  "path": "/download-center/tasks"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
