import {
  CloseLine as XIcon,
  Columns2Line as ColumnsIcon,
  DotCircleLine as CircleDotIcon,
  DownSmallLine as ChevronDownIcon,
  FilterLine as FilterIcon,
  PlaylistLine as ListIcon,
  PlusLine as PlusIcon,
  SearchLine as SearchIcon,
  SelectorHorizontalLine as SlidersHorizontalIcon,
} from '@mingcute/react'
import type { ReactNode } from 'react'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { Checkbox } from '~/components/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '~/components/ui/popover'
import type { KanbanMilestone, KanbanStatus } from '~/features/kanban/types'
import { cn } from '~/lib/cn'

import { LabelChip } from './shared/label-chip'
import { PriorityIcon } from './shared/priority-icon'
import { StatusIcon } from './shared/status-icon'
import { StatusManager } from './status-manager'
import type { FilterState, ViewConfig } from './use-board-view'
import { hasActiveFilter } from './use-board-view'

const priorityLabelKeys = {
  urgent: 'priority.urgent',
  high: 'priority.high',
  medium: 'priority.medium',
  low: 'priority.low',
  none: 'priority.none',
} as const

const priorities = ['urgent', 'high', 'medium', 'low', 'none'] as const

interface ToolbarProps {
  workspaceId: string
  config: ViewConfig
  setConfig: (patch: Partial<ViewConfig>) => void
  filter: FilterState
  setFilter: (patch: Partial<FilterState>) => void
  resetFilter: () => void
  statuses: KanbanStatus[]
  milestones: KanbanMilestone[]
  labelOptions: string[]
  issueCount: number
  totalIssueCount: number
  searchQuery: string
  onSearchChange: (query: string) => void
  onCreateIssue: () => void
}

/**
 * Toolbar control. Icon-only actions were unreadable, so anything that carries a
 * current value now shows that value as text — the control tells you what the board
 * is doing without being opened.
 */
