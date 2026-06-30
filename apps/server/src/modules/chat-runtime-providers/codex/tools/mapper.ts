import type { BuiltinToolCallInputPayload, BuiltinToolCallResultPayload } from '../../tools/tool-call-payload'
import {
  createBuiltinToolCallInputPayload,
  createBuiltinToolCallResultPayload,
} from '../../tools/tool-call-payload'
import type { ReasoningEffort } from '../app-server-protocol/ReasoningEffort'
import type { JsonValue } from '../app-server-protocol/serde_json/JsonValue'
import type { CommandAction } from '../app-server-protocol/v2/CommandAction'
import type { CommandExecutionSource } from '../app-server-protocol/v2/CommandExecutionSource'
import type { McpToolCallError } from '../app-server-protocol/v2/McpToolCallError'
import type { McpToolCallResult } from '../app-server-protocol/v2/McpToolCallResult'
import type { SubAgentActivityKind } from '../app-server-protocol/v2/SubAgentActivityKind'
import type { WebSearchAction } from '../app-server-protocol/v2/WebSearchAction'
import { CodexToolIdentifier } from './identity'

export interface CodexAppServerItem {
  type: string
  id: string
  text?: string
  summary?: string[]
  content?: string[]
  command?: string
  cwd?: string
  processId?: string | null
  source?: CommandExecutionSource
  commandActions?: CommandAction[]
  aggregatedOutput?: string | null
  exitCode?: number | null
  durationMs?: number | null
  changes?: CodexFileChange[]
  status?: string
  server?: string
  tool?: string
  arguments?: JsonValue
  result?: McpToolCallResult | string | null
  error?: McpToolCallError | null
  mcpAppResourceUri?: string
  pluginId?: string | null
  namespace?: string | null
  success?: boolean | null
  contentItems?: Array<{ type: string, text?: string, imageUrl?: string }> | null
  senderThreadId?: string
  receiverThreadIds?: string[]
  agentsStates?: Record<string, { status: string, message?: string | null }>
  prompt?: string | null
  model?: string | null
  reasoningEffort?: ReasoningEffort | null
  kind?: SubAgentActivityKind
  agentThreadId?: string
  agentPath?: string
  query?: string
  action?: WebSearchAction | null
  turnId?: string
  planContent?: string
}

export interface CodexFileChange {
  path: string
  diff?: string | null
  kind?: unknown
}

interface CodexProjectedFileChangePatch {
  filenames: string[]
  gitDiff: {
    additions: number
    deletions: number
    patch: string
  }
  structuredPatch: Array<{ lines: string[] }>
}

export interface CodexAppServerServerRequestItem {
  method: string
  id: number
  params?: unknown
}

export function readCodexToolName(item: CodexAppServerItem): string {
  switch (item.type) {
    case 'commandExecution':
      return 'command_execution'
    case 'fileChange':
      return 'file_change'
    case 'mcpToolCall':
      return `${item.server ?? 'mcp'}/${item.tool ?? 'tool'}`
    case 'dynamicToolCall':
      return item.namespace ? `${item.namespace}/${item.tool ?? 'tool'}` : (item.tool ?? 'dynamic_tool')
    case 'collabAgentToolCall':
      return item.tool ?? 'collab_agent'
    case 'subAgentActivity':
      return 'sub_agent_activity'
    case 'webSearch':
      return 'web_search'
    case 'sleep':
      return 'sleep'
    case 'plan':
      return 'plan'
    case 'planImplementation':
      return 'plan_implementation'
    case 'imageView':
      return 'image_view'
    case 'imageGeneration':
      return 'image_generation'
    case 'enteredReviewMode':
      return 'review_mode_entered'
    case 'exitedReviewMode':
      return 'review_mode_exited'
    case 'contextCompaction':
      return 'context_compaction'
    default:
      return item.type
  }
}

export function buildCodexToolInput(item: CodexAppServerItem): BuiltinToolCallInputPayload {
  return createBuiltinToolCallInputPayload({
    identifier: CodexToolIdentifier,
    apiName: readCodexToolName(item),
    args: buildCodexToolArgs(item),
  })
}

export function buildCodexToolOutput(
  item: CodexAppServerItem,
  bufferedCommandOutput?: string,
  bufferedCommand?: string,
  args?: unknown,
): BuiltinToolCallResultPayload {
  return createBuiltinToolCallResultPayload({
    identifier: CodexToolIdentifier,
    apiName: readCodexToolName(item),
    args: args ?? buildCodexToolArgsWithBufferedCommand(item, bufferedCommand),
    result: buildCodexToolResult(item, bufferedCommandOutput, bufferedCommand),
  })
}

function buildCodexToolArgsWithBufferedCommand(item: CodexAppServerItem, bufferedCommand?: string): unknown {
  if (item.type === 'commandExecution') {
    return projectCodexCommandExecutionArgs(item, bufferedCommand)
  }
  return buildCodexToolArgs(item)
}

