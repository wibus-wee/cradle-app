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
    "versions"
  ],
  "description": "List Chronicle knowledge card versions",
  "flags": [],
  "method": "get",
  "path": "/chronicle/knowledge-cards/{knowledgeId}/versions"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
