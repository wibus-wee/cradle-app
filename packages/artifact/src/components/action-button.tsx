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
        'inline-flex h-8 items-center justify-center rounded-md px-3 text-[12px] font-medium transition-colors duration-150',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
        'disabled:pointer-events-none disabled:opacity-50',
        'active:scale-[0.98]',
        {
          'bg-foreground text-background hover:bg-foreground/90': variant === 'primary',
          'border border-border bg-background hover:bg-muted': variant === 'secondary',
          'text-text-secondary hover:bg-muted hover:text-foreground': variant === 'ghost',
        },
        className,
      )}
    >
      {children ?? 'Run'}
    </button>
  )
}
