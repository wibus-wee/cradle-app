import { CheckCircleLine as CheckCircle2Icon } from '@mingcute/react'

import { Progress } from '~/components/ui/progress'
import { cn } from '~/lib/cn'
import { boundedPercent } from '~/lib/number-format'

import { projectChatTodos, readTodoCompletion } from '../../../capabilities/chat-todo-projection'
import type { ToolPayload } from '../../../rendering/tool-ui-classifier'
import { RawValue } from '../tool-call-details'

export interface TodoSummaryViewProps { input: ToolPayload, output: ToolPayload }

export function TodoSummaryView({ input, output }: TodoSummaryViewProps) {
  const todos = projectChatTodos(input, output)
  if (todos.length === 0) { return <RawValue value={output.rawText ?? input.rawText ?? output} /> }
  const { completed } = readTodoCompletion(todos)
  return (
<div className="grid gap-2">
<Progress value={boundedPercent(completed, todos.length)} className="h-1.5" />
<div className="grid gap-1">
{todos.map(todo => (
<div key={todo.id ?? todo.content} className="flex items-start gap-2 rounded-md bg-muted/30 px-2 py-1.5">
<CheckCircle2Icon className={cn('mt-0.5 size-3.5 shrink-0', todo.status === 'completed' ? '!text-emerald-500' : '!text-muted-foreground')} aria-hidden />
<span className={cn('min-w-0 flex-1 text-xs text-foreground/85', todo.status === 'completed' && 'text-muted-foreground line-through decoration-muted-foreground/50')}>{todo.content}</span>
<span className="shrink-0 rounded bg-background/60 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">{todo.status}</span>
</div>
))}
</div>
</div>
)
}
