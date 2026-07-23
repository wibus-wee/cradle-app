import {
  ArrowLeftLine as ArrowLeftIcon,
  CloseLine as XIcon,
  SearchLine as SearchIcon,
} from '@mingcute/react'
import type { ComponentType, SVGProps } from 'react'
import { useMemo, useState } from 'react'

import { Button } from '~/components/ui/button'
import { cn } from '~/lib/cn'

export interface SettingsNavigationItem {
  id: string
  label: string
  icon: ComponentType<SVGProps<SVGSVGElement>>
  searchTerms?: string[]
  onActivate?: () => void
}

export interface SettingsNavigationSection {
  id: string
  label: string
  items: SettingsNavigationItem[]
}

export interface SettingsSidebarViewProps {
  activeSection: string
  sections: SettingsNavigationSection[]
  title: string
  searchPlaceholder: string
  closeLabel: string
  clearSearchLabel: string
  noResultsLabel: string
  onSetSection: (section: string) => void
  onClose: () => void
}

/** Props-only searchable settings navigation. Translation and route actions stay in the adapter. */
export function SettingsSidebarView({
  activeSection,
  sections,
  title,
  searchPlaceholder,
  closeLabel,
  clearSearchLabel,
  noResultsLabel,
  onSetSection,
  onClose,
}: SettingsSidebarViewProps) {
  const [query, setQuery] = useState('')
  const normalizedQuery = query.trim().toLowerCase()
  const filteredSections = useMemo(() => {
    if (!normalizedQuery) {
      return sections
    }

    return sections.flatMap((section) => {
      const sectionMatches = section.label.toLowerCase().includes(normalizedQuery)
      const items = section.items.filter((item) => {
        if (sectionMatches || item.label.toLowerCase().includes(normalizedQuery)) {
          return true
        }
        return item.searchTerms?.some(term => term.toLowerCase().includes(normalizedQuery)) ?? false
      })
      return items.length > 0 ? [{ ...section, items }] : []
    })
  }, [normalizedQuery, sections])

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden" data-testid="settings-sidebar">
      <div className="flex items-center gap-1.5 px-3 py-2">
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onClose}
          aria-label={closeLabel}
          data-testid="settings-close"
        >
          <ArrowLeftIcon aria-hidden="true" />
        </Button>
        <span className="select-none text-xs font-medium text-foreground">{title}</span>
      </div>

      <div className="mx-2 mb-1 flex h-7 items-center gap-1.5 rounded-md border border-border/60 bg-background/60 px-2 focus-within:border-ring/50 focus-within:ring-2 focus-within:ring-ring/15">
        <SearchIcon className="size-3.5 shrink-0 !text-muted-foreground/60" aria-hidden="true" />
        <input
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder={searchPlaceholder}
          className="min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground/45"
          data-testid="settings-search"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery('')}
            className="flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground/60 hover:bg-accent hover:text-foreground"
            aria-label={clearSearchLabel}
          >
            <XIcon className="size-3" aria-hidden="true" />
          </button>
        )}
      </div>

      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-2 pt-1">
        {filteredSections.map(section => (
          <div key={section.id} className="flex flex-col gap-0.5">
            <span className="select-none px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground">
              {section.label}
            </span>
            {section.items.map((item) => {
              const Icon = item.icon
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => (item.onActivate ? item.onActivate() : onSetSection(item.id))}
                  data-testid={`settings-nav-${item.id}`}
                  className={cn(
                    'flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs',
                    activeSection === item.id
                      ? 'bg-accent font-medium text-accent-foreground'
                      : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
                  )}
                >
                  <Icon className="size-3.5" aria-hidden="true" />
                  {item.label}
                </button>
              )
            })}
          </div>
        ))}
        {normalizedQuery && filteredSections.length === 0 && (
          <div className="px-2.5 py-4 text-center text-xs text-muted-foreground">
            {noResultsLabel}
          </div>
        )}
      </nav>
    </div>
  )
}
