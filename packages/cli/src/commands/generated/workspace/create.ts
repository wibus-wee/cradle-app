import { registerOperationCommand } from '../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "workspace",
    "create"
  ],
  "description": "Create workspace",
  "flags": [
    {
      "name": "name",
      "required": true,
      "target": "body.name",
      "type": "string"
    },
    {
      "name": "locator",
      "required": true,
      "target": "body.locator",
      "type": "json"
    },
    {
      "name": "gitIdentity",
      "required": false,
      "target": "body.gitIdentity",
      "type": "json"
    }
  ],
  "method": "post",
  "path": "/workspaces"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
