import { registerOperationCommand } from '../../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "issue",
    "relation",
    "create"
  ],
  "description": "Create issue relation",
  "flags": [
    {
      "name": "sourceIssueId",
      "required": true,
      "target": "body.sourceIssueId",
      "type": "string"
    },
    {
      "name": "targetIssueId",
      "required": true,
      "target": "body.targetIssueId",
      "type": "string"
    },
    {
      "name": "type",
      "required": true,
      "target": "body.type",
      "type": "string",
      "values": [
        "blocks",
        "duplicates",
        "relates_to"
      ]
    }
  ],
  "method": "post",
  "path": "/issues/relations"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
