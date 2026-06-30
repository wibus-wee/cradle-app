import { registerOperationCommand } from '../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "observability",
    "incidents"
  ],
  "description": "List observability incidents",
  "flags": [
    {
      "name": "dedupeKey",
      "required": false,
      "target": "query.dedupeKey",
      "type": "string"
    },
    {
      "name": "chatSessionId",
      "required": false,
      "target": "query.chatSessionId",
      "type": "string"
    },
    {
      "name": "runId",
      "required": false,
      "target": "query.runId",
      "type": "string"
    },
    {
      "name": "code",
      "required": false,
      "target": "query.code",
      "type": "string"
    },
    {
      "name": "status",
      "required": false,
      "target": "query.status",
      "type": "string",
      "values": [
        "open",
        "resolved"
      ]
    },
    {
      "name": "limit",
      "required": false,
      "target": "query.limit",
      "type": "string"
    }
  ],
  "method": "get",
  "path": "/observability/incidents"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
