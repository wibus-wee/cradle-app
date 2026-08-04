import { DownSmallLine as ChevronDownIcon, GitBranchLine as GitBranchIcon } from '@mingcute/react'
import { useDeferredValue, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '~/components/ui/popover'
import { cn } from '~/lib/cn'

export interface NewWorkBranchOption {
  name: string
  scope: 'local' | 'remote'
}

export interface NewWorkBaseBranchControlViewProps {
  currentBranch: string | null
  selectedBranch: string | null
  branches: readonly NewWorkBranchOption[]
  loading?: boolean
  defaultOpen?: boolean
  onSelectBranch: (branch: string | null) => void
}

export function NewWorkBaseBranchControlView({
  currentBranch,
  selectedBranch,
  branches,
  loading = false,
  defaultOpen = false,
  onSelectBranch,
}: NewWorkBaseBranchControlViewProps) {
  const { t } = useTranslation('work')
  const [open, setOpen] = useState(defaultOpen)
  const [search, setSearch] = useState('')
  const deferredSearch = useDeferredValue(search.trim().toLowerCase())
  const branchLabel = selectedBranch ?? currentBranch ?? t('new.branch')
  const filteredBranches = useMemo(
    () => branches.filter(branch => (
      branch.name !== currentBranch
      && branch.name.toLowerCase().includes(deferredSearch)
    )),
    [branches, currentBranch, deferredSearch],
  )

  const selectCurrentBranch = () => {
    setOpen(false)
    onSelectBranch(null)
  }

  const selectBranch = (branch: string) => {
    setOpen(false)
    onSelectBranch(branch)
  }

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="xs"
          aria-label={t('new.selectBaseBranch')}
          title={branchLabel}
          className="min-w-0 max-w-44 active:scale-[0.96]"
          data-testid="new-work-base-branch-trigger"
        >
          <GitBranchIcon className="size-3 shrink-0" aria-hidden="true" />
          <span className="min-w-0 truncate font-mono text-[11px]">{branchLabel}</span>
          <ChevronDownIcon className="size-3 shrink-0 !text-muted-foreground/60" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-64 gap-0 overflow-hidden p-0"
        data-testid="new-work-branch-picker"
      >
        <div className="border-b border-border p-2">
          <Input
            autoFocus
            value={search}
            onChange={event => setSearch(event.target.value)}
            placeholder={t('new.searchBranches')}
            className="h-7 text-xs"
            data-testid="new-work-branch-search"
          />
        </div>
        <div className="max-h-56 overflow-y-auto p-1">
          <button
            type="button"
            className={cn(
              'flex min-h-8 w-full items-center gap-2 rounded-md px-2 text-left text-xs transition-colors',
              'hover:bg-accent/60',
              selectedBranch === null && 'bg-accent/50 text-accent-foreground',
            )}
            onClick={selectCurrentBranch}
            data-testid="new-work-branch-current-option"
          >
            <GitBranchIcon className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate font-mono text-[11px]">{currentBranch ?? t('new.branch')}</span>
            {selectedBranch === null && <span className="text-[10px] text-primary">{t('new.selected')}</span>}
          </button>

          {loading
            ? <p className="px-2 py-4 text-center text-xs text-muted-foreground">{t('new.loadingBranches')}</p>
            : filteredBranches.length > 0
              ? filteredBranches.map(branch => (
                  <button
                    key={`${branch.scope}:${branch.name}`}
                    type="button"
                    className={cn(
                      'flex min-h-8 w-full items-center gap-2 rounded-md px-2 text-left text-xs transition-colors',
                      'hover:bg-accent/60',
                      selectedBranch === branch.name && 'bg-accent/50 text-accent-foreground',
                    )}
                    onClick={() => selectBranch(branch.name)}
                    data-testid="new-work-branch-option"
                    data-branch-name={branch.name}
                  >
                    <GitBranchIcon
                      className={cn(
                        'size-3 shrink-0',
                        branch.scope === 'remote' ? 'text-muted-foreground/50' : 'text-muted-foreground',
                      )}
                      aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1 truncate font-mono text-[11px]">{branch.name}</span>
                    {selectedBranch === branch.name && <span className="text-[10px] text-primary">{t('new.selected')}</span>}
                  </button>
                ))
              : <p className="px-2 py-4 text-center text-xs text-muted-foreground">{t('new.noBranches')}</p>}
        </div>
      </PopoverContent>
    </Popover>
  )
}
