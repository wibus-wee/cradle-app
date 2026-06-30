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
    "restore-version"
  ],
  "description": "Restore a Chronicle knowledge card version",
  "flags": [
    {
      "name": "version",
      "required": true,
      "target": "body.version",
      "type": "number"
    }
  ],
  "method": "post",
  "path": "/chronicle/knowledge-cards/{knowledgeId}/versions/restore"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
