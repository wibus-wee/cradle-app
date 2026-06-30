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
    "trace",
    "run"
  ],
  "description": "Get chat stream trace records for a run",
  "flags": [],
  "method": "get",
  "path": "/chat/runs/{runId}/trace"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
