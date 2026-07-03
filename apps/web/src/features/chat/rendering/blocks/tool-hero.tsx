import { StaticRender } from '@cradle/streamdown'
import {
  CheckCircleLine as CheckCircle2Icon,
  ClockLine as ClockIcon,
  CloseCircleLine as XCircleIcon,
  FileLine as FileTextIcon,
  FullscreenLine as Maximize2Icon,
  LayoutTopLine as PanelTopIcon,
  RightSmallLine as ChevronRightIcon,
} from '@mingcute/react'
import type { KeyboardEvent, MouseEvent } from 'react'
import { useState } from 'react'

import { Alert, AlertDescription, AlertTitle } from '~/components/ui/alert'
import { Button } from '~/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '~/components/ui/collapsible'
import { Progress } from '~/components/ui/progress'
import { cn } from '~/lib/cn'
import { boundedPercent } from '~/lib/number-format'
import { useBrowserPanelStore } from '~/store/browser-panel'
import { useLayoutStore } from '~/store/layout'

import { projectChatTodos, readTodoCompletion } from '../../capabilities/chat-todo-projection'
import type { ToolPayload, ToolState, ToolUiDescriptor, WorkflowPhase } from '../tool-ui-classifier'
import {
  DiffSummary,
  KeyValueTable,
  PathList,
  RawValue,
} from './tool-call-details'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isError(state: ToolState): boolean {
  return state === 'output-error' || state === 'output-denied'
}

// ---------------------------------------------------------------------------
// ToolHero
// ---------------------------------------------------------------------------

export function ToolHero({
  descriptor,
  state,
  input,
  output,
  errorText,
  toolCallId,
}: {
  descriptor: ToolUiDescriptor
  state: ToolState
  input: ToolPayload
  output: ToolPayload
  errorText?: string
  toolCallId: string
}) {
  switch (descriptor.kind) {
    case 'terminal':
      return <TerminalSummary errorText={errorText} />
    case 'file-read':
      return <FileReadSummary output={output} />
    case 'file-diff':
      return <DiffSummary input={input} output={output} state={state} />
    case 'notebook-diff':
      return <DiffSummary input={input} output={output} state={state} />
    case 'search':
      return <SearchSummary output={output} />
    case 'web':
      return <WebSummary output={output} />
    case 'subagent':
      return <SubagentSummary input={input} output={output} />
    case 'todo':
      return <TodoSummary input={input} output={output} />
    case 'plan-implementation':
      return <PlanImplementationSummary />
    case 'plan':
      return <PlanSummary input={input} output={output} toolCallId={toolCallId} />
    case 'question':
      return <QuestionSummary output={output} />
    default:
      return (
        <div
          className={cn(
            'rounded-md bg-muted/30 px-2.5 py-2 text-xs text-muted-foreground',
            isError(state) && 'bg-destructive/5 text-destructive/80',
          )}
        >
          {errorText || descriptor.summary || 'Tool details are available below.'}
        </div>
      )
  }
}

// ---------------------------------------------------------------------------
// Summary components
// ---------------------------------------------------------------------------

function TerminalSummary({ errorText }: { errorText?: string }) {
  if (!errorText) {
    return null
  }
  return (
    <div className="rounded-md bg-destructive/5 px-2.5 py-2 text-xs text-destructive/80">
      Command failed
    </div>
  )
}

