import {
  DownSmallLine as ChevronDownIcon,
  FilterLine as FilterIcon,
  FolderLine as FolderIcon,
  FolderOpenLine as FolderOpenIcon,
  LoadingLine,
  MailOpenLine as MarkReadIcon,
  NewFolderLine as FolderPlusIcon,
  PlusLine as PlusIcon,
  TransferVerticalLine as SortIcon,
} from '@mingcute/react'
import type { ReactNode } from 'react'
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
  MenuTrigger,
} from '~/components/ui/menu'
import { cn } from '~/lib/cn'

import type {
  WorkspaceSidebarProjectFilter,
  WorkspaceSidebarProjectSortDirection,
  WorkspaceSidebarProjectSortKey,
} from './workspace-sidebar-ui-store'

const PROJECT_FILTER_OPTIONS: readonly WorkspaceSidebarProjectFilter[] = [
  'all',
  'pinned',
  'unpinned',
  'unread',
  'running',
  'recent',
]
const PROJECT_SORT_OPTIONS: readonly WorkspaceSidebarProjectSortKey[] = [
  'name',
  'updatedAt',
  'createdAt',
]
const PROJECT_SORT_DIRECTION_OPTIONS:
readonly WorkspaceSidebarProjectSortDirection[] = ['asc', 'desc']

export interface WorkspaceProjectsSectionViewProps {
  hasWorkspaces: boolean
  filteredEmpty: boolean
  projectFilter: WorkspaceSidebarProjectFilter
  projectSortKey: WorkspaceSidebarProjectSortKey
  projectSortDirection: WorkspaceSidebarProjectSortDirection
  projectPinnedFirst: boolean
  adding: boolean
  multiWorkspaceEnabled: boolean
  hasUnreadWorkspaceSessions: boolean
  markingAllSessionsRead: boolean
  children: ReactNode
  onProjectFilterChange: (filter: WorkspaceSidebarProjectFilter) => void
  onProjectSortKeyChange: (sortKey: WorkspaceSidebarProjectSortKey) => void
  onProjectSortDirectionChange: (
    direction: WorkspaceSidebarProjectSortDirection,
  ) => void
  onProjectPinnedFirstChange: (pinnedFirst: boolean) => void
  onAddFromPicker: () => void
  onOpenMultiWorkspaceDialog: () => void
  onMarkAllAsRead: () => void
}

export function WorkspaceProjectsSectionView({
  hasWorkspaces,
  filteredEmpty,
  projectFilter,
  projectSortKey,
  projectSortDirection,
  projectPinnedFirst,
  adding,
  multiWorkspaceEnabled,
  hasUnreadWorkspaceSessions,
  markingAllSessionsRead,
  children,
  onProjectFilterChange,
  onProjectSortKeyChange,
  onProjectSortDirectionChange,
  onProjectPinnedFirstChange,
  onAddFromPicker,
  onOpenMultiWorkspaceDialog,
  onMarkAllAsRead,
}: WorkspaceProjectsSectionViewProps) {
  const { t } = useTranslation('workspace')
  const customSort = projectSortKey !== 'name'
    || projectSortDirection !== 'asc'
    || !projectPinnedFirst

  return (
    <div className="flex min-w-0 flex-col">
      <div className="flex items-center px-2.5 py-1.5">
        <span className="flex-1 select-none text-[11px] font-medium text-muted-foreground">
          {t('sidebar.projects.title')}
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
                    customSort && 'text-foreground',
                  )}
                  title={t('sidebar.action.sort')}
                  aria-label={t('sidebar.action.sort')}
                  data-testid="workspace-sort-menu-trigger"
                />
              )}
            >
              <SortIcon className="size-3" />
            </MenuTrigger>
            <MenuPopup
              align="end"
              side="bottom"
              sideOffset={4}
              className="w-48"
            >
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
              <MenuSeparator />
              <MenuCheckboxItem
                checked={projectPinnedFirst}
                onCheckedChange={onProjectPinnedFirstChange}
              >
                {t('sidebar.sort.pinnedFirst')}
              </MenuCheckboxItem>
            </MenuPopup>
          </Menu>
          <Menu>
            <MenuTrigger
              render={(
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className={cn(
                    'size-6 text-muted-foreground/60 hover:bg-fill/70 hover:text-foreground',
                    projectFilter !== 'all' && 'text-foreground',
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
              align="end"
              side="bottom"
              sideOffset={4}
              className="w-44"
            >
              <MenuGroup>
                <MenuGroupLabel>{t('sidebar.filter.show')}</MenuGroupLabel>
                <MenuRadioGroup
                  value={projectFilter}
                  onValueChange={value =>
                    onProjectFilterChange(
                      value as WorkspaceSidebarProjectFilter,
                    )}
                >
                  {PROJECT_FILTER_OPTIONS.map(filter => (
                    <MenuRadioItem key={filter} value={filter}>
                      {t(`sidebar.filter.option.${filter}`)}
                    </MenuRadioItem>
                  ))}
                </MenuRadioGroup>
              </MenuGroup>
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
                  onClick={() => onProjectFilterChange('all')}
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
