import {
  AlertLine as CircleAlertIcon,
  CheckCircleLine as CheckCircle2Icon,
  ClockLine as ClockIcon,
  ExternalLinkLine as ExternalLinkIcon,
  RightSmallLine as ChevronRightIcon,
} from '@mingcute/react'
import { m } from 'motion/react'
import type { KeyboardEvent, MouseEvent, ReactNode } from 'react'
import { useEffect, useState } from 'react'

import { Button } from '~/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip'
import { cn } from '~/lib/cn'
import { useBrowserPanelStore } from '~/store/browser-panel'

import { readBuiltinToolCallInputPayload } from '../chat-tool-entities'
import { readTerminalOutputSections } from '../terminal-tool-details'
import { STATUS_LABELS, TOOL_ICON_MAP } from '../tool-block-constants'
import type {
  RenderableToolPart,
  ToolPayload,
  ToolState,
  ToolUiDescriptor,
} from '../tool-ui-classifier'
import { describeToolCall, readToolInputPayload, readToolPayload } from '../tool-ui-classifier'
import { hasWorkflowDetails, readWorkflowSurfaceSnapshot } from '../workflow-surface'
import { EditFileBlock } from './edit-file-block'
import type { ToolCallBlockProps } from './tool-call-block-types'
import {
  DetailSection,
  FileDiffExecutionDetails,
  hasFileDiffInlineContent,
  KeyValueTable,
  RawValue,
  readEditDiffPreview,
  readFileDiffTarget,
  TerminalExecutionDetails,
} from './tool-call-details'
import { ToolHero, WorkflowPhaseList } from './tool-hero'
import { hasHeroContent } from './tool-hero-content'

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

function readApprovalReason(input: unknown, approval?: { reason?: string }): string | null {
  if (approval?.reason) {
    return approval.reason
  }
  const args = readBuiltinToolCallInputPayload(input)?.args
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    return null
  }
  const reason = (args as { reason?: unknown }).reason
  return typeof reason === 'string' && reason.trim().length > 0 ? reason : null
}

function isRunning(state: ToolState): boolean {
  return (
    state === 'input-streaming' || state === 'input-available' || state === 'approval-requested'
  )
}

function isError(state: ToolState): boolean {
  return state === 'output-error' || state === 'output-denied'
}

function hasRenderableChildren(children: ReactNode): boolean {
  if (children === null || children === undefined || typeof children === 'boolean') {
    return false
  }
  if (Array.isArray(children)) {
    return children.some(hasRenderableChildren)
  }
  return true
}

function readSubagentPanelName(
  input: ToolPayload,
  output: ToolPayload,
  descriptor: ToolUiDescriptor,
): string {
  return (
    output.workflowName
    ?? input.workflowName
    ?? output.subagentName
    ?? input.subagentName
    ?? descriptor.target
    ?? descriptor.title
    ?? 'Subagent'
  )
}

function readSubagentPanelRole(
  input: ToolPayload,
  output: ToolPayload,
  descriptor: ToolUiDescriptor,
): string | null {
  return (
    output.agentType
    ?? input.agentType
    ?? output.taskType
    ?? input.taskType
    ?? (descriptor.toolName.includes('Workflow') ? 'Workflow' : null)
  )
}

// ---------------------------------------------------------------------------
// StatusIcon
// ---------------------------------------------------------------------------

function StatusIcon({ state, animated = true }: { state: ToolState, animated?: boolean }) {
  if (isError(state)) {
    return <CircleAlertIcon className="size-3.5 !text-destructive" aria-hidden />
  }
  if (state === 'output-available' || state === 'approval-responded') {
    return <CheckCircle2Icon className="size-3.5 !text-emerald-500" aria-hidden />
  }
  return (
    <ClockIcon
      className={cn(
        'size-3.5 !text-muted-foreground',
        animated && isRunning(state) && 'animate-pulse',
      )}
      aria-hidden
    />
  )
}

// ---------------------------------------------------------------------------
// Internal detail components (used only in expanded view)
// ---------------------------------------------------------------------------

