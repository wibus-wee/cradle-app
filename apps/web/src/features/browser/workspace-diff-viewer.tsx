// Renders workspace Git patches with Pierre's virtualized diff viewer.
import {
  Columns2Line as Columns2Icon,
  GitCompareLine as FileDiffIcon,
  Rows3Line as Rows3Icon,
} from '@mingcute/react'
import type { CodeViewItem, CodeViewOptions } from '@pierre/diffs'
import { parsePatchFiles } from '@pierre/diffs'
import type {
  CodeViewHandle,
  WorkerInitializationRenderOptions,
  WorkerPoolOptions,
} from '@pierre/diffs/react'
import {
  CodeView,
  useStableCallback,
  WorkerPoolContextProvider,
} from '@pierre/diffs/react'
import WorkerUrl from '@pierre/diffs/worker/worker.js?worker&url'
import { useDeferredValue, useEffect, useRef, useState, useTransition } from 'react'

import { Spinner } from '~/components/ui/spinner'
import { ToggleGroup, ToggleGroupItem } from '~/components/ui/toggle-group'
import { cn } from '~/lib/cn'
import { DEFAULT_BROWSER_PANEL_OWNER_ID, useBrowserPanelStore } from '~/store/browser-panel'

import { useGitDiff } from '../git/use-git'

type DiffStyle = 'split' | 'unified'

interface WorkspaceDiffViewerProps {
  ownerId?: string | null
  tabId: string
  workspaceId: string
  repositoryPath?: string | null
  paths?: string[]
}

interface WorkspaceDiffData {
  items: CodeViewItem[]
  pathToItemId: Map<string, string>
}

const DIFF_LINE_HEIGHT = 18

const WORKER_POOL_OPTIONS = {
  workerFactory: () => new Worker(WorkerUrl, { type: 'module' }),
  poolSize: 3,
} satisfies WorkerPoolOptions

const WORKER_HIGHLIGHTER_OPTIONS = {
  lineDiffType: 'word',
  theme: { dark: 'pierre-dark', light: 'pierre-light' },
  useTokenTransformer: false,
} satisfies WorkerInitializationRenderOptions

function buildItemsFromPatch(patch: string): WorkspaceDiffData {
  const patchVersion = hashPatchVersion(patch)
  const parsed = parsePatchFiles(
    patch,
    `workspace-diff-${patch.length.toString(36)}-${patchVersion.toString(36)}`,
  )
  const items: CodeViewItem[] = []
  const pathToItemId = new Map<string, string>()
  const itemIds = new Set<string>()
  const nextCollisionSuffixByBase = new Map<string, number>()
  for (const p of parsed) {
    for (const fileDiff of p.files) {
      const itemId = createItemId(fileDiff.name, itemIds, nextCollisionSuffixByBase)
      itemIds.add(itemId)
      items.push({ id: itemId, type: 'diff', fileDiff, version: patchVersion })
      pathToItemId.set(fileDiff.name, itemId)
      if (fileDiff.prevName) {
        pathToItemId.set(fileDiff.prevName, itemId)
      }
    }
  }
  return { items, pathToItemId }
}

