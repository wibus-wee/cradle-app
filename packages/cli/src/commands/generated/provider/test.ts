import { registerOperationCommand } from '../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [
    {
      "name": "providerTargetId",
      "required": true,
      "target": "path.providerTargetId",
      "type": "string"
    }
  ],
  "command": [
    "provider",
    "test"
  ],
  "description": "Test provider connection",
  "flags": [
    {
      "name": "deep",
      "required": false,
      "target": "body.deep",
      "type": "boolean"
    },
    {
      "name": "model",
      "required": false,
      "target": "body.model",
      "type": "string"
    }
  ],
  "method": "post",
  "path": "/provider-targets/{providerTargetId}/test"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