function FileReadSummary({ output }: { output: ToolPayload }) {
  const [open, setOpen] = useState(false)
  const outputType = output.type
  const file = output.file
  if (!file) {
    return null
  }
  if (outputType === 'image') {
    const mimeType = file.type ?? 'image/png'
    const base64 = file.base64
    return base64
? (
      <img
        src={`data:${mimeType};base64,${base64}`}
        alt="Tool result preview"
        className="max-h-64 rounded-md object-contain outline outline-1 outline-black/10 dark:outline-white/10"
      />
    )
: null
  }
  if (outputType === 'text') {
    const segments = (file.filePath ?? '').split('/')
    const fileName = segments.at(-1) ?? file.filePath ?? 'file'
    const dirPath = segments.length > 1 ? `${segments.slice(0, -1).join('/')}/` : ''
      return (
        <Collapsible open={open} onOpenChange={setOpen}>
          <CollapsibleTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              className={cn(
                'group h-auto w-full min-w-0 justify-start gap-2 px-2 py-1.5',
                'rounded-md transition-colors duration-100',
                'hover:bg-accent/50 active:bg-accent/70',
                open && 'rounded-b-none bg-accent/30',
              )}
            >
              <FileTextIcon
                className="size-3.5 shrink-0 !text-muted-foreground/50 transition-colors group-hover:!text-muted-foreground/70"
                aria-hidden
              />
              <span className="min-w-0 flex-1 truncate text-left font-mono text-[12px] leading-none">
                {dirPath && <span className="text-muted-foreground/45">{dirPath}</span>}
                <span className="text-foreground/75">{fileName}</span>
              </span>
              <ChevronRightIcon
                className={cn(
                  'size-3 shrink-0 !text-muted-foreground/40',
                  'transition-transform duration-200',
                  open && 'rotate-90',
                )}
                aria-hidden
              />
            </Button>
          </CollapsibleTrigger>
        <CollapsibleContent className="overflow-hidden rounded-b-md">
          <RawValue value={file.content} />
        </CollapsibleContent>
        </Collapsible>
    )
  }
  return (
    <KeyValueTable
      rows={[
        ['Type', outputType],
        ['Path', file.filePath],
        ['Size', file.originalSize],
        ['Pages', file.count],
        ['Output', file.outputDir],
      ]}
    />
  )
}

function SearchSummary({ output }: { output: ToolPayload }) {
  const filenames = output.filenames
  const content = output.contentText
  if (content) {
    return <RawValue value={content} />
  }
  return <PathList paths={filenames} emptyText="Search returned no files." />
}

function WebSummary({ output }: { output: ToolPayload }) {
  const links = output.results.flatMap(item =>
    item.content.map(hit => ({
      title: hit.title ?? 'Untitled',
      url: hit.url ?? '',
    })))
  if (links.length > 0) {
    return (
      <div className="grid gap-1">
        {links.slice(0, 8).map(link => (
          <a
            key={`${link.title}:${link.url}`}
            href={link.url}
            target="_blank"
            rel="noreferrer"
            className="rounded-md bg-muted/30 px-2 py-1.5 text-xs text-foreground/85 transition-colors hover:bg-muted/60"
          >
            <span className="block truncate">{link.title}</span>
            <span className="block truncate font-mono text-[10px] text-muted-foreground">
              {link.url}
            </span>
          </a>
        ))}
      </div>
    )
  }
  return null
}

function SubagentSummary({ input, output }: { input: ToolPayload, output: ToolPayload }) {
  const status = output.status
  const workflow = isWorkflowPayload(input, output)
  const content = output.contentBlocks
    .map(item => item.text)
    .filter(Boolean)
    .join('\n\n')

  if (!status && !content && !workflow) {
    return null
  }

  const statusTitle = readSubagentStatusTitle(status, workflow)
  const StatusIcon = status === 'async_launched' || status === 'remote_launched'
    ? ClockIcon
    : status === 'failed' || status === 'error'
      ? XCircleIcon
      : CheckCircle2Icon
  const workflowRows = workflow
    ? readWorkflowRows(input, output)
    : []
  const workflowPhases = output.workflowPhases.length > 0 ? output.workflowPhases : input.workflowPhases

  return (
    <div className="grid gap-2">
      {statusTitle && (
        <Alert
          className={cn(
            'border-emerald-500/20 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300',
            (status === 'async_launched' || status === 'remote_launched') && 'border-amber-500/20 bg-amber-500/5 text-amber-700 dark:text-amber-300',
            (status === 'failed' || status === 'error') && 'border-destructive/20 bg-destructive/5 text-destructive',
          )}
        >
          <StatusIcon className="size-4" aria-hidden />
          <AlertTitle>{statusTitle}</AlertTitle>
          <AlertDescription>
            {output.outputFile ?? output.workflowSessionUrl ?? readSubagentStatusDescription(status, workflow)}
          </AlertDescription>
        </Alert>
      )}
      {workflowRows.length > 0 && <KeyValueTable rows={workflowRows} />}
      <WorkflowPhaseList phases={workflowPhases} />
      {content && <RawValue value={content} />}
    </div>
  )
}