function ToolbarButton({
  children,
  active,
  className,
  ...props
}: {
  children: ReactNode
  active?: boolean
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cn(
        'flex h-7 items-center gap-1.5 rounded-md px-2 text-[12px] font-medium',
        'text-muted-foreground transition-colors duration-100',
        'hover:bg-fill hover:text-foreground',
        'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
        active && 'bg-fill text-foreground',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  )
}

export function KanbanToolbar({
  workspaceId,
  config,
  setConfig,
  filter,
  setFilter,
  resetFilter,
  statuses,
  milestones,
  labelOptions,
  issueCount,
  totalIssueCount,
  searchQuery,
  onSearchChange,
  onCreateIssue,
}: ToolbarProps) {
  const { t } = useTranslation('kanban')
  const filtered = hasActiveFilter(filter) || searchQuery.trim().length > 0

  return (
    <div className="shrink-0 border-b border-border">
      <div className="flex items-center gap-1.5 px-3 py-1.5">
        <SearchField value={searchQuery} onChange={onSearchChange} />

        <span
          className="shrink-0 px-1 text-[12px] text-muted-foreground tabular-nums"
          data-testid="kanban-issue-count"
        >
          {filtered
            ? t('toolbar.countFiltered', { count: issueCount, total: totalIssueCount })
            : t('toolbar.count', { count: totalIssueCount })}
        </span>

        <div className="flex-1" />

        <FilterMenu
          filter={filter}
          setFilter={setFilter}
          resetFilter={resetFilter}
          statuses={statuses}
          milestones={milestones}
          labelOptions={labelOptions}
        />
        <GroupByMenu config={config} setConfig={setConfig} />
        <SortMenu config={config} setConfig={setConfig} />
        <DisplayMenu config={config} setConfig={setConfig} />
        <StatusManagerPopover workspaceId={workspaceId} />

        <span className="mx-0.5 h-5 w-px bg-border" aria-hidden="true" />

        <div className="flex items-center gap-0.5 rounded-md bg-fill/60 p-0.5">
          <LayoutButton
            active={config.layout === 'board'}
            label={t('layout.boardAria')}
            onClick={() => setConfig({ layout: 'board' })}
          >
            <ColumnsIcon className="size-3.5" aria-hidden="true" />
          </LayoutButton>
          <LayoutButton
            active={config.layout === 'list'}
            label={t('layout.listAria')}
            onClick={() => setConfig({ layout: 'list' })}
          >
            <ListIcon className="size-3.5" aria-hidden="true" />
          </LayoutButton>
        </div>

        <button
          type="button"
          onClick={onCreateIssue}
          data-testid="kanban-create-issue-btn"
          className={cn(
            'flex h-7 items-center gap-1 rounded-md bg-primary px-2.5 text-[12px] font-medium',
            'text-primary-foreground transition-colors duration-100 hover:bg-primary/90',
            'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
          )}
        >
          <PlusIcon className="size-3.5" aria-hidden="true" />
          {t('issue.create')}
        </button>
      </div>

      <ActiveFilterChips
        filter={filter}
        setFilter={setFilter}
        resetFilter={resetFilter}
        statuses={statuses}
        milestones={milestones}
      />
    </div>
  )
}

function LayoutButton({
  active,
  label,
  onClick,
  children,
}: {
  active: boolean
  label: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        'flex size-6 items-center justify-center rounded transition-colors duration-100',
        active
          ? 'bg-card text-foreground shadow-[var(--shadow-xs)]'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
    </button>
  )
}

function SearchField({ value, onChange }: { value: string, onChange: (value: string) => void }) {
  const { t } = useTranslation('kanban')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const typing = target?.tagName === 'INPUT'
        || target?.tagName === 'TEXTAREA'
        || target?.tagName === 'SELECT'
        || target?.isContentEditable

      if (event.key === '/' && !typing && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault()
        inputRef.current?.focus()
      }
    }

    window.addEventListener('keydown', focusSearch)
    return () => window.removeEventListener('keydown', focusSearch)
  }, [])

  return (
    <div
      className={cn(
        'flex h-7 w-56 shrink-0 items-center gap-1.5 rounded-md border border-border bg-card px-2',
        'transition-colors duration-100 focus-within:border-ring',
      )}
    >
      <SearchIcon className="size-3.5 shrink-0 !text-muted-foreground" aria-hidden="true" />
      <input
        ref={inputRef}
        value={value}
        onChange={event => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && value) {
            event.stopPropagation()
            onChange('')
          }
        }}
        placeholder={t('toolbar.searchPlaceholder')}
        aria-label={t('toolbar.searchPlaceholder')}
        data-testid="kanban-search-input"
        className="min-w-0 flex-1 bg-transparent text-[12px] text-foreground outline-none placeholder:text-muted-foreground"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label={t('toolbar.searchClear')}
          className="flex size-4 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground"
        >
          <XIcon className="size-3" aria-hidden="true" />
        </button>
      )}
    </div>
  )
}

