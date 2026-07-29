import { registerOperationCommand } from '../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "usage",
    "performance"
  ],
  "description": "Get cross-runtime latency and completion timing",
  "flags": [
    {
      "name": "from",
      "required": false,
      "target": "query.from",
      "type": "string"
    },
    {
      "name": "to",
      "required": false,
      "target": "query.to",
      "type": "string"
    }
  ],
  "method": "get",
  "path": "/usage/performance"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
