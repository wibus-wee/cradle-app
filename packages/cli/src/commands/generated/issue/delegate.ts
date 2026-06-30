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
    "issue",
    "delegate"
  ],
  "description": "Delegate issue",
  "flags": [
    {
      "name": "agentId",
      "required": true,
      "target": "body.agentId",
      "type": "string"
    },
    {
      "name": "providerTargetId",
      "required": false,
      "target": "body.providerTargetId",
      "type": "string"
    }
  ],
  "method": "post",
  "path": "/issues/{id}/delegation"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
