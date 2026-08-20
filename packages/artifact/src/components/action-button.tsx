import type { ButtonHTMLAttributes, ReactNode } from 'react'

import { useArtifactAction } from '../action-context'
import { cn } from '../cn'

export interface ActionButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'> {
  /** Prompt sent to the owning chat session when clicked. */
  prompt: string
  children?: ReactNode
  variant?: 'primary' | 'secondary' | 'ghost'
}

/**
 * Host-bridged action. The Artifact viewer supplies `runPrompt` via context so
 * agents can embed follow-up buttons without importing Cradle app code.
 */
export function ActionButton({
  prompt,
  children,
  variant = 'secondary',
  className,
  disabled,
  ...props
}: ActionButtonProps) {
  const action = useArtifactAction()
  const canRun = Boolean(action) && prompt.trim().length > 0

  return (
    <button
      type="button"
      {...props}
      disabled={disabled || !canRun}
      onClick={() => {
        if (!canRun || !action) {
          return
        }
        action.runPrompt(prompt.trim())
      }}
      className={cn(
        'inline-flex h-8 items-center justify-center rounded-[var(--radius-md)] px-3 text-[12px] font-medium',
        'transition-[background-color,color,box-shadow] duration-[var(--duration-quick)] ease-[var(--ease-standard)]',
        'focus-visible:outline-none focus-visible:shadow-[var(--shadow-inset-ring)]',
        'disabled:pointer-events-none disabled:text-[var(--text-dim)]',
        {
          'bg-[var(--color-neutral-9)] text-[var(--color-neutral-1)] hover:bg-[var(--color-neutral-8)]': variant === 'primary',
          'bg-[var(--color-surface)] text-[var(--text-primary)] shadow-[var(--shadow-xs)] hover:bg-[var(--color-fill)]': variant === 'secondary',
          'text-[var(--text-secondary)] hover:bg-[var(--color-fill)] hover:text-[var(--text-primary)]': variant === 'ghost',
        },
        className,
      )}
    >
      {children ?? 'Run'}
    </button>
  )
}
