import { registerOperationCommand } from '../../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [
    {
      "name": "knowledgeId",
      "required": true,
      "target": "path.knowledgeId",
      "type": "string"
    }
  ],
  "command": [
    "chronicle",
    "knowledge-cards",
    "delete"
  ],
  "description": "Delete a Chronicle knowledge card",
  "flags": [],
  "method": "delete",
  "path": "/chronicle/knowledge-cards/{knowledgeId}"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
