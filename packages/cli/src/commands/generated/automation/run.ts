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
    "automation",
    "run"
  ],
  "description": "Run automation now",
  "flags": [
    {
      "name": "occurrenceKey",
      "required": false,
      "target": "body.occurrenceKey",
      "type": "string"
    },
    {
      "name": "scheduledFor",
      "required": false,
      "target": "body.scheduledFor",
      "type": "number"
    }
  ],
  "method": "post",
  "path": "/automations/{id}/run"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
