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
    "triage"
  ],
  "description": "Update automation run triage state",
  "flags": [
    {
      "name": "status",
      "required": true,
      "target": "body.status",
      "type": "string",
      "values": [
        "unread",
        "read",
        "resolved",
        "archived"
      ]
    }
  ],
  "method": "patch",
  "path": "/automations/{id}/runs/{runId}/triage"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
