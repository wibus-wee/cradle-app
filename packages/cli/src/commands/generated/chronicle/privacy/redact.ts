import { registerOperationCommand } from '../../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "chronicle",
    "privacy",
    "redact"
  ],
  "description": "Preview Chronicle privacy text redaction",
  "flags": [
    {
      "name": "text",
      "required": true,
      "target": "body.text",
      "type": "string"
    }
  ],
  "method": "post",
  "path": "/chronicle/privacy/redact"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
