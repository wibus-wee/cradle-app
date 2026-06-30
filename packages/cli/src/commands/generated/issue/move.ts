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
    },
    {
      "description": "Issue status name or slug, for example \"In Progress\" or \"in_progress\".",
      "name": "statusName",
      "required": true,
      "target": "path.statusName",
      "type": "string"
    }
  ],
  "command": [
    "issue",
    "move"
  ],
  "description": "Move issue to status by name",
  "flags": [],
  "method": "patch",
  "path": "/issues/{id}/status/{statusName}"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
