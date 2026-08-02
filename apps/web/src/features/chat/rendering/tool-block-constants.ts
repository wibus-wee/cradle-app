import {
  AlertLine as CircleAlertIcon,
  CheckCircleLine as CheckCircle2Icon,
  ClockLine as ClockIcon,
  CodeLine as Code2Icon,
  FileLine as FileTextIcon,
  FileSearchLine as FileSearchIcon,
  GitBranchLine as GitBranchIcon,
  GitCompareLine as DiffIcon,
  GlobeLine as GlobeIcon,
  LayoutTopLine as PanelTopIcon,
  ListCheckLine as ListChecksIcon,
  Notebook2Line as NotebookTabsIcon,
  QuestionLine as HelpCircleIcon,
  RobotLine as BotIcon,
  ServerLine as ServerIcon,
  TerminalBoxLine as SquareTerminalIcon,
  ToDoLine as ListTodoIcon,
} from '@mingcute/react'
import type { ComponentType } from 'react'

import type { ToolState, ToolUiKind } from './tool-ui-classifier'

// ---------------------------------------------------------------------------
// Icon map
// ---------------------------------------------------------------------------

type IconComponent = ComponentType<{ 'className'?: string, 'aria-hidden'?: boolean }>

export const TOOL_ICON_MAP: Record<ToolUiKind, IconComponent> = {
  'file-read': FileTextIcon,
  'file-diff': DiffIcon,
  'notebook-diff': NotebookTabsIcon,
  'terminal': SquareTerminalIcon,
  'search': FileSearchIcon,
  'web': GlobeIcon,
  'subagent': BotIcon,
  'task-control': ClockIcon,
  'todo': ListTodoIcon,
  'plan': PanelTopIcon,
  'plan-implementation': ListChecksIcon,
  'question': HelpCircleIcon,
  'artifact': PanelTopIcon,
  'mcp': ServerIcon,
  'worktree': GitBranchIcon,
  'generic': Code2Icon,
}

// ---------------------------------------------------------------------------
// Status icon map (subset used for status indicators)
// ---------------------------------------------------------------------------

export const STATUS_ICON_MAP: Partial<Record<ToolState, IconComponent>> = {
  'output-available': CheckCircle2Icon,
  'output-error': CircleAlertIcon,
  'output-denied': CircleAlertIcon,
}

// ---------------------------------------------------------------------------
// Status labels
// ---------------------------------------------------------------------------

export const STATUS_LABELS: Record<ToolState, string> = {
  'input-streaming': 'Preparing',
  'input-available': 'Running',
  'approval-requested': 'Awaiting approval',
  'approval-responded': 'Approved',
  'output-available': 'Done',
  'output-error': 'Failed',
  'output-denied': 'Denied',
}

// ---------------------------------------------------------------------------
// Count labels for activity-feed header summaries
// ---------------------------------------------------------------------------

/** [singular, plural] noun phrases used to compose "2 files, 3 searches" summaries. */
export const FEED_ENTRY_COUNT_LABELS: Record<ToolUiKind, [string, string]> = {
  'file-read': ['file', 'files'],
  'file-diff': ['file edit', 'file edits'],
  'notebook-diff': ['notebook edit', 'notebook edits'],
  'terminal': ['command', 'commands'],
  'search': ['search', 'searches'],
  'web': ['web lookup', 'web lookups'],
  'subagent': ['subagent', 'subagents'],
  'task-control': ['task', 'tasks'],
  'todo': ['todo update', 'todo updates'],
  'plan': ['plan', 'plans'],
  'plan-implementation': ['plan', 'plans'],
  'question': ['question', 'questions'],
  'artifact': ['artifact', 'artifacts'],
  'mcp': ['tool', 'tools'],
  'worktree': ['worktree', 'worktrees'],
  'generic': ['tool', 'tools'],
}

// ---------------------------------------------------------------------------
// Interaction CSS constants
// ---------------------------------------------------------------------------

/** Hover/active background for interactive rows (tool items, headers) */
export const INTERACTIVE_ROW_CLASS = 'hover:bg-muted/35 active:bg-muted/50 transition-colors duration-100'