/** Active filters are visible and individually removable, not hidden behind a popover. */
function ActiveFilterChips({
  filter,
  setFilter,
  resetFilter,
  statuses,
  milestones,
}: {
  filter: FilterState
  setFilter: (patch: Partial<FilterState>) => void
  resetFilter: () => void
  statuses: KanbanStatus[]
  milestones: KanbanMilestone[]
}) {
  const { t } = useTranslation('kanban')

  if (!hasActiveFilter(filter)) {
    return null
  }

  const chips: { key: string, label: string, onRemove: () => void }[] = []

  for (const statusId of filter.statusIds ?? []) {
    const status = statuses.find(candidate => candidate.id === statusId)
    chips.push({
      key: `status:${statusId}`,
      label: `${t('property.status')}: ${status?.name ?? statusId}`,
      onRemove: () => {
        const next = (filter.statusIds ?? []).filter(id => id !== statusId)
        setFilter({ statusIds: next.length > 0 ? next : undefined })
      },
    })
  }

  for (const priority of filter.priorities ?? []) {
    chips.push({
      key: `priority:${priority}`,
      label: `${t('property.priority')}: ${t(priorityLabelKeys[priority])}`,
      onRemove: () => {
        const next = (filter.priorities ?? []).filter(value => value !== priority)
        setFilter({ priorities: next.length > 0 ? next : undefined })
      },
    })
  }

  for (const label of filter.labels ?? []) {
    chips.push({
      key: `label:${label}`,
      label: `${t('property.labels')}: ${label}`,
      onRemove: () => {
        const next = (filter.labels ?? []).filter(value => value !== label)
        setFilter({ labels: next.length > 0 ? next : undefined })
      },
    })
  }

  if (filter.milestoneId) {
    const milestone = milestones.find(candidate => candidate.id === filter.milestoneId)
    chips.push({
      key: 'milestone',
      label: `${t('property.milestone')}: ${milestone?.title ?? filter.milestoneId}`,
      onRemove: () => setFilter({ milestoneId: null }),
    })
  }

  if (filter.isDelegated != null) {
    chips.push({
      key: 'delegated',
      label: filter.isDelegated ? t('filter.delegatedOnly') : t('filter.notDelegated'),
      onRemove: () => setFilter({ isDelegated: null }),
    })
  }

  return (
    <div
      className="flex flex-wrap items-center gap-1.5 border-t border-border px-3 py-1.5"
      data-testid="kanban-filter-chips"
    >
      {chips.map(chip => (
        <span
          key={chip.key}
          className="flex h-6 items-center gap-1 rounded-md bg-fill px-2 text-[11px] text-foreground"
        >
          {chip.label}
          <button
            type="button"
            onClick={chip.onRemove}
            aria-label={t('filter.removeChip', { filter: chip.label })}
            className="flex size-3.5 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground"
          >
            <XIcon className="size-2.5" aria-hidden="true" />
          </button>
        </span>
      ))}
      <button
        type="button"
        onClick={resetFilter}
        className="h-6 rounded-md px-1.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
      >
        {t('filter.clear')}
      </button>
    </div>
  )
}

