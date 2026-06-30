import { registerOperationCommand } from '../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "observability",
    "events"
  ],
  "description": "List observability events",
  "flags": [
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
      "name": "severity",
      "required": false,
      "target": "query.severity",
      "type": "string"
    },
    {
      "name": "since",
      "required": false,
      "target": "query.since",
      "type": "string"
    },
    {
      "name": "until",
      "required": false,
      "target": "query.until",
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
  "path": "/observability/events"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
