import {
  DownSmallLine as ChevronDownIcon,
  FilterLine as FilterIcon,
  FolderLine as FolderIcon,
  FolderOpenLine as FolderOpenIcon,
  LoadingLine,
  MailOpenLine as MarkReadIcon,
  NewFolderLine as FolderPlusIcon,
  PlusLine as PlusIcon,
} from '@mingcute/react'
import type { ComponentProps, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '~/components/ui/button'
import {
  Menu,
  MenuCheckboxItem,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from '~/components/ui/menu'
import { cn } from '~/lib/cn'

import type { WorkspaceSidebarListFilters, WorkspaceSidebarProjectScope, WorkspaceSidebarProjectSortDirection, WorkspaceSidebarProjectSortKey, WorkspaceSidebarSourceFilter, WorkspaceSidebarStatusFilter, WorkspaceSidebarWorkPrFilter } from './workspace-sidebar-ui-store'
import {
  DEFAULT_SESSION_PREVIEW_LIMIT,
  listFiltersAreActive,
  SESSION_PREVIEW_LIMIT_OPTIONS,
  WORKSPACE_SIDEBAR_SOURCE_FILTERS,
  WORKSPACE_SIDEBAR_STATUS_FILTERS,
  WORKSPACE_SIDEBAR_WORK_PR_FILTERS,
} from './workspace-sidebar-ui-store'

const PROJECT_SORT_OPTIONS: readonly WorkspaceSidebarProjectSortKey[] = [
  'name',
  'updatedAt',
  'createdAt',
  'recentSession',
]
const PROJECT_SORT_DIRECTION_OPTIONS:
readonly WorkspaceSidebarProjectSortDirection[] = ['asc', 'desc']
const PROJECT_SCOPE_OPTIONS: readonly WorkspaceSidebarProjectScope[] = [
  'all',
  'pinned',
]

function joinFacetLabels(labels: readonly string[], emptyLabel: string): string {
  if (labels.length === 0) {
    return emptyLabel
  }
  if (labels.length <= 2) {
    return labels.join(', ')
  }
  return `${labels[0]}, +${labels.length - 1}`
}

const SUB_POPUP_PROPS = {
  collisionAvoidance: { side: 'none', align: 'shift' },
} as const

function MenuFacetSubTrigger({
  label,
  value,
  ...props
}: {
  label: string
  value: string
} & Omit<ComponentProps<typeof MenuSubTrigger>, 'children'>) {
  return (
    <MenuSubTrigger {...props}>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="max-w-28 shrink-0 truncate text-muted-foreground text-xs">
        {value}
      </span>
    </MenuSubTrigger>
  )
}

export interface WorkspaceProjectsSectionViewProps {
  hasWorkspaces: boolean
  filteredEmpty: boolean
  listFilters: WorkspaceSidebarListFilters
  projectSortKey: WorkspaceSidebarProjectSortKey
  projectSortDirection: WorkspaceSidebarProjectSortDirection
  projectPinnedFirst: boolean
  sessionPreviewLimit: number
  adding: boolean
  multiWorkspaceEnabled: boolean
  hasUnreadWorkspaceSessions: boolean
  markingAllSessionsRead: boolean
  children: ReactNode
  onProjectScopeChange: (scope: WorkspaceSidebarProjectScope) => void
  onToggleStatusFilter: (filter: WorkspaceSidebarStatusFilter) => void
  onToggleWorkPrFilter: (filter: WorkspaceSidebarWorkPrFilter) => void
  onToggleSourceFilter: (filter: WorkspaceSidebarSourceFilter) => void
  onShowArchivedChange: (showArchived: boolean) => void
  onClearListFilters: () => void
  onProjectSortKeyChange: (sortKey: WorkspaceSidebarProjectSortKey) => void
  onProjectSortDirectionChange: (
    direction: WorkspaceSidebarProjectSortDirection,
  ) => void
  onProjectPinnedFirstChange: (pinnedFirst: boolean) => void
  onSessionPreviewLimitChange: (limit: number) => void
  onCollapseAll: () => void
  onAddFromPicker: () => void
  onOpenMultiWorkspaceDialog: () => void
  onMarkAllAsRead: () => void
}

export function WorkspaceProjectsSectionView({
  hasWorkspaces,
  filteredEmpty,
  listFilters,
  projectSortKey,
  projectSortDirection,
  projectPinnedFirst,
  sessionPreviewLimit,
  adding,
  multiWorkspaceEnabled,
  hasUnreadWorkspaceSessions,
  markingAllSessionsRead,
  children,
  onProjectScopeChange,
  onToggleStatusFilter,
  onToggleWorkPrFilter,
  onToggleSourceFilter,
  onShowArchivedChange,
  onClearListFilters,
  onProjectSortKeyChange,
  onProjectSortDirectionChange,
  onProjectPinnedFirstChange,
  onSessionPreviewLimitChange,
  onCollapseAll,
  onAddFromPicker,
  onOpenMultiWorkspaceDialog,
  onMarkAllAsRead,
}: WorkspaceProjectsSectionViewProps) {
  const { t } = useTranslation('workspace')
  const filtersActive = listFiltersAreActive(listFilters)
  const customView = projectSortKey !== 'name'
    || projectSortDirection !== 'asc'
    || !projectPinnedFirst
    || sessionPreviewLimit !== DEFAULT_SESSION_PREVIEW_LIMIT
  const controlActive = filtersActive || customView

  const orderingLabel = t(`sidebar.sort.option.${projectSortKey}`)
  const scopeLabel = t(`sidebar.filter.scope.${listFilters.projectScope}`)
  const statusLabel = joinFacetLabels(
    listFilters.statusFilters.map(filter => t(`sidebar.filter.status.${filter}`)),
    t('sidebar.filter.any'),
  )
  const workPrLabel = joinFacetLabels(
    listFilters.workPrFilters.map(filter => t(`sidebar.filter.workPr.${filter}`)),
    t('sidebar.filter.any'),
  )
  const sourceLabel = joinFacetLabels(
    listFilters.sourceFilters.map(filter => t(`sidebar.filter.source.${filter}`)),
    t('sidebar.filter.any'),
  )

  return (
    <div className="flex min-w-0 flex-col">
      <div className="flex items-center px-2.5 py-1.5">
        <span className="flex-1 select-none text-[11px] font-medium text-muted-foreground">
          {t(
            projectSortKey === 'recentSession'
              ? 'sidebar.projects.recentTitle'
              : 'sidebar.projects.title',
          )}
        </span>
        <div className="flex items-center gap-0.5">
          {hasUnreadWorkspaceSessions
            ? (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="size-6 text-muted-foreground/60 hover:bg-fill/70 hover:text-foreground"
                  onClick={onMarkAllAsRead}
                  disabled={markingAllSessionsRead}
                  title={t('sidebar.action.markAllRead')}
                  aria-label={t('sidebar.action.markAllRead')}
                  data-testid="workspace-mark-all-read-btn"
                >
                  {markingAllSessionsRead
                    ? <LoadingLine className="size-3 animate-spin" />
                    : <MarkReadIcon className="size-3" />}
                </Button>
              )
            : null}
          <Menu>
            <MenuTrigger
              render={(
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className={cn(
                    'size-6 text-muted-foreground/60 hover:bg-fill/70 hover:text-foreground',
                    controlActive && 'text-foreground',
                  )}
                  title={t('sidebar.action.filter')}
                  aria-label={t('sidebar.action.filter')}
                  data-testid="workspace-filter-menu-trigger"
                />
              )}
            >
              <FilterIcon className="size-3" />
            </MenuTrigger>
            <MenuPopup
              align="start"
              side="right"
              sideOffset={4}
              className="w-52"
            >
              <MenuSub>
                <MenuFacetSubTrigger
                  data-testid="workspace-scope-submenu"
                  label={t('sidebar.filter.scope')}
                  value={scopeLabel}
                />
                <MenuSubPopup {...SUB_POPUP_PROPS} className="w-40">
                  <MenuRadioGroup
                    value={listFilters.projectScope}
                    onValueChange={value =>
                      onProjectScopeChange(value as WorkspaceSidebarProjectScope)}
                  >
                    {PROJECT_SCOPE_OPTIONS.map(scope => (
                      <MenuRadioItem key={scope} value={scope}>
                        {t(`sidebar.filter.scope.${scope}`)}
                      </MenuRadioItem>
                    ))}
                  </MenuRadioGroup>
                </MenuSubPopup>
              </MenuSub>

              <MenuSub>
                <MenuFacetSubTrigger
                  data-testid="workspace-ordering-submenu"
                  label={t('sidebar.sort.by')}
                  value={orderingLabel}
                />
                <MenuSubPopup {...SUB_POPUP_PROPS} className="w-44">
                  <MenuGroup>
                    <MenuGroupLabel>{t('sidebar.sort.by')}</MenuGroupLabel>
                    <MenuRadioGroup
                      value={projectSortKey}
                      onValueChange={value =>
                        onProjectSortKeyChange(
                          value as WorkspaceSidebarProjectSortKey,
                        )}
                    >
                      {PROJECT_SORT_OPTIONS.map(sortKey => (
                        <MenuRadioItem key={sortKey} value={sortKey}>
                          {t(`sidebar.sort.option.${sortKey}`)}
                        </MenuRadioItem>
                      ))}
                    </MenuRadioGroup>
                  </MenuGroup>
                  <MenuSeparator />
                  <MenuGroup>
                    <MenuGroupLabel>
                      {t('sidebar.sort.direction')}
                    </MenuGroupLabel>
                    <MenuRadioGroup
                      value={projectSortDirection}
                      onValueChange={value =>
                        onProjectSortDirectionChange(
                          value as WorkspaceSidebarProjectSortDirection,
                        )}
                    >
                      {PROJECT_SORT_DIRECTION_OPTIONS.map(direction => (
                        <MenuRadioItem key={direction} value={direction}>
                          {t(`sidebar.sort.direction.${direction}`)}
                        </MenuRadioItem>
                      ))}
                    </MenuRadioGroup>
                  </MenuGroup>
                </MenuSubPopup>
              </MenuSub>

              <MenuCheckboxItem
                variant="switch"
                checked={projectPinnedFirst}
                onCheckedChange={onProjectPinnedFirstChange}
              >
                {t('sidebar.sort.pinnedFirst')}
              </MenuCheckboxItem>

              <MenuSub>
                <MenuFacetSubTrigger
                  data-testid="workspace-show-submenu"
                  label={t('sidebar.filter.show')}
                  value={t('sidebar.filter.showCount', { count: sessionPreviewLimit })}
                />
                <MenuSubPopup {...SUB_POPUP_PROPS} className="w-40">
                  <MenuRadioGroup
                    value={String(sessionPreviewLimit)}
                    onValueChange={value =>
                      onSessionPreviewLimitChange(Number(value))}
                  >
                    {SESSION_PREVIEW_LIMIT_OPTIONS.map(limit => (
                      <MenuRadioItem key={limit} value={String(limit)}>
                        {t('sidebar.filter.showCount', { count: limit })}
                      </MenuRadioItem>
                    ))}
                  </MenuRadioGroup>
                </MenuSubPopup>
              </MenuSub>

              <MenuSeparator />
              <MenuGroup>
                <MenuGroupLabel>{t('sidebar.filter.section')}</MenuGroupLabel>

                <MenuSub>
                  <MenuFacetSubTrigger
                    data-testid="workspace-status-submenu"
                    label={t('sidebar.filter.status')}
                    value={statusLabel}
                  />
                  <MenuSubPopup {...SUB_POPUP_PROPS} className="w-44">
                    {WORKSPACE_SIDEBAR_STATUS_FILTERS.map(filter => (
                      <MenuCheckboxItem
                        key={filter}
                        checked={listFilters.statusFilters.includes(filter)}
                        onCheckedChange={() => onToggleStatusFilter(filter)}
                      >
                        {t(`sidebar.filter.status.${filter}`)}
                      </MenuCheckboxItem>
                    ))}
                  </MenuSubPopup>
                </MenuSub>

                <MenuSub>
                  <MenuFacetSubTrigger
                    data-testid="workspace-work-pr-submenu"
                    label={t('sidebar.filter.workPr')}
                    value={workPrLabel}
                  />
                  <MenuSubPopup {...SUB_POPUP_PROPS} className="w-44">
                    {WORKSPACE_SIDEBAR_WORK_PR_FILTERS.map(filter => (
                      <MenuCheckboxItem
                        key={filter}
                        checked={listFilters.workPrFilters.includes(filter)}
                        onCheckedChange={() => onToggleWorkPrFilter(filter)}
                      >
                        {t(`sidebar.filter.workPr.${filter}`)}
                      </MenuCheckboxItem>
                    ))}
                  </MenuSubPopup>
                </MenuSub>

                <MenuSub>
                  <MenuFacetSubTrigger
                    data-testid="workspace-source-submenu"
                    label={t('sidebar.filter.source')}
                    value={sourceLabel}
                  />
                  <MenuSubPopup {...SUB_POPUP_PROPS} className="w-44">
                    {WORKSPACE_SIDEBAR_SOURCE_FILTERS.map(filter => (
                      <MenuCheckboxItem
                        key={filter}
                        checked={listFilters.sourceFilters.includes(filter)}
                        onCheckedChange={() => onToggleSourceFilter(filter)}
                      >
                        {t(`sidebar.filter.source.${filter}`)}
                      </MenuCheckboxItem>
                    ))}
                  </MenuSubPopup>
                </MenuSub>

                <MenuCheckboxItem
                  variant="switch"
                  checked={listFilters.showArchived}
                  onCheckedChange={onShowArchivedChange}
                  data-testid="workspace-archived-filter"
                >
                  {t('sidebar.filter.archived')}
                </MenuCheckboxItem>

                {filtersActive
                  ? (
                      <MenuItem
                        onClick={onClearListFilters}
                        data-testid="workspace-filter-clear-menu-btn"
                      >
                        {t('sidebar.filter.clear')}
                      </MenuItem>
                    )
                  : null}
              </MenuGroup>

              <MenuSeparator />

              <MenuItem
                onClick={onCollapseAll}
                disabled={!hasWorkspaces}
                data-testid="workspace-collapse-all-btn"
              >
                {t('sidebar.action.collapseAll')}
              </MenuItem>
              <MenuItem
                onClick={onMarkAllAsRead}
                disabled={!hasUnreadWorkspaceSessions || markingAllSessionsRead}
                data-testid="workspace-mark-all-read-menu-btn"
              >
                {markingAllSessionsRead
                  ? <LoadingLine className="size-3.5 animate-spin" />
                  : null}
                {t('sidebar.action.markAllRead')}
              </MenuItem>
            </MenuPopup>
          </Menu>
          {multiWorkspaceEnabled
            ? (
                <Menu>
                  <MenuTrigger
                    render={(
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        className="size-6 text-muted-foreground/60 hover:bg-fill/70 hover:text-foreground"
                        disabled={adding}
                        title={t('sidebar.action.addProject')}
                        data-testid="add-workspace-menu-btn"
                      />
                    )}
                  >
                    <ChevronDownIcon className="size-3" />
                  </MenuTrigger>
                  <MenuPopup
                    align="end"
                    side="bottom"
                    sideOffset={4}
                    className="w-52"
                  >
                    <MenuItem onClick={onAddFromPicker} disabled={adding}>
                      <FolderPlusIcon className="size-3" />
                      {t('sidebar.action.addProject')}
                    </MenuItem>
                    <MenuItem onClick={onOpenMultiWorkspaceDialog}>
                      <FolderIcon className="size-3" />
                      {t('sidebar.action.addMultiWorkspace')}
                    </MenuItem>
                  </MenuPopup>
                </Menu>
              )
            : (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="size-6 text-muted-foreground/60 hover:bg-fill/70 hover:text-foreground"
                  onClick={onAddFromPicker}
                  disabled={adding}
                  title={t('sidebar.action.addProject')}
                  data-testid="add-workspace-btn"
                >
                  <PlusIcon className="size-3" />
                </Button>
              )}
        </div>
      </div>

      <nav
        className="flex min-w-0 flex-col gap-0.5 px-2 pb-2"
        data-testid="workspace-list"
      >
        {!hasWorkspaces
          ? (
              <div className="flex flex-col items-center gap-3 px-4 py-8 text-center">
                <div className="flex size-10 items-center justify-center rounded-xl bg-muted/60">
                  <FolderOpenIcon
                    className="size-5 !text-muted-foreground/50"
                    aria-hidden="true"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <p className="text-xs font-medium text-muted-foreground">
                    {t('sidebar.projects.empty.title')}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {t('sidebar.projects.empty.description')}
                  </p>
                </div>
                {multiWorkspaceEnabled
                  ? (
                      <Menu>
                        <MenuTrigger
                          render={(
                            <Button
                              variant="outline"
                              size="xs"
                              disabled={adding}
                              className="mt-1 border-dashed"
                              data-testid="add-workspace-empty-menu-btn"
                            />
                          )}
                        >
                          <PlusIcon />
                          {t('sidebar.action.addProject')}
                        </MenuTrigger>
                        <MenuPopup
                          align="center"
                          side="bottom"
                          sideOffset={4}
                          className="w-52"
                        >
                          <MenuItem
                            onClick={onAddFromPicker}
                            disabled={adding}
                          >
                            <FolderPlusIcon className="size-3" />
                            {t('sidebar.action.addProject')}
                          </MenuItem>
                          <MenuItem onClick={onOpenMultiWorkspaceDialog}>
                            <FolderIcon className="size-3" />
                            {t('sidebar.action.addMultiWorkspace')}
                          </MenuItem>
                        </MenuPopup>
                      </Menu>
                    )
                  : (
                      <Button
                        variant="outline"
                        size="xs"
                        onClick={onAddFromPicker}
                        disabled={adding}
                        className="mt-1 border-dashed"
                        data-testid="add-workspace-empty-btn"
                      >
                        <PlusIcon />
                        {t('sidebar.action.addProject')}
                      </Button>
                    )}
              </div>
            )
          : null}
        {filteredEmpty
          ? (
              <div className="flex flex-col items-center gap-2 px-4 py-6 text-center">
                <div className="flex size-9 items-center justify-center rounded-xl bg-muted/60">
                  <FilterIcon
                    className="size-4 !text-muted-foreground/50"
                    aria-hidden="true"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <p className="text-xs font-medium text-muted-foreground">
                    {t('sidebar.projects.filteredEmpty.title')}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {t('sidebar.projects.filteredEmpty.description')}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={onClearListFilters}
                  data-testid="workspace-filter-clear-btn"
                >
                  {t('sidebar.filter.clear')}
                </Button>
              </div>
            )
          : children}
      </nav>
    </div>
  )
}
