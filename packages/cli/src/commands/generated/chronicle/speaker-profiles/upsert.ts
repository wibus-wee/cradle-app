import { registerOperationCommand } from '../../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "chronicle",
    "speaker-profiles",
    "upsert"
  ],
  "description": "Create or update a Chronicle speaker profile",
  "flags": [
    {
      "name": "displayName",
      "required": true,
      "target": "body.displayName",
      "type": "string"
    },
    {
      "name": "aliases",
      "required": false,
      "target": "body.aliases",
      "type": "string[]"
    },
    {
      "name": "embedding",
      "required": false,
      "target": "body.embedding",
      "type": "string[]"
    },
    {
      "name": "embeddingModelId",
      "required": false,
      "target": "body.embeddingModelId",
      "type": "string"
    },
    {
      "name": "sampleCount",
      "required": false,
      "target": "body.sampleCount",
      "type": "number"
    },
    {
      "name": "lastSeenAt",
      "required": false,
      "target": "body.lastSeenAt",
      "type": "string"
    },
    {
      "name": "metadata",
      "required": false,
      "target": "body.metadata",
      "type": "json"
    }
  ],
  "method": "post",
  "path": "/chronicle/speaker-profiles"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
