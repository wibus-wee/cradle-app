import { registerOperationCommand } from '../../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [
    {
      "name": "id",
      "required": true,
      "target": "path.id",
      "type": "string"
    },
    {
      "name": "runId",
      "required": true,
      "target": "path.runId",
      "type": "string"
    }
  ],
  "command": [
    "automation",
    "run",
    "stop"
  ],
  "description": "Stop automation run",
  "flags": [],
  "method": "post",
  "path": "/automations/{id}/runs/{runId}/stop"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
