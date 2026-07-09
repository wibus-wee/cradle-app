import { registerOperationCommand } from '../../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "chronicle",
    "config",
    "set"
  ],
  "description": "Update Chronicle daemon configuration",
  "flags": [
    {
      "name": "profileId",
      "required": true,
      "target": "body.profileId",
      "type": "string"
    },
    {
      "name": "modelId",
      "required": true,
      "target": "body.modelId",
      "type": "string"
    },
    {
      "description": "Defaults to the workspace for your current directory, then CRADLE_WORKSPACE_ID.",
      "name": "workspaceId",
      "required": true,
      "target": "body.workspaceId",
      "type": "string",
      "flagName": "workspace",
      "resolver": "workspace",
      "resolverAmbient": true
    },
    {
      "name": "enabled",
      "required": true,
      "target": "body.enabled",
      "type": "boolean"
    },
    {
      "name": "activityPipelineEnabled",
      "required": true,
      "target": "body.activityPipelineEnabled",
      "type": "boolean"
    },
    {
      "name": "activityPipelineIntervalMs",
      "required": true,
      "target": "body.activityPipelineIntervalMs",
      "type": "number"
    },
    {
      "name": "activityPipelineBatchSize",
      "required": true,
      "target": "body.activityPipelineBatchSize",
      "type": "number"
    },
    {
      "name": "dreamSchedulerEnabled",
      "required": false,
      "target": "body.dreamSchedulerEnabled",
      "type": "boolean"
    },
    {
      "name": "dreamSchedulerIntervalMs",
      "required": false,
      "target": "body.dreamSchedulerIntervalMs",
      "type": "number"
    },
    {
      "name": "dreamSchedulerApplyMerge",
      "required": false,
      "target": "body.dreamSchedulerApplyMerge",
      "type": "boolean"
    },
    {
      "name": "audioCaptureEnabled",
      "required": true,
      "target": "body.audioCaptureEnabled",
      "type": "boolean"
    },
    {
      "name": "audioSource",
      "required": false,
      "target": "body.audioSource",
      "type": "string",
      "values": [
        "microphone",
        "system",
        "mixed"
      ]
    },
    {
      "name": "audioSegmentMs",
      "required": true,
      "target": "body.audioSegmentMs",
      "type": "number"
    },
    {
      "name": "audioSegmentIntervalMs",
      "required": true,
      "target": "body.audioSegmentIntervalMs",
      "type": "number"
    },
    {
      "name": "audioRmsThreshold",
      "required": true,
      "target": "body.audioRmsThreshold",
      "type": "number"
    },
    {
      "name": "storageRoot",
      "required": true,
      "target": "body.storageRoot",
      "type": "string"
    },
    {
      "name": "privacySensitiveAppBundleIds",
      "required": false,
      "target": "body.privacySensitiveAppBundleIds",
      "type": "string[]"
    },
    {
      "name": "privacySensitiveTitlePatterns",
      "required": false,
      "target": "body.privacySensitiveTitlePatterns",
      "type": "string[]"
    },
    {
      "name": "privacySensitiveUrlPatterns",
      "required": false,
      "target": "body.privacySensitiveUrlPatterns",
      "type": "string[]"
    },
    {
      "name": "closedEyesDiscardEnabled",
      "required": false,
      "target": "body.closedEyesDiscardEnabled",
      "type": "boolean"
    },
    {
      "name": "closedEyesMode",
      "required": false,
      "target": "body.closedEyesMode",
      "type": "string",
      "values": [
        "auto",
        "always-record",
        "always-pause"
      ]
    }
  ],
  "method": "put",
  "path": "/chronicle/config"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
