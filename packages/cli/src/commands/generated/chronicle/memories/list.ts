import { registerOperationCommand } from '../../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "chronicle",
    "memories",
    "list"
  ],
  "description": "Get Chronicle AI memories/summaries",
  "flags": [
    {
      "name": "limit",
      "required": false,
      "target": "query.limit",
      "type": "number"
    }
  ],
  "method": "get",
  "path": "/chronicle/memories"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
