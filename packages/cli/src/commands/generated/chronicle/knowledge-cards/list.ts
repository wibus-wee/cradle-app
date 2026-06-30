import { registerOperationCommand } from '../../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "chronicle",
    "knowledge-cards",
    "list"
  ],
  "description": "List Chronicle knowledge cards",
  "flags": [
    {
      "name": "limit",
      "required": false,
      "target": "query.limit",
      "type": "number"
    },
    {
      "name": "dimension",
      "required": false,
      "target": "query.dimension",
      "type": "string",
      "values": [
        "technical",
        "business",
        "personal",
        "project",
        "general"
      ]
    },
    {
      "name": "type",
      "required": false,
      "target": "query.type",
      "type": "string",
      "values": [
        "fact",
        "insight",
        "decision",
        "task",
        "pattern"
      ]
    },
    {
      "name": "includeDeleted",
      "required": false,
      "target": "query.includeDeleted",
      "type": "boolean"
    }
  ],
  "method": "get",
  "path": "/chronicle/knowledge-cards"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
