import { registerOperationCommand } from '../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "observability",
    "error-patterns"
  ],
  "description": "List observability error patterns",
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
      "name": "runtimeKind",
      "required": false,
      "target": "query.runtimeKind",
      "type": "string"
    },
    {
      "name": "providerTargetId",
      "required": false,
      "target": "query.providerTargetId",
      "type": "string"
    },
    {
      "name": "sinceUnix",
      "required": false,
      "target": "query.sinceUnix",
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
  "path": "/observability/error-patterns"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
