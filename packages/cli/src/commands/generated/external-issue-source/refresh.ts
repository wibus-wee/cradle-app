import { registerOperationCommand } from '../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [
    {
      "name": "bindingId",
      "required": true,
      "target": "path.bindingId",
      "type": "string"
    }
  ],
  "command": [
    "external-issue-source",
    "refresh"
  ],
  "description": "Refresh an external issue source binding",
  "flags": [
    {
      "name": "force",
      "required": false,
      "target": "body.force",
      "type": "boolean"
    }
  ],
  "method": "post",
  "path": "/external-issue-sources/bindings/{bindingId}/refresh"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
