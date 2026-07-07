import {
  Columns2Line as ColumnsIcon,
  DotCircleLine as CircleDotIcon,
  FilterLine as FilterIcon,
  GroupLine as GroupIcon,
  PlaylistLine as ListIcon,
  PlusLine as PlusIcon,
  SelectorHorizontalLine as SlidersHorizontalIcon,
  SortAscendingLine as SortAscIcon,
} from '@mingcute/react'
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
import { cn } from '~/lib/cn'

import { StatusManager } from './status-manager'
import type { FilterState, ViewConfig } from './use-view-config'

const priorityLabelKeys = {
  urgent: 'priority.urgent',
  high: 'priority.high',
  medium: 'priority.medium',
  low: 'priority.low',
  none: 'filter.none',
} as const

interface ToolbarProps {
  workspaceId: string
  config: ViewConfig
  setConfig: (patch: Partial<ViewConfig>) => void
  filter: FilterState
  setFilter: (patch: Partial<FilterState>) => void
  resetFilter: () => void
  searchQuery: string
  onSearchChange: (q: string) => void
  onCreateIssue?: () => void
}

function ToolbarPill({ children, active, className, ...props }: {
  children: React.ReactNode
  active?: boolean
  className?: string
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cn(
        'flex items-center justify-center size-8 rounded-full border border-border shadow-sm',
        'transition-[background-color,transform] duration-150 ease-out',
        'hover:bg-muted active:scale-[0.95]',
        active && 'bg-muted',
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
  searchQuery: _searchQuery,
  onSearchChange: _onSearchChange,
  onCreateIssue,
}: ToolbarProps) {
  const { t } = useTranslation('kanban')
  const hasFilter = !!(
    filter.statusIds?.length
    || filter.priorities?.length
    || filter.labels?.length
    || filter.milestoneId
    || filter.isDelegated != null
  )

  return (
    <div className="relative flex items-center gap-1 px-4 py-2">
      <div className="flex-1" />

      <div className="flex items-center gap-1">
        <FilterPopover filter={filter} setFilter={setFilter} resetFilter={resetFilter} hasFilter={hasFilter} />

        <GroupByDropdown config={config} setConfig={setConfig} />

        <SortDropdown config={config} setConfig={setConfig} />

        <DisplayPopover config={config} setConfig={setConfig} />

        <StatusManagerPopover workspaceId={workspaceId} />

        {onCreateIssue && (
          <ToolbarPill onClick={onCreateIssue} data-testid="kanban-create-issue-btn" aria-label={t('issue.createAria')}>
            <PlusIcon className="size-3.5" aria-hidden="true" />
          </ToolbarPill>
        )}

        <div className="flex items-center gap-0.5 ml-1 rounded-full border border-border p-0.5">
          <button
            onClick={() => setConfig({ layout: 'board' })}
            aria-label={t('layout.boardAria')}
            aria-pressed={config.layout === 'board'}
            className={cn(
              'flex items-center justify-center size-7 rounded-full transition-colors duration-100',
              config.layout === 'board' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <ColumnsIcon className="size-3.5" aria-hidden="true" />
          </button>
          <button
            onClick={() => setConfig({ layout: 'list' })}
            aria-label={t('layout.listAria')}
            aria-pressed={config.layout === 'list'}
            className={cn(
              'flex items-center justify-center size-7 rounded-full transition-colors duration-100',
              config.layout === 'list' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <ListIcon className="size-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  )
}

function StatusManagerPopover({ workspaceId }: { workspaceId: string }) {
  const { t } = useTranslation('kanban')

  return (
    <Popover>
      <PopoverTrigger asChild>
        <ToolbarPill data-testid="kanban-status-manager-btn" aria-label={t('statusManager.aria')}>
          <CircleDotIcon className="size-3.5" aria-hidden="true" />
        </ToolbarPill>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-auto p-0">
        <StatusManager workspaceId={workspaceId} />
      </PopoverContent>
    </Popover>
  )
}

function FilterPopover({ filter, setFilter, resetFilter, hasFilter }: {
  filter: FilterState
  setFilter: (patch: Partial<FilterState>) => void
  resetFilter: () => void
  hasFilter: boolean
}) {
  const { t } = useTranslation('kanban')
  const priorities = ['urgent', 'high', 'medium', 'low', 'none'] as const
  const selectedPriorities = filter.priorities ?? []

  return (
    <Popover>
      <PopoverTrigger asChild>
        <ToolbarPill active={hasFilter} data-testid="kanban-filter-btn" aria-label={t('filter.aria')}>
          <FilterIcon className="size-3.5" aria-hidden="true" />
        </ToolbarPill>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 p-0">
        <div className="p-3 space-y-3">
          <div>
            <p className="text-[12px] font-medium text-muted-foreground mb-1.5">{t('filter.priority')}</p>
            <div className="space-y-1">
              {priorities.map(p => (
                <label
                  key={p}
                  htmlFor={`kanban-filter-priority-${p}`}
                  className="flex items-center gap-2 text-[13px] cursor-pointer"
                >
                  <Checkbox
                    id={`kanban-filter-priority-${p}`}
                    checked={selectedPriorities.includes(p)}
                    onCheckedChange={(checked) => {
                      const next = checked
                        ? [...selectedPriorities, p]
                        : selectedPriorities.filter(x => x !== p)
                      setFilter({ priorities: next.length ? next : undefined })
                    }}
                  />
                  <span className="capitalize">{t(priorityLabelKeys[p])}</span>
                </label>
              ))}
            </div>
          </div>
          <div>
            <label htmlFor="kanban-filter-delegated" className="flex items-center gap-2 text-[13px] cursor-pointer">
              <Checkbox
                id="kanban-filter-delegated"
                checked={filter.isDelegated === true}
                onCheckedChange={(checked) => {
                  setFilter({ isDelegated: checked ? true : null })
                }}
              />
              {t('filter.delegatedOnly')}
            </label>
          </div>
          {hasFilter && (
            <button onClick={resetFilter} className="text-[12px] text-muted-foreground hover:text-foreground">
              {t('filter.clear')}
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function GroupByDropdown({ config, setConfig }: { config: ViewConfig, setConfig: (p: Partial<ViewConfig>) => void }) {
  const { t } = useTranslation('kanban')
  const options = [
    { value: 'status', label: t('group.status') },
    { value: 'priority', label: t('group.priority') },
    { value: 'milestone', label: t('group.milestone') },
    { value: 'assignee', label: t('group.assignee') },
    { value: 'label', label: t('group.label') },
  ] as const

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <ToolbarPill data-testid="kanban-group-btn" aria-label={t('group.aria')}>
          <GroupIcon className="size-3.5" aria-hidden="true" />
        </ToolbarPill>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-36">
        <DropdownMenuRadioGroup value={config.groupBy} onValueChange={v => setConfig({ groupBy: v as ViewConfig['groupBy'] })}>
          {options.map(opt => (
            <DropdownMenuRadioItem key={opt.value} value={opt.value}>
              {opt.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function SortDropdown({ config, setConfig }: { config: ViewConfig, setConfig: (p: Partial<ViewConfig>) => void }) {
  const { t } = useTranslation('kanban')
  const options = [
    { value: 'manual', label: t('sort.manual') },
    { value: 'priority', label: t('sort.priority') },
    { value: 'created', label: t('sort.created') },
    { value: 'updated', label: t('sort.updated') },
    { value: 'status', label: t('sort.status') },
  ] as const

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <ToolbarPill data-testid="kanban-sort-btn" aria-label={t('sort.aria')}>
          <SortAscIcon className="size-3.5" aria-hidden="true" />
        </ToolbarPill>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-36">
        <DropdownMenuRadioGroup value={config.orderBy} onValueChange={v => setConfig({ orderBy: v as ViewConfig['orderBy'] })}>
          {options.map(opt => (
            <DropdownMenuRadioItem key={opt.value} value={opt.value}>
              {opt.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => setConfig({ orderDirection: config.orderDirection === 'asc' ? 'desc' : 'asc' })}>
          {config.orderDirection === 'asc' ? t('sort.asc') : t('sort.desc')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function DisplayPopover({ config, setConfig }: { config: ViewConfig, setConfig: (p: Partial<ViewConfig>) => void }) {
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
        <ToolbarPill data-testid="kanban-display-btn" aria-label={t('display.aria')}>
          <SlidersHorizontalIcon className="size-3.5" aria-hidden="true" />
        </ToolbarPill>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-48 p-0">
        <div className="p-2">
          {properties.map(p => (
            <label
              key={p.key}
              htmlFor={`kanban-display-${p.key}`}
              className="flex items-center gap-2 text-[13px] cursor-pointer px-1 py-0.5 rounded hover:bg-muted"
            >
              <Checkbox
                id={`kanban-display-${p.key}`}
                checked={config.displayProperties[p.key]}
                onCheckedChange={(checked) => {
                  setConfig({ displayProperties: { ...config.displayProperties, [p.key]: !!checked } })
                }}
              />
              {p.label}
            </label>
          ))}
          <div className="border-t border-border mt-1 pt-1">
            <label htmlFor="kanban-display-empty-groups" className="flex items-center gap-2 text-[13px] cursor-pointer px-1 py-0.5 rounded hover:bg-muted">
              <Checkbox
                id="kanban-display-empty-groups"
                checked={config.showEmptyGroups}
                onCheckedChange={checked => setConfig({ showEmptyGroups: !!checked })}
              />
              {t('display.showEmptyGroups')}
            </label>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
