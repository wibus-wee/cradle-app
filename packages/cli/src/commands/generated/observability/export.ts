import { registerOperationCommand } from '../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "observability",
    "export"
  ],
  "description": "Export observability bundle",
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
      "name": "sinceUnix",
      "required": false,
      "target": "query.sinceUnix",
      "type": "string"
    }
  ],
  "method": "get",
  "path": "/observability/export"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
