import {
  CheckLine as CheckIcon,
  GitBranchLine as GitBranchIcon,
  GitCommitLine as GitCommitIcon,
} from '@mingcute/react'
import { Spinner } from '~/components/ui/spinner'
import { useDeferredValue, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { ScrollArea } from '~/components/ui/scroll-area'
import { useGitBranches, useGitGraph } from '~/features/git/use-git'
import { cn } from '~/lib/cn'

type DiffReviewKey = keyof typeof import('~/locales/default').default['diff-review']

export interface GitRefPickerProps {
  workspaceId: string
  repositoryPath?: string | null
  value: string
  onValueChange: (value: string) => void
  autoFocus?: boolean
  placeholder?: string
  /** Extra refs to offer at the top, e.g. ["HEAD"]. */
  quickRefs?: string[]
  /** Number of recent commits to fetch and offer. */
  commitLimit?: number
  className?: string
  inputId?: string
  onKeyDown?: (event: React.KeyboardEvent<HTMLInputElement>) => void
}

interface PickerItem {
  key: string
  label: string
  description?: string
  value: string
  group: 'quick' | 'local' | 'remote' | 'commits'
}

/**
 * Pick a git ref (branch, commit, or symbolic ref like HEAD) from a searchable
 * list. Free-form input is still accepted — selecting an item just fills it in.
 */
export function GitRefPicker({
  workspaceId,
  repositoryPath,
  value,
  onValueChange,
  autoFocus,
  placeholder = 'Search branches or commits…',
  quickRefs,
  commitLimit = 50,
  className,
  inputId,
  onKeyDown,
}: GitRefPickerProps) {
  const { t } = useTranslation('diff-review')
  const [search, setSearch] = useState('')
  const deferredSearch = useDeferredValue(search.trim().toLowerCase())

  const branchesQuery = useGitBranches(workspaceId, repositoryPath)
  const graphQuery = useGitGraph(workspaceId, commitLimit, repositoryPath)

  const items = useMemo<PickerItem[]>(() => {
    const result: PickerItem[] = []
    for (const ref of quickRefs ?? []) {
      result.push({ key: `quick:${ref}`, label: ref, value: ref, group: 'quick' })
    }
    for (const branch of branchesQuery.data?.local ?? []) {
      result.push({
        key: `local:${branch.name}`,
        label: branch.name,
        value: branch.name,
        description: branch.isCurrent ? 'current' : branch.tracking ? `tracks ${branch.tracking}` : undefined,
        group: 'local',
      })
    }
    for (const branch of branchesQuery.data?.remote ?? []) {
      result.push({
        key: `remote:${branch.name}`,
        label: branch.name,
        value: branch.name,
        group: 'remote',
      })
    }
    for (const commit of graphQuery.data ?? []) {
      result.push({
        key: `commit:${commit.sha}`,
        label: commit.subject,
        value: commit.shortSha,
        description: commit.shortSha,
        group: 'commits',
      })
    }
    return result
  }, [quickRefs, branchesQuery.data, graphQuery.data])

  const filtered = useMemo(() => {
    if (!deferredSearch) {
      return items
    }
    return items.filter(item =>
      item.label.toLowerCase().includes(deferredSearch)
      || item.value.toLowerCase().includes(deferredSearch)
      || (item.description?.toLowerCase().includes(deferredSearch) ?? false))
  }, [items, deferredSearch])

  const groups = useMemo(() => {
    const order: Array<PickerItem['group']> = ['quick', 'local', 'remote', 'commits']
    const labels: Record<PickerItem['group'], string> = {
      quick: 'Refs',
      local: 'Local branches',
      remote: 'Remote branches',
      commits: 'Recent commits',
    }
    return order
      .map(group => ({ group, label: labels[group], entries: filtered.filter(item => item.group === group) }))
      .filter(group => group.entries.length > 0)
  }, [filtered])

  const loading = branchesQuery.isLoading || graphQuery.isLoading

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <Input
        id={inputId}
        autoFocus={autoFocus}
        value={search}
        onChange={(event) => {
          setSearch(event.target.value)
          onValueChange(event.target.value)
        }}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        className="h-8 text-[12px]"
      />
      <ScrollArea className="max-h-56 rounded-md border border-border/60" viewportClassName="max-h-56">
        <div className="py-1">
          {loading
            ? (
                <div className="flex items-center justify-center gap-1.5 py-6 text-[11px] text-muted-foreground">
                  <Spinner className="size-3" aria-hidden />
                  {t('gitRefPicker.loading' as DiffReviewKey)}
                </div>
              )
            : groups.length === 0
              ? (
                  <p className="py-6 text-center text-[11px] text-muted-foreground">
                    {deferredSearch ? 'No matches — press Open to use this ref as-is.' : 'No refs available.'}
                  </p>
                )
              : (
                  groups.map(group => (
                    <div key={group.group}>
                      <p className="px-2 pb-0.5 pt-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                        {group.label}
                      </p>
                      {group.entries.map(item => (
                        <Button
                          key={item.key}
                          type="button"
                          variant="ghost"
                          onClick={() => {
                            onValueChange(item.value)
                            setSearch('')
                          }}
                          className={cn(
                            'h-auto w-full justify-start gap-2 rounded-none px-2 py-1.5 text-left text-[12px] font-normal hover:bg-accent/60',
                            value === item.value && 'bg-accent/40',
                          )}
                        >
                          {item.group === 'commits'
                            ? <GitCommitIcon className="size-3 shrink-0 !text-muted-foreground/60" aria-hidden />
                            : <GitBranchIcon className="size-3 shrink-0 !text-muted-foreground/60" aria-hidden />}
                          <span className="min-w-0 flex-1 truncate font-mono">{item.label}</span>
                          {item.description && (
                            <span className="shrink-0 max-w-[55%] truncate text-[11px] text-muted-foreground">
                              {item.description}
                            </span>
                          )}
                          {value === item.value && (
                            <CheckIcon className="size-3 shrink-0 !text-primary" aria-hidden />
                          )}
                        </Button>
                      ))}
                    </div>
                  ))
                )}
        </div>
      </ScrollArea>
      {value.trim() && (
        <p className="text-[11px] text-muted-foreground">
          Ref:
          {' '}
          <span className="font-mono text-foreground/80">{value.trim()}</span>
        </p>
      )}
    </div>
  )
}
