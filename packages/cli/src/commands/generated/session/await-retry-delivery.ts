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
    "session",
    "await-retry-delivery"
  ],
  "description": "Retry delivery for a failed session await",
  "flags": [
    {
      "name": "resumeText",
      "required": false,
      "target": "body.resumeText",
      "type": "string"
    },
    {
      "name": "resumePayloadJson",
      "required": false,
      "target": "body.resumePayloadJson",
      "type": "string"
    }
  ],
  "method": "post",
  "path": "/session-awaits/{id}/retry-delivery"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