function _ToolDetails({
  descriptor,
  input,
  output,
  errorText,
  children,
}: {
  descriptor: ToolUiDescriptor
  input: ToolPayload
  output: ToolPayload
  errorText?: string
  children?: ReactNode
}) {
  const workflowDetails = hasWorkflowDetails(input, output, descriptor)
  return (
    <div className="grid gap-3">
      {workflowDetails
? (
        <WorkflowExecutionDetails input={input} output={output} />
      )
: (
        <>
          <ToolSpecificDetails descriptor={descriptor} input={input} output={output} />
          {input !== undefined && (
            <DetailSection title="Input">
              <RawValue value={input} />
            </DetailSection>
          )}
          {(output !== undefined || errorText) && (
            <DetailSection title={errorText ? 'Error' : 'Output'}>
              <RawValue value={errorText ?? output} />
            </DetailSection>
          )}
        </>
      )}
      {children && (
        <DetailSection title="Nested activity">
          <div className="grid gap-1.5">{children}</div>
        </DetailSection>
      )}
    </div>
  )
}

function ToolSpecificDetails({
  descriptor,
  input,
  output,
}: {
  descriptor: ToolUiDescriptor
  input: ToolPayload
  output: ToolPayload
}) {
  switch (descriptor.kind) {
    case 'terminal':
      return (
        <KeyValueTable
          rows={[
            ['Command', input.command],
            ['Timeout', input.timeout],
            ['Background', output.backgroundTaskId],
          ]}
        />
      )
    case 'file-diff':
      return <FileDiffDetails input={input} output={output} />
    case 'search':
      return (
        <KeyValueTable
          rows={[
            ['Pattern', input.pattern],
            ['Path', input.filePath],
            ['Mode', output.mode],
            ['Files', output.numFiles],
            ['Matches', output.numMatches],
          ]}
        />
      )
    case 'web':
      return (
        <KeyValueTable
          rows={[
            ['URL', input.url ?? output.url],
            ['Query', input.query ?? output.query],
            ['Status', output.code],
          ]}
        />
      )
    case 'worktree':
      return (
        <KeyValueTable
          rows={[
            ['Path', output.worktreeTarget ?? input.worktreeTarget],
            ['Branch', output.worktreeBranch],
            ['Action', output.action],
          ]}
        />
      )
    default:
      return null
  }
}

function FileDiffDetails({ input, output }: { input: ToolPayload, output: ToolPayload }) {
  const editPreview = readEditDiffPreview(input, output)

  return (
    <div className="grid gap-2">
      <KeyValueTable
        rows={[
          ['File', input.filePath ?? output.filePath],
          ['Mode', output.type],
          ['Replace all', input.replaceAll === true ? 'Yes' : null],
          ['User modified', output.userModified === true ? 'Yes' : null],
        ]}
      />
      {editPreview && (
        <EditFileBlock
          filePath={editPreview.filePath}
          oldContent={editPreview.oldContent}
          newContent={editPreview.newContent}
          presentation="detail"
        />
      )}
    </div>
  )
}

function WorkflowExecutionDetails({ input, output }: { input: ToolPayload, output: ToolPayload }) {
  const phases = output.workflowPhases.length > 0 ? output.workflowPhases : input.workflowPhases
  const lifecycle = output.workflowLifecycle.length > 0
    ? output.workflowLifecycle
    : input.workflowLifecycle
  return (
    <div className="grid gap-3">
      <DetailSection title="Workflow">
        <KeyValueTable
          rows={[
            ['Name', output.workflowName ?? input.workflowName ?? input.subagentName],
            ['Description', output.workflowDescription ?? input.workflowDescription],
            ['Status', output.status],
            ['Task', output.taskId ?? input.taskId],
            ['Task type', output.taskType ?? input.taskType],
            ['Run', output.workflowRunId ?? input.workflowRunId],
            ['Script', output.workflowScriptPath ?? input.workflowScriptPath],
            ['Transcript', output.workflowTranscriptDir ?? input.workflowTranscriptDir],
            ['Remote session', output.workflowSessionUrl ?? input.workflowSessionUrl],
            ['Warning', output.warning ?? input.warning],
            ['Error', output.error ?? input.error],
          ]}
        />
      </DetailSection>
      <WorkflowPhaseList phases={phases} />
      <DetailSection title="Full input">
        <RawValue value={input.rawValue} />
      </DetailSection>
      <DetailSection title="Full output">
        <RawValue value={output.rawValue} />
      </DetailSection>
      <DetailSection title="Lifecycle events">
        <RawValue value={lifecycle} />
      </DetailSection>
    </div>
  )
}

