import { registerOperationCommand } from '../../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [
    {
      "name": "sourceId",
      "required": true,
      "target": "path.sourceId",
      "type": "string"
    }
  ],
  "command": [
    "chronicle",
    "audio-raw-segments",
    "processing-result"
  ],
  "description": "Record Chronicle raw audio processing results",
  "flags": [
    {
      "name": "status",
      "required": false,
      "target": "body.status",
      "type": "string",
      "values": [
        "captured",
        "queued",
        "processed",
        "ignored",
        "error"
      ]
    },
    {
      "name": "vadStatus",
      "required": false,
      "target": "body.vadStatus",
      "type": "string",
      "values": [
        "not-implemented",
        "pending",
        "ready",
        "error"
      ]
    },
    {
      "name": "asrStatus",
      "required": false,
      "target": "body.asrStatus",
      "type": "string",
      "values": [
        "not-implemented",
        "pending",
        "ready",
        "error"
      ]
    },
    {
      "name": "speakerStatus",
      "required": false,
      "target": "body.speakerStatus",
      "type": "string",
      "values": [
        "not-implemented",
        "pending",
        "ready",
        "error"
      ]
    },
    {
      "name": "transcriptSourceId",
      "required": false,
      "target": "body.transcriptSourceId",
      "type": "string"
    },
    {
      "name": "speakerProfileIds",
      "required": false,
      "target": "body.speakerProfileIds",
      "type": "string[]"
    },
    {
      "name": "errorMessage",
      "required": false,
      "target": "body.errorMessage",
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
  "path": "/chronicle/audio-raw-segments/{sourceId}/processing-result"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
