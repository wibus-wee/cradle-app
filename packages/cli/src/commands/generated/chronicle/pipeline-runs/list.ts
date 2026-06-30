import { registerOperationCommand } from '../../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "chronicle",
    "pipeline-runs",
    "list"
  ],
  "description": "List Chronicle activity pipeline runs",
  "flags": [
    {
      "name": "limit",
      "required": false,
      "target": "query.limit",
      "type": "number"
    }
  ],
  "method": "get",
  "path": "/chronicle/pipeline-runs"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
