import { FolderOpen2Line as FolderOpenIcon, GitCompareLine as DiffIcon } from '@mingcute/react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ResizeHandle } from '~/components/layout/resize-handle'
import { useRegisterLayoutSlots } from '~/components/layout/use-layout-slots'
import { Button } from '~/components/ui/button'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '~/components/ui/empty'
import { ScrollArea } from '~/components/ui/scroll-area'
import { Spinner } from '~/components/ui/spinner'
import { getWorkspaceLocationLabel } from '~/features/workspace/types'
import { useWorkspaces } from '~/features/workspace/use-workspace'
import { cn } from '~/lib/cn'

import { WorkspaceDiffsView } from './workspace-diffs-view'

const ASIDE_WIDTH_KEY = 'cradle-diffs:aside-width'
const ASIDE_WIDTH_DEFAULT = 256
const ASIDE_WIDTH_MIN = 220
const ASIDE_WIDTH_MAX = 400

function readAsideWidth(): number {
  if (typeof window === 'undefined') {
    return ASIDE_WIDTH_DEFAULT
  }
  const raw = window.localStorage.getItem(ASIDE_WIDTH_KEY)
  if (!raw) {
    return ASIDE_WIDTH_DEFAULT
  }
  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) {
    return ASIDE_WIDTH_DEFAULT
  }
  return Math.max(ASIDE_WIDTH_MIN, Math.min(ASIDE_WIDTH_MAX, parsed))
}

export interface DiffHomePageProps {
  workspace?: string
  repo?: string
  path?: string
  review?: string
  view?: 'commit' | 'guide'
  onWorkspaceSelect: (workspaceId: string) => void
}

export function DiffHomePage({
  workspace,
  repo,
  path,
  review,
  view,
  onWorkspaceSelect,
}: DiffHomePageProps) {
  const { t } = useTranslation('diff-review')
  const { t: tWorkspace } = useTranslation('workspace')
  const { workspaces, loading } = useWorkspaces()
  const [asideWidth, setAsideWidth] = useState<number>(readAsideWidth)

  const persistAsideWidth = (width: number) => {
    try {
      window.localStorage.setItem(ASIDE_WIDTH_KEY, String(width))
    }
    catch {
      // ignore storage failures
    }
  }

  const selectedWorkspace = useMemo(() => {
    if (workspace) {
      const match = workspaces.find(item => item.id === workspace)
      if (match) {
        return match
      }
    }
    return workspaces[0] ?? null
  }, [workspace, workspaces])

  useRegisterLayoutSlots('diff', useMemo(() => ({
    asideWorkspaceId: selectedWorkspace?.id ?? null,
    hasAside: Boolean(selectedWorkspace),
    hasBrowserPanel: false,
    hasPanel: false,
  }), [selectedWorkspace]))

  return (
    <div className="flex h-full min-w-0 overflow-hidden bg-background" data-testid="diff-home-page">
      <aside
        className="flex min-w-0 shrink-0 flex-col overflow-hidden border-r border-border/60 bg-muted/20"
        style={{ width: asideWidth }}
      >
        {/* Identity */}
        <div className="shrink-0 px-4 pt-5 pb-3">
          <div className="flex items-center gap-2.5">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted/60 text-foreground">
              <DiffIcon className="size-[15px]" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h1 className="truncate text-[13px] font-semibold tracking-tight text-foreground">
                {t('home.title')}
              </h1>
              <p className="truncate text-[11px] text-muted-foreground">
                {t('home.description')}
              </p>
            </div>
          </div>
        </div>

        {/* Workspaces — inset-grouped list */}
        <div className="flex items-center justify-between px-5 pb-1.5 pt-2">
          <span className="text-[11px] font-medium text-muted-foreground">
            {t('home.workspaces')}
          </span>
          {workspaces.length > 0 && (
            <span className="text-[11px] tabular-nums text-muted-foreground/50">
              {workspaces.length}
            </span>
          )}
        </div>

        <ScrollArea
          className="min-h-0 flex-1 px-3 pb-4"
          contentClassName="min-w-0"
        >
          {loading && (
            <div className="flex items-center gap-2 px-3 py-3 text-[12px] text-muted-foreground">
              <Spinner className="size-3.5" />
              <span>{t('home.loading')}</span>
            </div>
          )}

          {!loading && workspaces.length === 0 && (
            <div className="px-3 py-3 text-[12px] text-muted-foreground">
              {t('home.emptyWorkspaces')}
            </div>
          )}

          {!loading && workspaces.length > 0 && (
            <div className="overflow-hidden rounded-lg border border-border/50 bg-card shadow-xs">
              <ul role="list" className="divide-y divide-border/40">
                {workspaces.map((item) => {
                  const selected = selectedWorkspace?.id === item.id
                  const locationLabel = getWorkspaceLocationLabel(item)
                  return (
                    <li key={item.id} className="relative min-w-0">
                      {selected && (
                        <span
                          aria-hidden
                          className="absolute left-0 top-1/2 h-5 w-[2px] -translate-y-1/2 rounded-r-full bg-foreground"
                        />
                      )}
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => onWorkspaceSelect(item.id)}
                        className={cn(
                          'h-auto min-h-[40px] w-full min-w-0 justify-start gap-2.5 rounded-none pl-3.5 pr-3 py-1.5 text-left font-normal whitespace-normal',
                          'active:scale-[0.99] focus-visible:ring-2 focus-visible:ring-ring/40',
                          selected
                            ? 'bg-muted/70'
                            : 'hover:bg-muted/40',
                        )}
                      >
                        <FolderOpenIcon
                          className={cn(
                            'size-[15px] shrink-0',
                            selected ? 'text-foreground' : 'text-muted-foreground',
                          )}
                          aria-hidden="true"
                        />
                        <span className="min-w-0 flex-1">
                          <span
                            className={cn(
                              'block truncate text-[12.5px] leading-tight',
                              selected ? 'font-medium text-foreground' : 'font-medium text-foreground/90',
                            )}
                          >
                            {item.name}
                          </span>
                          <span
                            className="mt-0.5 block truncate font-mono text-[10px] leading-tight text-muted-foreground/50"
                            title={locationLabel}
                          >
                            {locationLabel}
                          </span>
                        </span>
                      </Button>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
        </ScrollArea>
      </aside>

      <ResizeHandle
        direction="horizontal"
        value={asideWidth}
        onChange={setAsideWidth}
        onChangeEnd={persistAsideWidth}
        min={ASIDE_WIDTH_MIN}
        max={ASIDE_WIDTH_MAX}
        className="h-full"
      />

      <main className="min-w-0 flex-1 overflow-hidden">
        {selectedWorkspace
          ? (
              <WorkspaceDiffsView
                key={selectedWorkspace.id}
                workspaceId={selectedWorkspace.id}
                repo={repo}
                path={path}
                review={review}
                view={view}
              />
            )
          : (
              <div className="flex h-full items-center justify-center px-6">
                <Empty>
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <FolderOpenIcon className="size-5" aria-hidden="true" />
                    </EmptyMedia>
                    <EmptyTitle>{t('home.empty.title')}</EmptyTitle>
                    <EmptyDescription>{tWorkspace('sidebar.projects.empty.description')}</EmptyDescription>
                  </EmptyHeader>
                </Empty>
              </div>
            )}
      </main>
    </div>
  )
}