function FilterMenu({
  filter,
  setFilter,
  resetFilter,
  statuses,
  milestones,
  labelOptions,
}: {
  filter: FilterState
  setFilter: (patch: Partial<FilterState>) => void
  resetFilter: () => void
  statuses: KanbanStatus[]
  milestones: KanbanMilestone[]
  labelOptions: string[]
}) {
  const { t } = useTranslation('kanban')
  const selectedStatusIds = filter.statusIds ?? []
  const selectedPriorities = filter.priorities ?? []
  const selectedLabels = filter.labels ?? []
  const active = hasActiveFilter(filter)

  const toggle = <T,>(list: T[], value: T): T[] =>
    list.includes(value) ? list.filter(item => item !== value) : [...list, value]

  return (
    <Popover>
      <PopoverTrigger asChild>
        <ToolbarButton active={active} data-testid="kanban-filter-btn">
          <FilterIcon className="size-3.5" aria-hidden="true" />
          {t('filter.label')}
        </ToolbarButton>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-0">
        <div className="max-h-96 overflow-y-auto p-2">
          <FilterSection title={t('property.status')}>
            {statuses.map(status => (
              <FilterCheckbox
                key={status.id}
                id={`kanban-filter-status-${status.id}`}
                checked={selectedStatusIds.includes(status.id)}
                onChange={() => {
                  const next = toggle(selectedStatusIds, status.id)
                  setFilter({ statusIds: next.length > 0 ? next : undefined })
                }}
              >
                <StatusIcon category={status.category} size={13} />
                <span className="truncate">{status.name}</span>
              </FilterCheckbox>
            ))}
          </FilterSection>

          <FilterSection title={t('property.priority')}>
            {priorities.map(priority => (
              <FilterCheckbox
                key={priority}
                id={`kanban-filter-priority-${priority}`}
                checked={selectedPriorities.includes(priority)}
                onChange={() => {
                  const next = toggle(selectedPriorities, priority)
                  setFilter({ priorities: next.length > 0 ? next : undefined })
                }}
              >
                <PriorityIcon priority={priority} size={13} />
                <span>{t(priorityLabelKeys[priority])}</span>
              </FilterCheckbox>
            ))}
          </FilterSection>

          {labelOptions.length > 0 && (
            <FilterSection title={t('property.labels')}>
              {labelOptions.map(label => (
                <FilterCheckbox
                  key={label}
                  id={`kanban-filter-label-${label}`}
                  checked={selectedLabels.includes(label)}
                  onChange={() => {
                    const next = toggle(selectedLabels, label)
                    setFilter({ labels: next.length > 0 ? next : undefined })
                  }}
                >
                  <LabelChip label={label} />
                </FilterCheckbox>
              ))}
            </FilterSection>
          )}

          {milestones.length > 0 && (
            <FilterSection title={t('property.milestone')}>
              {milestones.map(milestone => (
                <FilterCheckbox
                  key={milestone.id}
                  id={`kanban-filter-milestone-${milestone.id}`}
                  checked={filter.milestoneId === milestone.id}
                  onChange={() => {
                    setFilter({
                      milestoneId: filter.milestoneId === milestone.id ? null : milestone.id,
                    })
                  }}
                >
                  <span className="truncate">{milestone.title}</span>
                </FilterCheckbox>
              ))}
            </FilterSection>
          )}

          <FilterSection title={t('property.agent')}>
            <FilterCheckbox
              id="kanban-filter-delegated"
              checked={filter.isDelegated === true}
              onChange={() => setFilter({ isDelegated: filter.isDelegated === true ? null : true })}
            >
              <span>{t('filter.delegatedOnly')}</span>
            </FilterCheckbox>
            <FilterCheckbox
              id="kanban-filter-not-delegated"
              checked={filter.isDelegated === false}
              onChange={() =>
                setFilter({ isDelegated: filter.isDelegated === false ? null : false })}
            >
              <span>{t('filter.notDelegated')}</span>
            </FilterCheckbox>
          </FilterSection>
        </div>

        {active && (
          <div className="border-t border-border p-2">
            <button
              type="button"
              onClick={resetFilter}
              className="w-full rounded-md px-2 py-1 text-left text-[12px] text-muted-foreground transition-colors hover:bg-fill hover:text-foreground"
            >
              {t('filter.clear')}
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

function FilterSection({ title, children }: { title: string, children: ReactNode }) {
  return (
    <div className="mb-2 last:mb-0">
      <p className="px-1 pb-1 text-[11px] font-medium text-muted-foreground">{title}</p>
      <div className="flex flex-col gap-0.5">{children}</div>
    </div>
  )
}

function FilterCheckbox({
  id,
  checked,
  onChange,
  children,
}: {
  id: string
  checked: boolean
  onChange: () => void
  children: ReactNode
}) {
  return (
    <label
      htmlFor={id}
      className="flex h-7 cursor-pointer items-center gap-2 rounded-md px-1 text-[12px] text-foreground transition-colors hover:bg-fill"
    >
      <Checkbox id={id} checked={checked} onCheckedChange={onChange} />
      {children}
    </label>
  )
}

function GroupByMenu({
  config,
  setConfig,
}: {
  config: ViewConfig
  setConfig: (patch: Partial<ViewConfig>) => void
}) {
  const { t } = useTranslation('kanban')
  const options = [
    { value: 'status', label: t('group.status') },
    { value: 'priority', label: t('group.priority') },
    { value: 'milestone', label: t('group.milestone') },
    { value: 'assignee', label: t('group.assignee') },
  ] as const
  const current = options.find(option => option.value === config.groupBy)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <ToolbarButton data-testid="kanban-group-btn">
          {t('group.label')}
          <span className="text-foreground">{current?.label}</span>
          <ChevronDownIcon className="size-3 opacity-60" aria-hidden="true" />
        </ToolbarButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuRadioGroup
          value={config.groupBy}
          onValueChange={value => setConfig({ groupBy: value as ViewConfig['groupBy'] })}
        >
          {options.map(option => (
            <DropdownMenuRadioItem key={option.value} value={option.value}>
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function SortMenu({
  config,
  setConfig,
}: {
  config: ViewConfig
  setConfig: (patch: Partial<ViewConfig>) => void
}) {
  const { t } = useTranslation('kanban')
  const options = [
    { value: 'manual', label: t('sort.manual') },
    { value: 'priority', label: t('sort.priority') },
    { value: 'status', label: t('sort.status') },
    { value: 'created', label: t('sort.created') },
    { value: 'updated', label: t('sort.updated') },
  ] as const
  const current = options.find(option => option.value === config.orderBy)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <ToolbarButton data-testid="kanban-sort-btn">
          {t('sort.label')}
          <span className="text-foreground">{current?.label}</span>
          <ChevronDownIcon className="size-3 opacity-60" aria-hidden="true" />
        </ToolbarButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuRadioGroup
          value={config.orderBy}
          onValueChange={value => setConfig({ orderBy: value as ViewConfig['orderBy'] })}
        >
          {options.map(option => (
            <DropdownMenuRadioItem key={option.value} value={option.value}>
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() =>
            setConfig({ orderDirection: config.orderDirection === 'asc' ? 'desc' : 'asc' })}
        >
          {config.orderDirection === 'asc' ? t('sort.asc') : t('sort.desc')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function DisplayMenu({
  config,
  setConfig,
}: {
  config: ViewConfig
  setConfig: (patch: Partial<ViewConfig>) => void
}) {
  const { t } = useTranslation('kanban')
  const properties: { key: keyof ViewConfig['displayProperties'], label: string }[] = [
    { key: 'id', label: t('display.id') },
    { key: 'priority', label: t('display.priority') },
    { key: 'status', label: t('display.status') },
    { key: 'labels', label: t('display.labels') },
    { key: 'assignee', label: t('display.assignee') },
    { key: 'agentIndicator', label: t('display.agentIndicator') },
    { key: 'milestone', label: t('display.milestone') },
    { key: 'dueDate', label: t('display.dueDate') },
    { key: 'createdAt', label: t('display.createdAt') },
  ]

  return (
    <Popover>
      <PopoverTrigger asChild>
        <ToolbarButton data-testid="kanban-display-btn">
          <SlidersHorizontalIcon className="size-3.5" aria-hidden="true" />
          {t('display.label')}
        </ToolbarButton>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-52 p-2">
        <div className="flex flex-col gap-0.5">
          {properties.map(property => (
            <label
              key={property.key}
              htmlFor={`kanban-display-${property.key}`}
              className="flex h-7 cursor-pointer items-center gap-2 rounded-md px-1 text-[12px] text-foreground transition-colors hover:bg-fill"
            >
              <Checkbox
                id={`kanban-display-${property.key}`}
                checked={config.displayProperties[property.key]}
                onCheckedChange={checked =>
                  setConfig({ displayProperties: { ...config.displayProperties, [property.key]: checked === true } })}
              />
              {property.label}
            </label>
          ))}
        </div>
        <div className="mt-1 border-t border-border pt-1">
          <label
            htmlFor="kanban-display-empty-groups"
            className="flex h-7 cursor-pointer items-center gap-2 rounded-md px-1 text-[12px] text-foreground transition-colors hover:bg-fill"
          >
            <Checkbox
              id="kanban-display-empty-groups"
              checked={config.showEmptyGroups}
              onCheckedChange={checked => setConfig({ showEmptyGroups: checked === true })}
            />
            {t('display.showEmptyGroups')}
          </label>
        </div>
      </PopoverContent>
    </Popover>
  )
}

function StatusManagerPopover({ workspaceId }: { workspaceId: string }) {
  const { t } = useTranslation('kanban')

  return (
    <Popover>
      <PopoverTrigger asChild>
        <ToolbarButton data-testid="kanban-status-manager-btn" aria-label={t('statusManager.aria')}>
          <CircleDotIcon className="size-3.5" aria-hidden="true" />
        </ToolbarButton>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-auto p-0">
        <StatusManager workspaceId={workspaceId} />
      </PopoverContent>
    </Popover>
  )
}
