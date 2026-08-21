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
        'inline-flex h-8 items-center justify-center rounded-lg px-3 text-[13px] font-medium',
        'transition-[background-color,color,box-shadow,translate] duration-[var(--duration-quick)] ease-[var(--ease-standard)]',
        'active:translate-y-px',
        'focus-visible:outline-none focus-visible:shadow-[0_0_0_2px_var(--card),0_0_0_4px_color-mix(in_srgb,var(--viz-blue)_45%,transparent)]',
        'disabled:pointer-events-none disabled:text-[var(--text-dim)]',
        {
          'bg-[var(--primary)] text-[var(--background)] hover:bg-[color-mix(in_srgb,var(--primary)_85%,transparent)]': variant === 'primary',
          'bg-[var(--card)] text-[var(--foreground)] shadow-[var(--shadow-xs)] hover:bg-[var(--muted)]': variant === 'secondary',
          'text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]': variant === 'ghost',
        },
        className,
      )}
    >
      {children ?? 'Run'}
    </button>
  )
}
