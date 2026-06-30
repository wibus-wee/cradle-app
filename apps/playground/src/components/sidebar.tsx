import { useState } from 'react'

export interface ComponentEntry {
  id: string
  label: string
  description: string
  available: boolean
}

const COMPONENTS: ComponentEntry[] = [
  { id: 'streamdown', label: 'Streamdown', description: 'Streaming markdown renderer', available: true },
  { id: 'tool-call-stream', label: 'Tool Call Stream', description: 'Chat delta reducer reproduction', available: true },
  { id: 'docs', label: 'Docs', description: 'Component documentation', available: true },
  { id: 'button', label: 'Button', description: 'Interactive button variants', available: false },
  { id: 'dialog', label: 'Dialog', description: 'Modal dialog component', available: false },
  { id: 'input', label: 'Input', description: 'Text input with validation', available: false },
  { id: 'select', label: 'Select', description: 'Dropdown selection', available: false },
  { id: 'tooltip', label: 'Tooltip', description: 'Contextual hover tooltip', available: false },
]

interface SidebarProps {
  activeComponent: string
  onComponentChange: (id: string) => void
  collapsed: boolean
  onCollapsedChange: (v: boolean) => void
}

export function Sidebar({ activeComponent, onComponentChange, collapsed, onCollapsedChange }: SidebarProps) {
  const [search, setSearch] = useState('')
  const filtered = COMPONENTS.filter(c => c.label.toLowerCase().includes(search.toLowerCase()))

  if (collapsed) {
    return (
      <div className="flex h-full w-12 flex-col items-center border-r border-border bg-background pt-3">
        <button
          onClick={() => onCollapsedChange(false)}
          className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M5 3l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    )
  }

  return (
    <aside className="flex h-full w-65 shrink-0 flex-col border-r border-border bg-background">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <div>
          <h1 className="text-sm font-semibold tracking-tight text-foreground">Cradle</h1>
          <p className="text-[11px] text-muted-foreground">Component Playground</p>
        </div>
        <button
          onClick={() => onCollapsedChange(true)}
          className="flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M9 3l-4 4 4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      {/* Search */}
      <div className="px-3 py-2">
        <input
          type="text"
          placeholder="Search components..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full rounded-md bg-foreground/5 px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground outline-none ring-1 ring-border transition-colors focus:ring-foreground/30"
        />
      </div>

      {/* Component List */}
      <div className="flex-1 overflow-y-auto px-2 py-1">
        <p className="px-2 pb-1.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
          Components
        </p>
        {filtered.map(c => (
          c.available
            ? (
                <button
                  key={c.id}
                  onClick={() => onComponentChange(c.id)}
                  className={activeComponent === c.id
                    ? 'group flex w-full flex-col rounded-lg bg-foreground/10 px-2.5 py-2 text-left transition-colors'
                    : 'group flex w-full flex-col rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-foreground/8'}
                >
                  <span className={activeComponent === c.id
                    ? 'text-[13px] font-medium text-foreground'
                    : 'text-[13px] font-medium text-foreground/90'}
                  >
                    {c.label}
                  </span>
                  <span className="text-[11px] text-muted-foreground">{c.description}</span>
                </button>
              )
            : (
                <button
                  key={c.id}
                  disabled
                  className="group flex w-full cursor-not-allowed flex-col rounded-lg px-2.5 py-2 text-left opacity-50 transition-colors"
                >
                  <span className="text-[13px] font-medium text-foreground/90">{c.label}</span>
                  <span className="text-[11px] text-muted-foreground">{c.description}</span>
                  <span className="mt-0.5 text-[10px] text-muted-foreground">Coming soon</span>
                </button>
              )
        ))}
      </div>

      {/* Footer */}
      <div className="border-t border-border px-4 py-3">
        <p className="text-[10px] text-muted-foreground">
          @cradle/playground
        </p>
      </div>
    </aside>
  )
}
