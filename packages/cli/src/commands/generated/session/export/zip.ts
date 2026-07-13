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
    "session",
    "export",
    "zip"
  ],
  "description": "Export session as zip archive (session.json + transcript.md)",
  "flags": [],
  "method": "get",
  "path": "/sessions/{id}/export/zip"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
