import { m } from 'motion/react'

export interface NewChatQuickAction {
  id: string
  label: string
  prompt: string
}

export interface NewChatQuickActionsViewProps {
  actions: NewChatQuickAction[]
  onSelect: (prompt: string) => void
}

/** Props-only quick prompt row for the New Chat surface. */
export function NewChatQuickActionsView({
  actions,
  onSelect,
}: NewChatQuickActionsViewProps) {
  return (
    <m.div
      className="mt-3 flex flex-wrap gap-1.5 px-1"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 0.15, duration: 0.22 }}
    >
      {actions.map((action, index) => (
        <m.button
          key={action.id}
          type="button"
          onClick={() => onSelect(action.prompt)}
          className="h-7 select-none rounded-lg border border-border px-2.5 text-[12px] text-muted-foreground/60 transition-colors duration-100 hover:border-border hover:bg-accent hover:text-foreground/80"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25 + index * 0.04, duration: 0.25 }}
        >
          {action.label}
        </m.button>
      ))}
    </m.div>
  )
}
