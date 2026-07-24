import {
  DeleteLine as Trash2Icon,
  PlusLine as PlusIcon,
  SearchLine as SearchIcon,
  UploadLine as UploadIcon,
} from '@mingcute/react'
import type { ReactNode } from 'react'

import { Button } from '~/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import { Spinner } from '~/components/ui/spinner'
import { TruncatedText } from '~/components/ui/truncated-text'
import { SettingsDivider, SettingsSectionHeader } from '~/features/settings/settings-row'
import { cn } from '~/lib/cn'

import type { EditableSkillScope } from './skill-manager-contract'
import {
  skillScopeAccentClasses,
  skillScopeIcons,
  skillScopeLabels,
} from './skill-scope-presentation'
import type { SkillInventoryEntry, SkillScope } from './types'

interface SkillManagerViewProps {
  pageTestId: string
  title: string
  description: string
  editableScope: EditableSkillScope
  skillsReady: boolean
  isLoading: boolean
  errorText: string | null
  searchQuery: string
  scopeFilter: SkillScope | 'all'
  scopes: SkillScope[]
  inventory: SkillInventoryEntry[]
  detailOpen: boolean
  detail: ReactNode
  onImport: () => void
  onNew: () => void
  onSearchQueryChange: (query: string) => void
  onScopeFilterChange: (scope: SkillScope | 'all') => void
  onOpenDetail: (entry: SkillInventoryEntry) => void
  onDelete: (entry: SkillInventoryEntry) => void
  onDetailOpenChange: (open: boolean) => void
}

export function SkillManagerView({
  pageTestId,
  title,
  description,
  editableScope,
  skillsReady,
  isLoading,
  errorText,
  searchQuery,
  scopeFilter,
  scopes,
  inventory,
  detailOpen,
  detail,
  onImport,
  onNew,
  onSearchQueryChange,
  onScopeFilterChange,
  onOpenDetail,
  onDelete,
  onDetailOpenChange,
}: SkillManagerViewProps) {
  return (
    <div
      className="flex flex-col gap-1"
      data-testid={pageTestId}
      data-workspace-skills-ready={
        editableScope === 'workspace' && skillsReady ? 'true' : 'false'
      }
    >
      <SettingsSectionHeader
        title={title}
        description={description}
        className="pt-3"
        action={(
          <div className="flex items-center gap-1.5">
            <Button
              variant="ghost"
              size="sm"
              onClick={onImport}
              data-testid="skill-import-btn"
              className="text-muted-foreground hover:text-foreground"
            >
              <UploadIcon className="size-3.5" />
              Import
            </Button>
            <Button size="sm" onClick={onNew} data-testid="new-skill-btn">
              <PlusIcon className="size-3.5" />
              New
            </Button>
          </div>
        )}
      />

      <SettingsDivider />

      {errorText && <p className="text-[11px] text-destructive">{errorText}</p>}

      <div className="flex items-center gap-3 py-2">
        <div className="relative flex-1">
          <SearchIcon className="absolute top-1/2 left-2.5 size-3 -translate-y-1/2 !text-muted-foreground/50" />
          <input
            type="text"
            aria-label="Search skills"
            value={searchQuery}
            onChange={event => onSearchQueryChange(event.target.value)}
            placeholder="Search skills..."
            className="w-full rounded-md bg-foreground/4 py-1.5 pr-3 pl-8 text-xs text-foreground outline-none placeholder:text-muted-foreground/40"
          />
        </div>
        <div className="flex items-center gap-0.5">
          {(['all' as const, ...scopes] as const).map(scope => (
            <button
              key={scope}
              type="button"
              onClick={() => onScopeFilterChange(scope)}
              className={cn(
                'rounded-md px-2 py-1 text-[11px] font-medium transition-colors',
                scopeFilter === scope
                  ? 'bg-foreground/8 text-foreground'
                  : 'text-muted-foreground/50 hover:text-muted-foreground',
              )}
            >
              {scope === 'all' ? 'All' : skillScopeLabels[scope]}
            </button>
          ))}
        </div>
      </div>

      {isLoading
        ? (
            <div className="flex justify-center py-12">
              <Spinner className="size-4 text-muted-foreground" />
            </div>
          )
        : inventory.length === 0
          ? (
              <div className="py-12 text-center text-xs text-muted-foreground">
                {searchQuery.trim() ? 'No matching skills' : 'No skills yet'}
              </div>
            )
          : (
              <div className="flex flex-col divide-y divide-foreground/5">
                {inventory.map((entry) => {
                  const Icon = skillScopeIcons[entry.scope]
                  const isEditable = entry.scope === editableScope

                  return (
                    <div
                      key={`${entry.scope}:${entry.name}`}
                      className="group -mx-2 flex items-center gap-2 rounded-md px-2 transition-colors hover:bg-foreground/3"
                    >
                      <button
                        type="button"
                        aria-label={`Open ${entry.name} details`}
                        onClick={() => onOpenDetail(entry)}
                        className="flex min-w-0 flex-1 items-center gap-3 py-3 text-left"
                      >
                        <span
                          className={cn(
                            'flex size-7 shrink-0 items-center justify-center rounded-lg',
                            skillScopeAccentClasses[entry.scope],
                          )}
                        >
                          <Icon className="size-3.5" aria-hidden="true" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-medium text-foreground">
                            {entry.name}
                          </span>
                          <TruncatedText
                            maxLines={1}
                            className="text-[11px] text-muted-foreground/60"
                          >
                            {entry.description}
                          </TruncatedText>
                        </span>
                        <span className="text-[10px] text-muted-foreground/40">
                          {skillScopeLabels[entry.scope]}
                        </span>
                      </button>
                      {isEditable && (
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          className="shrink-0 text-muted-foreground/40 opacity-0 hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100"
                          aria-label={`Delete ${entry.name} from list`}
                          onClick={() => onDelete(entry)}
                        >
                          <Trash2Icon aria-hidden="true" />
                        </Button>
                      )}
                    </div>
                  )
                })}
              </div>
            )}

      <Dialog open={detailOpen} onOpenChange={onDetailOpenChange}>
        <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-xl" showCloseButton>
          <DialogHeader>
            <DialogTitle>Skill Detail</DialogTitle>
          </DialogHeader>
          {detail}
        </DialogContent>
      </Dialog>
    </div>
  )
}
