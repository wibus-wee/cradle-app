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
      "name": "index",
      "required": true,
      "target": "path.index",
      "type": "string"
    }
  ],
  "command": [
    "issue",
    "context-ref",
    "remove"
  ],
  "description": "Remove issue context ref",
  "flags": [],
  "method": "delete",
  "path": "/issues/{id}/context-refs/{index}"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