function hashPatchVersion(patch: string): number {
  let hash = 2166136261
  for (let index = 0; index < patch.length; index++) {
    hash ^= patch.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function createItemId(
  path: string,
  itemIds: Set<string>,
  nextCollisionSuffixByBase: Map<string, number>,
): string {
  if (!itemIds.has(path)) {
    return path
  }

  let suffix = nextCollisionSuffixByBase.get(path) ?? 2
  let itemId = `${path}?${suffix}`
  while (itemIds.has(itemId)) {
    suffix++
    itemId = `${path}?${suffix}`
  }
  nextCollisionSuffixByBase.set(path, suffix + 1)
  return itemId
}

export function WorkspaceDiffViewer(props: WorkspaceDiffViewerProps) {
  return (
    <WorkerPoolContextProvider
      poolOptions={WORKER_POOL_OPTIONS}
      highlighterOptions={WORKER_HIGHLIGHTER_OPTIONS}
    >
      <WorkspaceDiffViewerContent {...props} />
    </WorkerPoolContextProvider>
  )
}

function WorkspaceDiffViewerContent({ ownerId, tabId, workspaceId, repositoryPath, paths }: WorkspaceDiffViewerProps) {
  const { data: patch, isLoading, isError } = useGitDiff(workspaceId, repositoryPath, paths)
  const deferredPatch = useDeferredValue(patch)
  const [diffStyle, setDiffStyle] = useState<DiffStyle>('split')
  const [isDiffStylePending, startDiffStyleTransition] = useTransition()
  const viewerRef = useRef<CodeViewHandle<undefined>>(null)
  const pendingScrollRef = useRef<string | null>(null)

  const diffData = ((): WorkspaceDiffData => {
    if (!deferredPatch || deferredPatch.trim().length === 0) {
      return { items: [], pathToItemId: new Map() }
    }
    return buildItemsFromPatch(deferredPatch)
  })()
  const { items, pathToItemId } = diffData

  // Listen for scroll-to-file requests from the Changes Panel
  const resolvedOwnerId = ownerId ?? DEFAULT_BROWSER_PANEL_OWNER_ID
  const scrollToFilePath = useBrowserPanelStore(s => s.owners[resolvedOwnerId]?.scrollToFilePath ?? null)
  const clearScrollToFilePath = useBrowserPanelStore(s => s.clearScrollToFilePath)

  const scrollToPath = useStableCallback((path: string) => {
    const viewer = viewerRef.current
    if (viewer == null || items.length === 0) {
      pendingScrollRef.current = path
      return
    }
    const itemId = pathToItemId.get(path)
    if (!itemId) {
      return
    }
    const item = viewer.getItem(itemId)
    if (item != null && item.collapsed === true) {
      viewer.updateItem({
        ...item,
        collapsed: false,
        version: typeof item.version === 'number' ? item.version + 1 : 1,
      })
    }
    viewer.scrollTo({ type: 'item', id: itemId, align: 'start', behavior: 'smooth' })
  })

  // Handle scroll requests from the Changes Panel
  useEffect(() => {
    if (!scrollToFilePath || scrollToFilePath.tabId !== tabId) {
      return
    }
    scrollToPath(scrollToFilePath.path)
    clearScrollToFilePath(ownerId)
  }, [clearScrollToFilePath, ownerId, scrollToFilePath, tabId, scrollToPath])

  // Flush pending scroll once items are loaded
  useEffect(() => {
    if (items.length === 0 || !pendingScrollRef.current) {
      return
    }
    const path = pendingScrollRef.current
    pendingScrollRef.current = null
    scrollToPath(path)
  }, [items, scrollToPath])

  const options: CodeViewOptions<undefined> = ({
      theme: { dark: 'pierre-dark', light: 'pierre-light' },
      themeType: 'system',
      diffStyle,
      diffIndicators: 'bars',
      overflow: 'scroll',
      lineDiffType: 'word',
      hunkSeparators: 'line-info-basic',
      enableLineSelection: true,
      stickyHeaders: true,
      pointerEventsOnScroll: false,
      itemMetrics: {
        hunkLineCount: 1,
        lineHeight: DIFF_LINE_HEIGHT,
      },
    })

  if (isLoading) {
    return (
      <div
        className="flex h-full w-full items-center justify-center"
        data-testid="workspace-diff-loading"
      >
        <Spinner className="size-4 !text-muted-foreground/40" aria-hidden />
      </div>
    )
  }

  if (isError) {
    return (
      <div
        className="flex h-full w-full items-center justify-center p-4 text-center"
        data-testid="workspace-diff-error"
      >
        <div className="flex flex-col items-center gap-2">
          <FileDiffIcon className="size-5 !text-muted-foreground/30" aria-hidden />
          <p className="text-xs text-muted-foreground">Failed to load diff</p>
        </div>
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div
        className="flex h-full w-full items-center justify-center p-4 text-center"
        data-testid="workspace-diff-empty"
      >
        <div className="flex flex-col items-center gap-2">
          <FileDiffIcon className="size-5 !text-muted-foreground/30" aria-hidden />
          <p className="text-xs text-muted-foreground">No changes</p>
        </div>
      </div>
    )
  }

  return (
    <div
      className="flex h-full w-full min-h-0 flex-col overflow-hidden"
      data-testid="workspace-diff-viewer"
    >
      <div className="flex items-center gap-2 border-b border-border/30 bg-card px-2 py-1">
        <span className="text-[10px] tabular-nums text-muted-foreground/55">
          {items.length}
{' '}
file
{items.length !== 1 ? 's' : ''}
        </span>
        <div className="flex-1" />
        <ToggleGroup
          type="single"
          value={diffStyle}
          onValueChange={(v) => {
            if (v === 'split' || v === 'unified') {
              startDiffStyleTransition(() => {
                setDiffStyle(v)
              })
            }
          }}
          variant="outline"
          size="sm"
          className="h-5 shrink-0 gap-px"
          aria-label="Diff layout"
          disabled={isDiffStylePending}
        >
          <ToggleGroupItem
            value="split"
            aria-label="Split"
            className="h-5 gap-1 px-1.5 text-[10px]"
          >
            <Columns2Icon className="size-2.5" />
            Split
          </ToggleGroupItem>
          <ToggleGroupItem
            value="unified"
            aria-label="Unified"
            className="h-5 gap-1 px-1.5 text-[10px]"
          >
            <Rows3Icon className="size-2.5" />
            Unified
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
      <CodeView
        ref={viewerRef}
        items={items}
        options={options}
        className={cn(
          'min-h-0 flex-1 overflow-auto overscroll-contain [overflow-anchor:none]',
          '[--diffs-font-size:11px] [--diffs-line-height:18px]',
        )}
      />
    </div>
  )
}
