import { cn } from '~/lib/cn'

import type { ToolPayload, ToolState, ToolUiDescriptor } from '../../rendering/tool-ui-classifier'
import type { PlanDocumentOpenInput } from './plan-document-preview-view'
import { DiffSummary } from './tool-call-details'
import { FileReadSummaryView } from './tool-hero/file-read-summary-view'
import { McpSummaryView } from './tool-hero/mcp-summary-view'
import { PlanImplementationSummaryView } from './tool-hero/plan-implementation-summary-view'
import { PlanSummaryView } from './tool-hero/plan-summary-view'
import { QuestionSummaryView } from './tool-hero/question-summary-view'
import { SearchSummaryView } from './tool-hero/search-summary-view'
import { SubagentSummaryView } from './tool-hero/subagent-summary-view'
import { TerminalSummaryView } from './tool-hero/terminal-summary-view'
import { TodoSummaryView } from './tool-hero/todo-summary-view'
import { WebSummaryView } from './tool-hero/web-summary-view'

export interface ToolHeroViewProps {
  descriptor: ToolUiDescriptor
  state: ToolState
  input: ToolPayload
  output: ToolPayload
  errorText?: string
  toolCallId: string
  onOpenPlanDocument?: (input: PlanDocumentOpenInput) => void
}

/** Props-only dispatcher for independently-renderable tool summary Views. */
export function ToolHeroView({
  descriptor,
  state,
  input,
  output,
  errorText,
  toolCallId,
  onOpenPlanDocument,
}: ToolHeroViewProps) {
  switch (descriptor.kind) {
    case 'terminal': return <TerminalSummaryView errorText={errorText} />
    case 'file-read': return <FileReadSummaryView output={output} />
    case 'file-diff':
    case 'notebook-diff': return <DiffSummary input={input} output={output} state={state} />
    case 'search': return <SearchSummaryView output={output} />
    case 'web': return <WebSummaryView output={output} />
    case 'subagent': return <SubagentSummaryView input={input} output={output} />
    case 'todo': return <TodoSummaryView input={input} output={output} />
    case 'plan-implementation': return <PlanImplementationSummaryView />
    case 'plan': return <PlanSummaryView input={input} output={output} toolCallId={toolCallId} onOpenPlanDocument={onOpenPlanDocument} />
    case 'question': return <QuestionSummaryView output={output} />
    case 'mcp': return <McpSummaryView output={output} errorText={errorText} />
    default:
      return <div className={cn('rounded-md bg-muted/30 px-2.5 py-2 text-xs text-muted-foreground', (state === 'output-error' || state === 'output-denied') && 'bg-destructive/5 text-destructive/80')}>{errorText || descriptor.summary || 'Tool details are available below.'}</div>
  }
}
