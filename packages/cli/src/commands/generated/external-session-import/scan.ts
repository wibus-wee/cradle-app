import { registerOperationCommand } from '../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "external-session-import",
    "scan"
  ],
  "description": "Discover importable external Claude, Codex, Kimi, and OpenCode sessions",
  "flags": [
    {
      "name": "sourceHostId",
      "required": false,
      "target": "body.sourceHostId",
      "type": "string"
    },
    {
      "name": "sourceApps",
      "required": false,
      "target": "body.sourceApps",
      "type": "string[]"
    },
    {
      "name": "limitPerSource",
      "required": false,
      "target": "body.limitPerSource",
      "type": "number"
    }
  ],
  "method": "post",
  "path": "/external-session-import/scans"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
