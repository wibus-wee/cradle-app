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
    "board",
    "update"
  ],
  "description": "Update Kanban board",
  "flags": [
    {
      "name": "name",
      "required": false,
      "target": "body.name",
      "type": "string"
    },
    {
      "name": "filterConfig",
      "required": false,
      "target": "body.filterConfig",
      "type": "string"
    }
  ],
  "method": "patch",
  "path": "/kanban/boards/{id}"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
