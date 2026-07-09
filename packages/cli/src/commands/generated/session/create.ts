import { registerOperationCommand } from '../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "session",
    "create"
  ],
  "description": "Create session",
  "flags": [
    {
      "description": "Defaults to the workspace for your current directory, then CRADLE_WORKSPACE_ID.",
      "name": "workspaceId",
      "required": false,
      "target": "body.workspaceId",
      "type": "string",
      "flagName": "workspace",
      "resolver": "workspace",
      "resolverAmbient": true
    },
    {
      "name": "title",
      "required": true,
      "target": "body.title",
      "type": "string"
    },
    {
      "name": "origin",
      "required": false,
      "target": "body.origin",
      "type": "string"
    },
    {
      "name": "providerTargetId",
      "required": false,
      "target": "body.providerTargetId",
      "type": "string"
    },
    {
      "name": "modelId",
      "required": false,
      "target": "body.modelId",
      "type": "string"
    },
    {
      "name": "agentId",
      "required": false,
      "target": "body.agentId",
      "type": "string"
    },
    {
      "name": "runtimeKind",
      "required": false,
      "target": "body.runtimeKind",
      "type": "string"
    },
    {
      "name": "runtimeSettings",
      "required": false,
      "target": "body.runtimeSettings",
      "type": "json"
    },
    {
      "name": "thinkingEffort",
      "required": false,
      "target": "body.thinkingEffort",
      "type": "string",
      "values": [
        "none",
        "minimal",
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ]
    },
    {
      "name": "linkedIssueId",
      "required": false,
      "target": "body.linkedIssueId",
      "type": "string"
    },
    {
      "name": "sessionGroupId",
      "required": false,
      "target": "body.sessionGroupId",
      "type": "string"
    },
    {
      "name": "worktreeId",
      "required": false,
      "target": "body.worktreeId",
      "type": "string"
    },
    {
      "name": "id",
      "required": false,
      "target": "body.id",
      "type": "string"
    }
  ],
  "method": "post",
  "path": "/sessions/"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
