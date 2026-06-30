import { registerOperationCommand } from '../../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [
    {
      "name": "runId",
      "required": true,
      "target": "path.runId",
      "type": "string"
    }
  ],
  "command": [
    "chat",
    "snapshot",
    "run"
  ],
  "description": "Get durable chat run snapshot",
  "flags": [],
  "method": "get",
  "path": "/chat/runs/{runId}/snapshot"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
