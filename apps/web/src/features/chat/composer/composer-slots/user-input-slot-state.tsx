import { QuestionLine as CircleHelpIcon } from '@mingcute/react'
import { useQueryClient } from '@tanstack/react-query'

import { cn } from '~/lib/cn'

import type { ChatRuntimeUserInputUiSlotState } from '../../capabilities/chat-capabilities'
import { runtimeUiSlotStatesQueryKey } from '../../capabilities/chat-capabilities'
import { submitRuntimeUserInput } from '../../commands/chat-response-command'
import { RuntimeUserInputForm } from '../../runtime-user-input/runtime-user-input-form'
import { ComposerSlotShell } from './composer-slot-shell'

export function UserInputSlotState({
  state,
  sessionId,
  className,
}: {
  state: ChatRuntimeUserInputUiSlotState
  sessionId: string
  className?: string
}) {
  const queryClient = useQueryClient()

  const submit = async (answers: Record<string, string[]>) => {
    await submitRuntimeUserInput({
      sessionId,
      requestId: state.requestId,
      answers,
    })
    await queryClient.invalidateQueries({ queryKey: runtimeUiSlotStatesQueryKey(sessionId) })
  }

  return (
    <ComposerSlotShell
      stateName="user-input"
      testId="runtime-user-input-slot"
      className={cn('px-0 py-0', className)}
    >
      <div className="flex min-w-0 items-center gap-2 border-b border-border/60 px-3 py-2">
        <CircleHelpIcon
          className="size-3.5 shrink-0 !text-amber-500 dark:!text-amber-400"
          aria-hidden="true"
        />
        <div className="flex min-w-0 flex-1 items-baseline gap-1.5">
          <span className="shrink-0 text-xs font-medium text-foreground/80">Ask user</span>
          <span className="min-w-0 truncate text-[11px] text-muted-foreground">
            {state.questionCount === 1 ? '1 question' : `${state.questionCount} questions`}
          </span>
        </div>
      </div>
      <RuntimeUserInputForm
        questions={state.questions}
        className="border-t-0 bg-transparent"
        onSubmit={submit}
      />
    </ComposerSlotShell>
  )
}