export function buildCodexToolArgs(item: CodexAppServerItem): unknown {
  switch (item.type) {
    case 'commandExecution':
      return projectCodexCommandExecutionArgs(item)
    case 'fileChange':
      return { filenames: readChangedPaths(item), status: item.status ?? 'started', type: item.type }
    case 'mcpToolCall':
      return item.arguments ?? { server: item.server, tool: item.tool }
    case 'dynamicToolCall':
      return item.arguments ?? {}
    case 'collabAgentToolCall':
      return {
        tool: item.tool,
        prompt: item.prompt,
        model: item.model,
        ...(item.reasoningEffort === undefined ? {} : { reasoningEffort: item.reasoningEffort }),
        senderThreadId: item.senderThreadId,
        receiverThreadIds: item.receiverThreadIds,
      }
    case 'subAgentActivity':
      return {
        ...(item.kind === undefined ? {} : { kind: item.kind }),
        ...(item.agentThreadId === undefined ? {} : { agentThreadId: item.agentThreadId }),
        ...(item.agentPath === undefined ? {} : { agentPath: item.agentPath }),
      }
    case 'webSearch':
      return { query: item.query ?? '', action: item.action }
    case 'sleep':
      return projectCodexDuration(item.durationMs)
    case 'plan':
      return { text: item.text ?? '' }
    case 'planImplementation':
      return { turnId: item.turnId ?? '', planContent: item.planContent ?? '' }
    case 'imageView':
      return { path: (item as { path?: string }).path ?? '' }
    case 'imageGeneration':
      return {
        status: item.status,
        revisedPrompt: (item as { revisedPrompt?: string | null }).revisedPrompt ?? null,
      }
    case 'enteredReviewMode':
    case 'exitedReviewMode':
      return { review: (item as { review?: string }).review ?? '' }
    case 'contextCompaction':
      return { id: item.id }
    default:
      return {}
  }
}

export function buildCodexToolResult(
  item: CodexAppServerItem,
  bufferedCommandOutput?: string,
  bufferedCommand?: string,
): unknown {
  switch (item.type) {
    case 'commandExecution':
      return {
        ...projectCodexCommandExecutionArgs(item, bufferedCommand),
        output: item.aggregatedOutput ?? bufferedCommandOutput ?? '',
        exitCode: item.exitCode ?? null,
        code: item.exitCode ?? null,
        ...projectCodexDuration(item.durationMs),
      }
    case 'fileChange':
      return {
        ...projectCodexFileChangePatch(item.changes),
        changes: item.changes ?? [],
        status: item.status ?? 'completed',
        type: item.type,
      }
    case 'mcpToolCall':
      if (item.result && typeof item.result !== 'string') {
        return {
          server: item.server,
          tool: item.tool,
          ...projectCodexMcpMetadata(item),
          result: item.result,
          content: item.result.content ?? null,
          ...('structuredContent' in item.result ? { structuredContent: item.result.structuredContent } : {}),
          ...('_meta' in item.result ? { _meta: item.result._meta } : {}),
        }
      }
      return {
        server: item.server,
        tool: item.tool,
        ...projectCodexMcpMetadata(item),
        result: item.result ?? null,
        content: null,
      }
    case 'dynamicToolCall':
      return {
        ...(item.namespace === undefined ? {} : { namespace: item.namespace }),
        tool: item.tool,
        status: item.status ?? (item.success === false ? 'failed' : 'completed'),
        success: item.success ?? item.status !== 'failed',
        ...projectCodexDuration(item.durationMs),
        contentItems: item.contentItems ?? null,
        contents: item.contentItems ?? [],
      }
    case 'collabAgentToolCall':
      return {
        tool: item.tool,
        status: item.status,
        agentsStates: item.agentsStates,
        receiverThreadIds: item.receiverThreadIds,
        ...(item.reasoningEffort === undefined ? {} : { reasoningEffort: item.reasoningEffort }),
      }
    case 'subAgentActivity':
      return {
        ...(item.kind === undefined ? {} : { kind: item.kind }),
        ...(item.agentThreadId === undefined ? {} : { agentThreadId: item.agentThreadId }),
        ...(item.agentPath === undefined ? {} : { agentPath: item.agentPath }),
      }
    case 'webSearch':
      return {
        query: item.query,
        action: item.action,
      }
    case 'sleep':
      return projectCodexDuration(item.durationMs)
    case 'plan':
      return { plan: item.text ?? '' }
    case 'planImplementation':
      return { turnId: item.turnId ?? '', planContent: item.planContent ?? '' }
    case 'imageView':
      return { path: (item as { path?: string }).path ?? '' }
    case 'imageGeneration':
      return {
        status: item.status,
        revisedPrompt: (item as { revisedPrompt?: string | null }).revisedPrompt ?? null,
        result: (item as { result?: string }).result ?? '',
        savedPath: (item as { savedPath?: string }).savedPath ?? null,
      }
    case 'enteredReviewMode':
    case 'exitedReviewMode':
      return { review: (item as { review?: string }).review ?? '' }
    case 'contextCompaction':
      return { id: item.id }
    default:
      return {}
  }
}

