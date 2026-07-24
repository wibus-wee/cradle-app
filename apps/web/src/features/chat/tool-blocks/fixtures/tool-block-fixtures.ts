import type { CradleToolKind } from '@cradle/chat-runtime-contracts'

import type { RenderableToolPart, ToolState } from '../../rendering/tool-ui-classifier'
import type { ToolCallBlockViewProps } from '../views/tool-call-block-view'

type ToolFixtureProps = Omit<
  ToolCallBlockViewProps,
  | 'onApprovalResponse'
  | 'onOpenWorkspaceDiff'
  | 'onOpenSubagentOutput'
  | 'onOpenWorkflowSurface'
  | 'onWorkflowSurfaceChange'
  | 'onOpenPlanDocument'
>

interface ToolFixtureInput {
  kind: CradleToolKind
  apiName: string
  args: unknown
  result?: unknown
  state?: ToolState
  errorText?: string
  approval?: ToolFixtureProps['approval']
}

export interface ChatToolFixture {
  kind: CradleToolKind
  props: ToolFixtureProps
}

function createToolFixture({
  kind,
  apiName,
  args,
  result,
  state = 'output-available',
  errorText,
  approval,
}: ToolFixtureInput): ChatToolFixture {
  return {
    kind,
    props: {
      toolName: apiName,
      toolCallId: `storybook-${kind}`,
      state,
      animated: false,
      approval,
      input: {
        type: 'cradle.builtin-tool-call.input.v1',
        identifier: 'storybook',
        apiName,
        kind,
        args,
      },
      output: result === undefined
        ? undefined
        : {
            type: 'cradle.builtin-tool-call.result.v1',
            identifier: 'storybook',
            apiName,
            kind,
            result,
          },
      errorText,
    },
  }
}

export const chatToolKindFixtures: ChatToolFixture[] = [
  createToolFixture({
    kind: 'terminal',
    apiName: 'Bash',
    args: { command: 'pnpm --filter @cradle/web typecheck', description: 'Typecheck web app' },
    result: { stdout: 'Done in 8.4s', code: 0, durationSeconds: 8.4 },
  }),
  createToolFixture({
    kind: 'file-read',
    apiName: 'Read',
    args: { file_path: 'apps/web/src/features/chat/transcript/views/message-bubble-view.tsx' },
    result: {
      type: 'text',
      file: {
        filePath: 'apps/web/src/features/chat/transcript/views/message-bubble-view.tsx',
        type: 'text',
        content: 'export function MessageBubbleView(props: MessageBubbleViewProps)',
        numLines: 1002,
      },
    },
  }),
  createToolFixture({
    kind: 'file-diff',
    apiName: 'Edit',
    args: {
      file_path: 'apps/web/src/features/chat/tool-blocks/views/tool-call-block-view.tsx',
      old_string: 'export function ToolCallBlock(',
      new_string: 'export function ToolCallBlockView(',
    },
    result: { filePath: 'apps/web/src/features/chat/tool-blocks/views/tool-call-block-view.tsx' },
  }),
  createToolFixture({
    kind: 'notebook-diff',
    apiName: 'NotebookEdit',
    args: { notebook_path: 'analysis/tool-coverage.ipynb', cell_type: 'code', new_string: 'coverage = 1.0' },
    result: { filePath: 'analysis/tool-coverage.ipynb', type: 'updated' },
  }),
  createToolFixture({
    kind: 'search',
    apiName: 'Grep',
    args: { pattern: 'ToolCallBlock', path: 'apps/web/src/features/chat' },
    result: {
      numFiles: 3,
      numMatches: 7,
      mode: 'files_with_matches',
      filenames: [
        'tool-blocks/views/tool-call-block-view.tsx',
        'rendering/message-tool-blocks.tsx',
        'tool-blocks/fixtures/tool-block-fixtures.ts',
      ],
    },
  }),
  createToolFixture({
    kind: 'web',
    apiName: 'WebFetch',
    args: { url: 'https://storybook.js.org/docs', query: 'portable stories' },
    result: {
      code: 200,
      results: [{
        content: [{
          title: 'Storybook documentation',
          url: 'https://storybook.js.org/docs',
          text: 'Build isolated UI components and pages.',
        }],
      }],
    },
  }),
  createToolFixture({
    kind: 'subagent',
    apiName: 'Agent',
    args: { description: 'Audit tool rendering boundaries', subagent_type: 'code-reviewer' },
    result: { status: 'completed', output: 'No store access remains in the View module.' },
  }),
  createToolFixture({
    kind: 'task-control',
    apiName: 'TaskOutput',
    args: { task_id: 'task-42' },
    result: { status: 'completed', output: 'Storybook build completed successfully.' },
  }),
  createToolFixture({
    kind: 'todo',
    apiName: 'TodoWrite',
    args: {
      todos: [
        { content: 'Extract props-only tool view', status: 'completed' },
        { content: 'Add canonical tool fixtures', status: 'completed' },
        { content: 'Capture Storybook gallery', status: 'in_progress' },
      ],
    },
    result: { status: 'updated' },
  }),
  createToolFixture({
    kind: 'plan',
    apiName: 'ExitPlanMode',
    args: { plan: '1. Extract View\n2. Add fixtures\n3. Verify every state' },
    result: { status: 'accepted' },
  }),
  createToolFixture({
    kind: 'plan-implementation',
    apiName: 'PlanImplementation',
    args: { reason: 'The plan is ready to implement.' },
    state: 'approval-requested',
    approval: { id: 'approval-plan', reason: 'Implement the Storybook expansion?' },
  }),
  createToolFixture({
    kind: 'question',
    apiName: 'AskUserQuestion',
    args: {
      questions: [{
        question: 'Which tool surface should ship first?',
        options: ['All canonical kinds', 'Only terminal'],
      }],
    },
    result: { answers: { surface: 'All canonical kinds' } },
  }),
  createToolFixture({
    kind: 'mcp',
    apiName: 'mcp__github__search_issues',
    args: { query: 'repo:wibus-wee/cradle-app storybook' },
    result: {
      content: [{
        text: 'PR #71: Fixture-driven chat Storybook',
        title: 'Fixture-driven chat Storybook',
        url: 'https://github.com/wibus-wee/cradle-app/pull/71',
      }],
    },
  }),
  createToolFixture({
    kind: 'worktree',
    apiName: 'create_worktree',
    args: { path: '/tmp/cradle-storybook', action: 'create' },
    result: { worktreePath: '/tmp/cradle-storybook', worktreeBranch: 'cradle/wt/storybook', action: 'created' },
  }),
  createToolFixture({
    kind: 'generic',
    apiName: 'Skill',
    args: { name: 'agent-browser', input: 'Capture the tool gallery.' },
    result: { output: 'Screenshot saved.' },
  }),
]

