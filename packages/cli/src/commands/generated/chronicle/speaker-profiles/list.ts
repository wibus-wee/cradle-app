import { registerOperationCommand } from '../../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "chronicle",
    "speaker-profiles",
    "list"
  ],
  "description": "List Chronicle speaker profiles learned from transcripts",
  "flags": [],
  "method": "get",
  "path": "/chronicle/speaker-profiles"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
