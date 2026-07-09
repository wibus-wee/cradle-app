import { registerOperationCommand } from '../../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [
    {
      "description": "Defaults to CRADLE_CHAT_SESSION_ID.",
      "name": "id",
      "required": true,
      "target": "path.id",
      "type": "string",
      "envDefault": "CRADLE_CHAT_SESSION_ID"
    }
  ],
  "command": [
    "session",
    "pull-request",
    "create"
  ],
  "description": "Create a draft GitHub pull request for an isolated session",
  "flags": [
    {
      "name": "title",
      "required": true,
      "target": "body.title",
      "type": "string"
    },
    {
      "name": "body",
      "required": false,
      "target": "body.body",
      "type": "string"
    },
    {
      "name": "base",
      "required": false,
      "target": "body.base",
      "type": "string"
    }
  ],
  "method": "post",
  "path": "/sessions/{id}/pull-request"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