export const chatWorkflowToolFixture = createToolFixture({
  kind: 'subagent',
  apiName: 'Workflow',
  args: {
    script: [
      'export const meta = {',
      '  name: \'storybook-verification\',',
      '  description: \'Verify every fixture-driven tool surface\',',
      '  phases: [',
      '    { name: \'Render\', description: \'Mount props-only views\' },',
      '    { name: \'Inspect\', description: \'Check browser output\' },',
      '    { name: \'Capture\', description: \'Write the golden image\' },',
      '  ],',
      '}',
    ].join('\n'),
    taskType: 'local_workflow',
  },
  result: {
    status: 'completed',
    taskId: 'workflow-storybook-1',
    taskType: 'local_workflow',
    workflowName: 'storybook-verification',
    runId: 'workflow-run-storybook-1',
  },
})

const terminalFixture = chatToolKindFixtures[0]

export const chatToolStateFixtures: ChatToolFixture[] = [
  'input-streaming',
  'input-available',
  'approval-requested',
  'approval-responded',
  'output-available',
  'output-error',
  'output-denied',
].map((state) => {
  const toolState = state as ToolState
  return {
    kind: 'terminal',
    props: {
      ...terminalFixture.props,
      toolCallId: `storybook-state-${toolState}`,
      state: toolState,
      approval: toolState === 'approval-requested' || toolState === 'approval-responded'
        ? { id: `approval-${toolState}`, approved: toolState === 'approval-responded', reason: 'Run the verification command?' }
        : undefined,
      output: toolState === 'output-available' || toolState === 'approval-responded'
        ? terminalFixture.props.output
        : undefined,
      errorText: toolState === 'output-error'
        ? 'Command exited with status 1: typecheck failed.'
        : toolState === 'output-denied'
          ? 'The user denied this tool call.'
          : undefined,
    },
  }
})

function toRenderablePart(fixture: ChatToolFixture, toolCallId: string): RenderableToolPart {
  return {
    type: 'dynamic-tool',
    toolName: fixture.props.toolName,
    toolCallId,
    state: fixture.props.state,
    argumentsText: fixture.props.argumentsText,
    input: fixture.props.input,
    output: fixture.props.output,
    errorText: fixture.props.errorText,
  }
}

const terminalGroupFixtures = [chatToolKindFixtures[0], chatToolKindFixtures[0], chatToolStateFixtures[5]]
const fileGroupFixtures = [chatToolKindFixtures[1], chatToolKindFixtures[2], chatToolKindFixtures[3]]

export const groupedTerminalToolFixtures = terminalGroupFixtures.map((fixture, index) => ({
  key: `terminal-${index}`,
  part: toRenderablePart(fixture, `grouped-terminal-${index}`),
}))

export const groupedFileToolFixtures = fileGroupFixtures.map((fixture, index) => ({
  key: `file-${index}`,
  part: toRenderablePart(fixture, `grouped-file-${index}`),
}))
