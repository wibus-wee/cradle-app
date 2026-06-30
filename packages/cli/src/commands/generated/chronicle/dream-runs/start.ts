import { registerOperationCommand } from '../../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "chronicle",
    "dream-runs",
    "start"
  ],
  "description": "Start a Chronicle dream merge run",
  "flags": [
    {
      "name": "runType",
      "required": false,
      "target": "body.runType",
      "type": "string",
      "values": [
        "archive",
        "merge",
        "prune",
        "restore",
        "dry-run"
      ]
    },
    {
      "name": "dryRun",
      "required": false,
      "target": "body.dryRun",
      "type": "boolean"
    },
    {
      "name": "limit",
      "required": false,
      "target": "body.limit",
      "type": "number"
    },
    {
      "name": "similarityThreshold",
      "required": false,
      "target": "body.similarityThreshold",
      "type": "number"
    },
    {
      "name": "applyMerge",
      "required": false,
      "target": "body.applyMerge",
      "type": "boolean"
    },
    {
      "name": "olderThanDays",
      "required": false,
      "target": "body.olderThanDays",
      "type": "number"
    },
    {
      "name": "knowledgeIds",
      "required": false,
      "target": "body.knowledgeIds",
      "type": "string[]"
    }
  ],
  "method": "post",
  "path": "/chronicle/dream-runs"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