export function buildCodexServerRequestToolInput(request: CodexAppServerServerRequestItem): BuiltinToolCallInputPayload {
  return createBuiltinToolCallInputPayload({
    identifier: CodexToolIdentifier,
    apiName: readCodexServerRequestToolName(request.method),
    args: request.params ?? {},
  })
}

export function buildCodexServerRequestToolOutput(
  request: CodexAppServerServerRequestItem,
  result: unknown,
): BuiltinToolCallResultPayload {
  return createBuiltinToolCallResultPayload({
    identifier: CodexToolIdentifier,
    apiName: readCodexServerRequestToolName(request.method),
    args: request.params ?? {},
    result,
  })
}

export function readCodexServerRequestToolName(method: string): string {
  switch (method) {
    case 'item/commandExecution/requestApproval':
      return 'approval.command_execution'
    case 'item/fileChange/requestApproval':
      return 'approval.file_change'
    case 'item/tool/requestUserInput':
      return 'tool.request_user_input'
    case 'mcpServer/elicitation/request':
      return 'mcp.elicitation'
    case 'item/permissions/requestApproval':
      return 'approval.permissions'
    case 'item/tool/call':
      return 'dynamic_tool.call'
    case 'account/chatgptAuthTokens/refresh':
      return 'account.chatgpt_auth_tokens.refresh'
    case 'attestation/generate':
      return 'attestation.generate'
    case 'applyPatchApproval':
      return 'approval.apply_patch'
    case 'execCommandApproval':
      return 'approval.exec_command'
    default:
      return method
  }
}

export function readCodexToolError(item: CodexAppServerItem): string | null {
  if (item.error?.message) {
    return item.error.message
  }
  if (item.type === 'dynamicToolCall' && item.status === 'failed') {
    return 'Dynamic tool call failed'
  }
  return null
}

function readChangedPaths(item: CodexAppServerItem): string[] {
  return item.changes?.map(change => change.path) ?? []
}

function projectCodexCommandExecutionArgs(item: CodexAppServerItem, bufferedCommand?: string): {
  command: string
  cwd?: string
  processId?: string | null
  source?: CommandExecutionSource
  status?: string
  commandActions?: CommandAction[]
} {
  return {
    command: item.command ?? bufferedCommand ?? '',
    ...(item.cwd === undefined ? {} : { cwd: item.cwd }),
    ...(item.processId === undefined ? {} : { processId: item.processId }),
    ...(item.source === undefined ? {} : { source: item.source }),
    ...(item.status === undefined ? {} : { status: item.status }),
    ...(item.commandActions === undefined ? {} : { commandActions: item.commandActions }),
  }
}

function projectCodexMcpMetadata(item: CodexAppServerItem): {
  status?: string
  pluginId?: string | null
  mcpAppResourceUri?: string
  durationMs?: number | null
  durationSeconds?: number | null
  error?: McpToolCallError | null
} {
  return {
    ...(item.status === undefined ? {} : { status: item.status }),
    ...(item.pluginId === undefined ? {} : { pluginId: item.pluginId }),
    ...(item.mcpAppResourceUri === undefined ? {} : { mcpAppResourceUri: item.mcpAppResourceUri }),
    ...projectCodexDuration(item.durationMs),
    ...(item.error === undefined ? {} : { error: item.error }),
  }
}

function projectCodexDuration(durationMs: number | null | undefined): { durationMs?: number | null, durationSeconds?: number | null } {
  if (durationMs === undefined) {
    return {}
  }
  return {
    durationMs,
    durationSeconds: durationMs === null ? null : durationMs / 1000,
  }
}

export function projectCodexFileChangePatch(changes: readonly CodexFileChange[] = []): CodexProjectedFileChangePatch {
  const diffs = changes.flatMap(change =>
    typeof change.diff === 'string' && change.diff.length > 0 ? [change.diff] : [])
  const patch = diffs.join('\n')
  const { additions, deletions } = countUnifiedDiffLines(patch)
  return {
    filenames: changes.map(change => change.path),
    gitDiff: {
      additions,
      deletions,
      patch,
    },
    structuredPatch: diffs.map(diff => ({ lines: diff.split('\n') })),
  }
}

function countUnifiedDiffLines(diff: string): { additions: number, deletions: number } {
  return diff.split('\n').reduce((counts, line) => {
    if (line.startsWith('+++') || line.startsWith('---')) {
      return counts
    }
    if (line.startsWith('+')) {
      counts.additions += 1
    }
    else if (line.startsWith('-')) {
      counts.deletions += 1
    }
    return counts
  }, { additions: 0, deletions: 0 })
}
