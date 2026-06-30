import { registerOperationCommand } from '../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [
    {
      "name": "agentSessionId",
      "required": true,
      "target": "path.agentSessionId",
      "type": "string"
    }
  ],
  "command": [
    "issue-agent-session",
    "activities"
  ],
  "description": "List activities",
  "flags": [],
  "method": "get",
  "path": "/issue-agent-sessions/{agentSessionId}/activities"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
