import type { SimulatorExchange } from '@cradle/model-api-simulator'

import { anthropicParallelToolUsesExchange, anthropicTextExchange, anthropicToolUseExchange } from './anthropic'

/**
 * Declarative Claude Agent tool matrix. Each entry scripts one real `tool_use` turn;
 * the SDK executes the tool locally (harmlessly) and the scripted continuation turn —
 * matched on the tool-use id — closes the loop. The goal is one e2e path per canonical
 * `CradleToolKind` without any real API cost.
 */
export interface ToolMatrixEntry {
  /** Stable key used by the Gherkin Examples table. */
  key: string
  /** Wire `tool_use.name` as the model emits it. */
  wireName: string
  /** Canonical CradleToolKind the real mapper must classify this tool into (checked by check-tool-coverage). */
  expectedKind: string
  /** Fragment of the serialized tool input asserted inside the rendered block. */
  inputFragment: string
  toolInput: Record<string, unknown>
}

export const TOOL_MATRIX_ENTRIES: readonly ToolMatrixEntry[] = [
  {
    key: 'search-glob',
    wireName: 'Glob',
    expectedKind: 'search',
    inputFragment: 'e2e-tool-matrix',
    toolInput: { pattern: '**/*e2e-tool-matrix*' },
  },
  {
    key: 'search-grep',
    wireName: 'Grep',
    expectedKind: 'search',
    inputFragment: 'matrix-needle',
    toolInput: { pattern: 'matrix-needle', path: '.' },
  },
  {
    key: 'todo-todo-write',
    wireName: 'TodoWrite',
    expectedKind: 'todo',
    inputFragment: '矩阵待办',
    toolInput: {
      todos: [
        { content: '矩阵待办一', status: 'completed', activeForm: '完成矩阵待办一' },
        { content: '矩阵待办二', status: 'in_progress', activeForm: '进行矩阵待办二' },
      ],
    },
  },
  {
    key: 'todo-task-create',
    wireName: 'TaskCreate',
    expectedKind: 'todo',
    inputFragment: '矩阵任务创建',
    toolInput: { subject: '矩阵任务创建', description: '由工具矩阵场景创建' },
  },
  {
    key: 'web-web-fetch',
    wireName: 'WebFetch',
    expectedKind: 'web',
    inputFragment: 'https://example.com/e2e-tool-matrix',
    toolInput: { url: 'https://example.com/e2e-tool-matrix', prompt: '总结页面内容' },
  },
  {
    key: 'mcp-probe',
    wireName: 'mcp__e2e__probe',
    expectedKind: 'mcp',
    inputFragment: 'probe-target',
    toolInput: { target: 'probe-target' },
  },
  {
    key: 'generic-schedule-wakeup',
    wireName: 'ScheduleWakeup',
    expectedKind: 'generic',
    inputFragment: 'matrix-wakeup',
    toolInput: { delayMinutes: 1, reason: 'matrix-wakeup' },
  },
] as const

export function toolMatrixEntry(key: string): ToolMatrixEntry {
  const entry = TOOL_MATRIX_ENTRIES.find(candidate => candidate.key === key)
  if (!entry) {
    throw new Error(`Unknown tool matrix scenario: ${key}`)
  }
  return entry
}

const EXCLUDE_TITLE = 'You are naming a Claude Agent task session'
const USER_PROMPT = '请执行工具矩阵场景'

/** One scripted tool loop for a single matrix entry, matched on the user prompt. */
export function claudeAgentToolLoopExchanges(entry: ToolMatrixEntry): SimulatorExchange[] {
  const toolUseId = `toolu_e2e_matrix_${entry.key.replaceAll(/[^a-z0-9]+/gi, '_')}`
  return [
    anthropicToolUseExchange({
      label: `matrix-${entry.key}`,
      toolUseId,
      toolName: entry.wireName,
      toolInput: entry.toolInput,
      bodyTextIncludes: USER_PROMPT,
      bodyTextExcludes: EXCLUDE_TITLE,
    }),
    anthropicTextExchange({
      label: `matrix-${entry.key}-final`,
      text: `工具矩阵 ${entry.key} 完成`,
      bodyTextIncludes: toolUseId,
      bodyTextExcludes: EXCLUDE_TITLE,
    }),
  ]
}

/**
 * Parallel tool calls in a single assistant message: two search tools emitted as
 * concurrent content blocks with the second input split across incremental
 * `input_json_delta` frames.
 */
export function claudeAgentParallelToolsExchanges(): SimulatorExchange[] {
  const globId = 'toolu_e2e_matrix_parallel_glob'
  const grepId = 'toolu_e2e_matrix_parallel_grep'
  return [
    anthropicParallelToolUsesExchange({
      label: 'matrix-parallel-tools',
      tools: [
        {
          toolUseId: globId,
          toolName: 'Glob',
          toolInput: { pattern: '**/*.md' },
        },
        {
          toolUseId: grepId,
          toolName: 'Grep',
          toolInput: { pattern: 'parallel-needle', path: '.' },
          inputJsonChunks: ['{"pattern":"parallel-ne', 'edle","path":', '"."}'],
        },
      ],
      bodyTextIncludes: '请并行执行两个搜索工具',
      bodyTextExcludes: EXCLUDE_TITLE,
    }),
    anthropicTextExchange({
      label: 'matrix-parallel-final',
      text: '并行工具环完成：Glob 与 Grep 均已返回',
      bodyTextIncludes: grepId,
      bodyTextExcludes: EXCLUDE_TITLE,
    }),
  ]
}

export const TOOL_MATRIX_USER_PROMPT = USER_PROMPT
