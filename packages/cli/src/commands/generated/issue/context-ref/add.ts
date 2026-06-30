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
    }
  ],
  "command": [
    "issue",
    "context-ref",
    "add"
  ],
  "description": "Add issue context ref",
  "flags": [
    {
      "name": "ref",
      "required": true,
      "target": "body.ref",
      "type": "string"
    }
  ],
  "method": "post",
  "path": "/issues/{id}/context-refs"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
