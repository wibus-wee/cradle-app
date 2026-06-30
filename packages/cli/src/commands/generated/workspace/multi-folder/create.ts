import { registerOperationCommand } from '../../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "workspace",
    "multi-folder",
    "create"
  ],
  "description": "Create multi-folder workspace",
  "flags": [
    {
      "name": "name",
      "required": true,
      "target": "body.name",
      "type": "string"
    },
    {
      "name": "folders",
      "required": true,
      "target": "body.folders",
      "type": "json"
    }
  ],
  "method": "post",
  "path": "/workspaces/multi-folder"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
