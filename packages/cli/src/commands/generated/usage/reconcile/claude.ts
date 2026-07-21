import { registerOperationCommand } from '../../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "usage",
    "reconcile",
    "claude"
  ],
  "description": "Backfill completed Claude usage from Cradle-owned transcripts",
  "flags": [
    {
      "name": "maxBindings",
      "required": false,
      "target": "query.maxBindings",
      "type": "string"
    }
  ],
  "method": "post",
  "path": "/usage/reconcile/claude"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