// ---------------------------------------------------------------------------
// ToolCallBlock (main export)
// ---------------------------------------------------------------------------

export function ToolCallBlock({
  toolName,
  toolCallId,
  state,
  animated = true,
  approval,
  argumentsText,
  input,
  output,
  errorText,
  sessionId,
  workspaceDiffTarget,
  onApprovalResponse,
  children,
}: ToolCallBlockProps) {
  const inputPayload = readToolInputPayload(input, argumentsText)
  const outputPayload = readToolPayload(output)
  const descriptor = (() => {
    const part: RenderableToolPart = {
      type: 'dynamic-tool',
      toolName,
      toolCallId,
      state,
      argumentsText,
      input,
      output,
      errorText,
    }
    return describeToolCall(part)
  })()

  const hasTerminalPanel
    = descriptor.kind === 'terminal'
      && (inputPayload.command !== null
        || inputPayload.timeout !== null
        || outputPayload.backgroundTaskId !== null
        || readTerminalOutputSections(outputPayload, errorText).length > 0)
  const hasDiffPanel
    = (descriptor.kind === 'file-diff' || descriptor.kind === 'notebook-diff')
      && (!!errorText || hasFileDiffInlineContent(inputPayload, outputPayload))
  const hasWorkflowPanel = hasWorkflowDetails(inputPayload, outputPayload, descriptor)
  const hasStructuredPanel = hasTerminalPanel || hasDiffPanel
  const hasDetailPayload
    = hasStructuredPanel
      || input !== undefined
      || output !== undefined
      || Boolean(argumentsText)
      || Boolean(errorText)
  const workspaceDiffPath
    = descriptor.kind === 'file-diff' || descriptor.kind === 'notebook-diff'
      ? readFileDiffTarget(input, output, argumentsText)
      : null
  const canOpenWorkspaceDiff = !!workspaceDiffTarget && !!workspaceDiffPath
  const openWorkspaceDiffTab = useBrowserPanelStore(s => s.openWorkspaceDiffTab)
  const openSubagentTab = useBrowserPanelStore(s => s.openSubagentTab)
  const openWorkflowTab = useBrowserPanelStore(s => s.openWorkflowTab)
  const updateWorkflowTab = useBrowserPanelStore(s => s.updateWorkflowTab)
  const requestScrollToFilePath = useBrowserPanelStore(s => s.requestScrollToFilePath)
  const hasChildren = hasRenderableChildren(children)
  const expandable = hasStructuredPanel || hasChildren
  const interactive = expandable || canOpenWorkspaceDiff
  const [expanded, setExpanded] = useState(() => isError(state) && hasStructuredPanel)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const Icon = TOOL_ICON_MAP[descriptor.kind]
  const running = isRunning(state)
  const errored = isError(state)
  const planImplementationApproval
    = descriptor.kind === 'plan-implementation' && state === 'approval-requested'
  const approvalReason = readApprovalReason(input, approval)
  const workflowSurface = hasWorkflowPanel
    ? readWorkflowSurfaceSnapshot(inputPayload, outputPayload)
    : null
  const canOpenSubagentThread = descriptor.kind === 'subagent' && !!sessionId && !hasWorkflowPanel
  const subagentPanelName = canOpenSubagentThread
    ? readSubagentPanelName(inputPayload, outputPayload, descriptor)
    : null
  const subagentPanelRole = canOpenSubagentThread
    ? readSubagentPanelRole(inputPayload, outputPayload, descriptor)
    : null

  useEffect(() => {
    if (errored && hasStructuredPanel) {
      setExpanded(true)
    }
  }, [errored, hasStructuredPanel])

  useEffect(() => {
    if (!workflowSurface) {
      return
    }
    updateWorkflowTab({
      sessionId,
      toolCallId,
      surface: workflowSurface,
    })
  }, [sessionId, toolCallId, updateWorkflowTab, workflowSurface])

  const openWorkspaceDiff = () => {
    if (!workspaceDiffTarget || !workspaceDiffPath) {
      return
    }
    const tabId = openWorkspaceDiffTab({
      workspaceId: workspaceDiffTarget.workspaceId,
      title: 'All Changes',
      ownerId: workspaceDiffTarget.ownerId,
    })
    requestScrollToFilePath({ path: workspaceDiffPath, tabId })
  }

  const openSubagentOutput = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    if (!sessionId || !subagentPanelName) {
      return
    }
    const ownerId = useBrowserPanelStore.getState().activeOwnerId
    openSubagentTab({
      sessionId,
      threadId: toolCallId,
      agentName: subagentPanelName,
      agentRole: subagentPanelRole,
      ownerId,
    })
  }

  const openWorkflowSurface = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    if (!workflowSurface) {
      return
    }
    openWorkflowTab({
      sessionId,
      toolCallId,
      title: workflowSurface.workflowName ?? descriptor.title,
      surface: workflowSurface,
    })
  }

  const toggleExpanded = () => {
    if (expandable) {
      setExpanded(value => !value)
      return
    }
    if (canOpenWorkspaceDiff) {
      openWorkspaceDiff()
    }
  }

  const handleHeaderKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!interactive) {
      return
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      toggleExpanded()
    }
  }

  const frameContent = (
    <>
      <div
        className={cn(
          'overflow-hidden rounded-lg mx-1 -px-1 bg-card border-border border',
          errored && 'ring-1 ring-destructive/30',
          interactive && 'select-none',
        )}
      >
        <div
          className={cn('flex h-8 items-center gap-2 px-3', interactive && 'cursor-pointer')}
          role={interactive ? 'button' : undefined}
          tabIndex={interactive ? 0 : undefined}
          aria-expanded={expandable ? expanded : undefined}
          onClick={toggleExpanded}
          onKeyDown={handleHeaderKeyDown}
        >
          <Icon
            className={cn(
              'size-3.5 shrink-0 text-muted-foreground/60',
              running && 'text-amber-500 dark:text-amber-400',
              errored && 'text-destructive',
            )}
            aria-hidden
          />
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground/80">
            {descriptor.title}
          </span>
          {(canOpenSubagentThread || hasWorkflowPanel) && (
            <Tooltip>
              <TooltipTrigger
                render={(
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    className="size-6 text-muted-foreground/50 hover:text-foreground"
                    aria-label={hasWorkflowPanel
                      ? `Open ${workflowSurface?.workflowName ?? 'Workflow'} surface`
                      : `Open ${subagentPanelName ?? 'Subagent'} output`}
                    onClick={hasWorkflowPanel ? openWorkflowSurface : openSubagentOutput}
                  >
                    <ExternalLinkIcon className="size-3.5" aria-hidden />
                  </Button>
                )}
              />
              <TooltipContent sideOffset={6}>{hasWorkflowPanel ? 'Open Workflow surface' : 'Open output'}</TooltipContent>
            </Tooltip>
          )}
          {hasDetailPayload && !hasWorkflowPanel && (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="h-6 px-2 text-[11px] text-muted-foreground"
              onClick={(event) => {
                if (hasWorkflowPanel) {
                  openWorkflowSurface(event)
                  return
                }
                event.preventDefault()
                event.stopPropagation()
                setDetailsOpen(true)
              }}
            >
              Details
            </Button>
          )}
          {expandable && (
            <ChevronRightIcon
              className={cn(
                'size-5 shrink-0 !text-muted-foreground/40',
                animated && 'transition-transform duration-200',
                expanded && 'rotate-90',
              )}
              aria-hidden
            />
          )}
          <span
            className={cn(
              'flex shrink-0 items-center',
              isError(state) ? 'text-destructive/70' : 'text-muted-foreground/40',
              (state === 'output-available' || state === 'approval-responded')
              && 'text-emerald-500/80',
            )}
            title={`${descriptor.displayName} · ${STATUS_LABELS[state]}`}
          >
            <StatusIcon state={state} animated={animated} />
          </span>
        </div>

        {running && (
          <div className="h-px overflow-hidden bg-muted">
            {animated
? (
              <m.div
                className="h-full w-1/3 rounded-full bg-muted-foreground/25"
                animate={{ x: ['-100%', '400%'] }}
                transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
              />
            )
: (
              <div className="h-full w-1/3 rounded-full bg-muted-foreground/25" />
            )}
          </div>
        )}

        {hasTerminalPanel && expanded && (
          <div className="px-3 pb-3">
            <TerminalExecutionDetails
              input={input}
              output={output}
              errorText={errorText}
              argumentsText={argumentsText}
            />
          </div>
        )}

        {hasDiffPanel && expanded && (
          <div className="px-3 pb-3">
            <FileDiffExecutionDetails
              input={input}
              output={output}
              errorText={errorText}
              argumentsText={argumentsText}
              state={state}
            />
          </div>
        )}

        {!hasWorkflowPanel && (!hasStructuredPanel || !expanded)
          && hasHeroContent(descriptor, inputPayload, outputPayload, errorText) && (
            <div className="px-3 pb-3">
              <ToolHero
                descriptor={descriptor}
                state={state}
                input={inputPayload}
                output={outputPayload}
                errorText={errorText}
                toolCallId={toolCallId}
              />
            </div>
          )}

        {state === 'approval-requested' && approval && onApprovalResponse && (
          <div
            className="flex items-center justify-between gap-3 border-t border-border/60 px-3 py-2"
            data-testid="approval-card"
          >
            <div className="min-w-0 text-xs leading-snug text-muted-foreground">
              {approvalReason ?? 'Approval required'}
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <Button
                type="button"
                variant="ghost"
                size="xs"
                data-testid="approval-deny-btn"
                onClick={() => onApprovalResponse({ id: approval.id, approved: false })}
              >
                {planImplementationApproval ? 'Dismiss' : 'Deny'}
              </Button>
              <Button
                type="button"
                size="xs"
                data-testid="approval-allow-btn"
                onClick={() => onApprovalResponse({ id: approval.id, approved: true })}
              >
                {planImplementationApproval ? 'Yes, implement this plan' : 'Approve'}
              </Button>
            </div>
          </div>
        )}
      </div>

      {hasChildren && expanded && (
        <div className={cn('ml-3 mt-0.5 overflow-y-auto space-y-0', !running && 'max-h-80')}>
          {children}
        </div>
      )}
      <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
        <DialogContent className="max-h-[min(80vh,760px)] w-[min(920px,calc(100vw-2rem))] max-w-none overflow-y-auto sm:max-w-none">
          <DialogHeader>
            <DialogTitle>{descriptor.title}</DialogTitle>
            <DialogDescription>
              {descriptor.displayName}
{' '}
·
{STATUS_LABELS[state]}
            </DialogDescription>
          </DialogHeader>
          <_ToolDetails
            descriptor={descriptor}
            input={inputPayload}
            output={outputPayload}
            errorText={errorText}
          >
            {children}
          </_ToolDetails>
        </DialogContent>
      </Dialog>
    </>
  )

  const frameProps = {
    'className': 'py-1.5',
    'data-testid': `chat-tool-call-${toolCallId}`,
    'data-tool-name': toolName,
    'data-tool-kind': descriptor.kind,
  }

  if (!animated) {
    return <div {...frameProps}>{frameContent}</div>
  }

  return (
    <div
      // initial={{ opacity: 0, y: 4 }}
      // animate={{ opacity: 1, y: 0 }}
      // transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
      {...frameProps}
    >
      {frameContent}
    </div>
  )
}
