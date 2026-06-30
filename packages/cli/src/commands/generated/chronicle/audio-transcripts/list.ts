import { registerOperationCommand } from '../../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "chronicle",
    "audio-transcripts",
    "list"
  ],
  "description": "List Chronicle audio transcripts",
  "flags": [
    {
      "name": "limit",
      "required": false,
      "target": "query.limit",
      "type": "number"
    }
  ],
  "method": "get",
  "path": "/chronicle/audio-transcripts"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