function readSubagentStatusTitle(status: string | null, workflow: boolean): string | null {
  switch (status) {
    case 'async_launched':
      return workflow ? 'Workflow running' : 'Background agent running'
    case 'remote_launched':
      return 'Remote workflow running'
    case 'completed':
      return workflow ? 'Workflow completed' : 'Background agent completed'
    case 'failed':
    case 'error':
      return workflow ? 'Workflow failed' : 'Background agent failed'
    case 'stopped':
      return workflow ? 'Workflow stopped' : 'Background agent stopped'
    default:
      return null
  }
}

function readSubagentStatusDescription(status: string | null, workflow: boolean): string {
  if (status === 'async_launched' || status === 'remote_launched') {
    return workflow ? 'Workflow output will be available when the task completes.' : 'Output will be available when the task completes.'
  }
  if (status === 'failed' || status === 'error') {
    return workflow ? 'The workflow reported a failure.' : 'The background task reported a failure.'
  }
  if (status === 'stopped') {
    return workflow ? 'The workflow was stopped.' : 'The background task was stopped.'
  }
  return 'Output has been captured.'
}

function isWorkflowPayload(input: ToolPayload, output: ToolPayload): boolean {
  return input.taskType === 'local_workflow'
    || output.taskType === 'local_workflow'
    || input.taskType === 'remote_agent'
    || output.taskType === 'remote_agent'
    || input.workflowName !== null
    || output.workflowName !== null
    || input.workflowDescription !== null
    || output.workflowDescription !== null
    || input.workflowPhases.length > 0
    || output.workflowPhases.length > 0
    || input.workflowRunId !== null
    || output.workflowRunId !== null
    || input.workflowScriptPath !== null
    || output.workflowScriptPath !== null
    || input.workflowSessionUrl !== null
    || output.workflowSessionUrl !== null
    || input.warning !== null
    || output.warning !== null
    || input.error !== null
    || output.error !== null
}

function readWorkflowRows(input: ToolPayload, output: ToolPayload): Array<[string, string | number | null]> {
  const rows: Array<[string, string | number | null]> = [
    ['Name', output.workflowName ?? input.workflowName ?? input.subagentName],
    ['Description', output.workflowDescription ?? input.workflowDescription],
    ['Task', output.taskId ?? input.taskId],
    ['Run', output.workflowRunId ?? input.workflowRunId],
    ['Script', output.workflowScriptPath ?? input.workflowScriptPath],
    ['Transcript', output.workflowTranscriptDir ?? input.workflowTranscriptDir],
    ['Remote session', output.workflowSessionUrl ?? input.workflowSessionUrl],
    ['Warning', output.warning ?? input.warning],
    ['Error', output.error ?? input.error],
  ]
  return rows.filter(([, value]) => value !== null && value !== '')
}

