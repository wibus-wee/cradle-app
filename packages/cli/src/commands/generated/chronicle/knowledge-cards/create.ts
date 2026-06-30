import { registerOperationCommand } from '../../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "chronicle",
    "knowledge-cards",
    "create"
  ],
  "description": "Create a Chronicle knowledge card",
  "flags": [
    {
      "name": "title",
      "required": true,
      "target": "body.title",
      "type": "string"
    },
    {
      "name": "content",
      "required": true,
      "target": "body.content",
      "type": "string"
    },
    {
      "name": "cardType",
      "required": false,
      "target": "body.cardType",
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
      "name": "dimension",
      "required": false,
      "target": "body.dimension",
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
      "name": "confidence",
      "required": false,
      "target": "body.confidence",
      "type": "number"
    },
    {
      "name": "sourceMemoryIds",
      "required": false,
      "target": "body.sourceMemoryIds",
      "type": "string[]"
    },
    {
      "name": "sourceSegmentIds",
      "required": false,
      "target": "body.sourceSegmentIds",
      "type": "string[]"
    },
    {
      "name": "sourceChunkIds",
      "required": false,
      "target": "body.sourceChunkIds",
      "type": "string[]"
    },
    {
      "name": "tags",
      "required": false,
      "target": "body.tags",
      "type": "string[]"
    },
    {
      "name": "stableKey",
      "required": false,
      "target": "body.stableKey",
      "type": "string"
    },
    {
      "name": "pinned",
      "required": false,
      "target": "body.pinned",
      "type": "boolean"
    },
    {
      "name": "metadata",
      "required": false,
      "target": "body.metadata",
      "type": "json"
    }
  ],
  "method": "post",
  "path": "/chronicle/knowledge-cards"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
