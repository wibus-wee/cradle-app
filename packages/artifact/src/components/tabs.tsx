import type { ReactNode } from 'react'
import { useId, useState } from 'react'

import { cn } from '../cn'

export interface TabItem {
  id: string
  label: string
  content: ReactNode
}

export interface TabsProps {
  tabs: TabItem[]
  className?: string
}

/** View-local tab switcher with an animated underline indicator. */
export function Tabs({ tabs, className }: TabsProps) {
  const [activeId, setActiveId] = useState(tabs[0]?.id)
  const baseId = useId()
  const active = tabs.find(tab => tab.id === activeId) ?? tabs[0]

  if (!active) {
    return null
  }

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div role="tablist" className="flex items-center gap-1 border-b border-[var(--border)]">
        {tabs.map((tab) => {
          const selected = tab.id === active.id
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`${baseId}-${tab.id}`}
              aria-selected={selected}
              onClick={() => setActiveId(tab.id)}
              className={cn(
                'relative min-h-8 px-2.5 text-xs font-medium transition-colors duration-[var(--duration-quick)] ease-[var(--ease-standard)]',
                'focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_1px_var(--viz-blue)] rounded-t-md',
                {
                  'text-[var(--foreground)]': selected,
                  'text-[var(--muted-foreground)] hover:text-[var(--foreground)]': !selected,
                },
              )}
            >
              {tab.label}
              <span
                aria-hidden="true"
                className={cn(
                  'absolute inset-x-1 -bottom-px h-0.5 rounded-full bg-[var(--viz-blue)] transition-opacity duration-[var(--duration-quick)] ease-[var(--ease-standard)]',
                  selected ? 'opacity-100' : 'opacity-0',
                )}
              />
            </button>
          )
        })}
      </div>
      <div role="tabpanel" aria-labelledby={`${baseId}-${active.id}`}>
        {active.content}
      </div>
    </div>
  )
}