export function WorkflowPhaseList({ phases }: { phases: WorkflowPhase[] }) {
  if (phases.length === 0) {
    return null
  }

  return (
    <div className="grid gap-1.5">
      <div className="text-[10px] font-medium uppercase text-muted-foreground">Declared phases</div>
      <div className="grid gap-1">
        {phases.map((phase, index) => (
          <div
            key={`${phase.name}:${phase.description ?? ''}`}
            className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-2 rounded-md bg-muted/30 px-2 py-1.5 text-xs"
          >
            <span className="tabular-nums text-muted-foreground">{index + 1}</span>
            <span className="min-w-0">
              <span className="block truncate text-foreground/85">{phase.name}</span>
              {phase.description && phase.description !== phase.name && (
                <span className="block truncate text-[11px] text-muted-foreground">
                  {phase.description}
                </span>
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function TodoSummary({ input, output }: { input: ToolPayload, output: ToolPayload }) {
  const todos = projectChatTodos(input, output)
  if (todos.length === 0) {
    return <RawValue value={output.rawText ?? input.rawText ?? output} />
  }
  const { completed } = readTodoCompletion(todos)
  return (
    <div className="grid gap-2">
      <Progress value={boundedPercent(completed, todos.length)} className="h-1.5" />
      <div className="grid gap-1">
        {todos.map(todo => (
          <div
            key={todo.id ?? todo.content}
            className="flex items-start gap-2 rounded-md bg-muted/30 px-2 py-1.5"
          >
            <CheckCircle2Icon
              className={cn(
                'mt-0.5 size-3.5 shrink-0',
                todo.status === 'completed' ? '!text-emerald-500' : '!text-muted-foreground',
              )}
              aria-hidden
            />
            <span
              className={cn(
                'min-w-0 flex-1 text-xs text-foreground/85',
                todo.status === 'completed'
                && 'text-muted-foreground line-through decoration-muted-foreground/50',
              )}
            >
              {todo.content}
            </span>
            <span className="shrink-0 rounded bg-background/60 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
              {todo.status}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function PlanImplementationSummary() {
  return (
    <div className="rounded-md bg-muted/30 px-2.5 py-2 text-xs text-muted-foreground">
      Plan implementation request recorded.
    </div>
  )
}

function PlanSummary({
  input,
  output,
  toolCallId,
}: {
  input: ToolPayload
  output: ToolPayload
  toolCallId: string
}) {
  const text
    = output.planContent
      ?? input.planContent
      ?? output.plan
      ?? input.plan
      ?? output.text
      ?? input.text
      ?? output.rawText
      ?? input.rawText
  const openPlanDocumentTab = useBrowserPanelStore(s => s.openPlanDocumentTab)
  const setBrowserPanelOpen = useLayoutStore(s => s.setBrowserPanelOpen)

  if (!text) {
    return null
  }

  const openPlan = () => {
    openPlanDocumentTab({ toolCallId, text })
    setBrowserPanelOpen(true)
  }

  const handlePreviewClick = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target instanceof HTMLElement ? event.target : null
    if (target?.closest('a, button')) {
      return
    }
    openPlan()
  }

  const handlePreviewKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      openPlan()
    }
  }

  return (
    <div
      className="group/plan relative overflow-hidden rounded-md border border-border/70 bg-background/85 shadow-xs transition-[border-color,box-shadow] duration-150 hover:border-border hover:shadow-sm"
      data-testid="chat-plan-document"
      role="button"
      tabIndex={0}
      aria-label="Open plan document"
      onClick={handlePreviewClick}
      onKeyDown={handlePreviewKeyDown}
    >
      <div className="flex h-8 items-center justify-between border-b border-border/60 px-3">
        <div className="flex min-w-0 items-center gap-2">
          <PanelTopIcon className="size-3.5 shrink-0 !text-muted-foreground/60" aria-hidden="true" />
          <span className="min-w-0 truncate text-xs font-medium text-foreground/80">
            Plan document
          </span>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="size-6 shrink-0 text-muted-foreground/70 opacity-70 transition-[opacity,scale] duration-150 hover:text-foreground group-hover/plan:opacity-100 active:scale-[0.96]"
          aria-label="Open plan document in panel"
          onClick={openPlan}
        >
          <Maximize2Icon className="size-3" aria-hidden="true" />
        </Button>
      </div>
      <div
        className="streamdown-root max-h-64 overflow-y-auto px-3 py-3 text-xs leading-relaxed"
        style={{
          maskImage:
            'linear-gradient(to bottom, transparent, black 18px, black calc(100% - 24px), transparent)',
        }}
      >
        <StaticRender content={text} />
      </div>
    </div>
  )
}

function QuestionSummary({ output }: { output: ToolPayload }) {
  const answers = output.answers
  if (!answers) {
    return <RawValue value={output} />
  }
  return (
    <KeyValueTable
      rows={Object.entries(answers).map(([question, answer]) => [question, String(answer)])}
    />
  )
}
