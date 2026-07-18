// Renders workspace Git patches with Pierre's virtualized diff viewer.
import {
  GitCompareLine as FileDiffIcon,
} from '@mingcute/react'
import { useStableCallback } from '@pierre/diffs/react'
import { useDeferredValue, useEffect, useMemo, useRef, useState, useTransition } from 'react'

import { buildDiffData } from '~/components/common/diff/diff-data'
import { DiffLayoutToggle } from '~/components/common/diff/diff-layout-toggle'
import type { DiffStyle } from '~/components/common/diff/diff-options'
import { DiffWorkerProvider } from '~/components/common/diff/diff-runtime'
import type { PatchDiffViewHandle } from '~/components/common/diff/patch-diff-view'
import { PatchDiffView } from '~/components/common/diff/patch-diff-view'
import { Spinner } from '~/components/ui/spinner'
import { DEFAULT_BROWSER_PANEL_OWNER_ID, useBrowserPanelStore } from '~/store/browser-panel'

import { useGitDiff } from '../git/use-git'

interface WorkspaceDiffViewerProps {
  ownerId?: string | null
  tabId: string
  workspaceId: string
  repositoryPath?: string | null
  paths?: string[]
}

export function WorkspaceDiffViewer(props: WorkspaceDiffViewerProps) {
  return (
    <DiffWorkerProvider>
      <WorkspaceDiffViewerContent {...props} />
    </DiffWorkerProvider>
  )
}

function WorkspaceDiffViewerContent({ ownerId, tabId, workspaceId, repositoryPath, paths }: WorkspaceDiffViewerProps) {
  const { data: patch, isLoading, isError } = useGitDiff(workspaceId, repositoryPath, paths)
  const deferredPatch = useDeferredValue(patch)
  const [diffStyle, setDiffStyle] = useState<DiffStyle>('split')
  const [isDiffStylePending, startDiffStyleTransition] = useTransition()
  const viewerRef = useRef<PatchDiffViewHandle>(null)
  const pendingScrollRef = useRef<string | null>(null)

  const diffData = useMemo(() => buildDiffData(deferredPatch ?? ''), [deferredPatch])
  const { items, pathToItemId } = diffData

  // Listen for scroll-to-file requests from the Changes Panel
  const resolvedOwnerId = ownerId ?? DEFAULT_BROWSER_PANEL_OWNER_ID
  const scrollToFilePath = useBrowserPanelStore(s => s.owners[resolvedOwnerId]?.scrollToFilePath ?? null)
  const clearScrollToFilePath = useBrowserPanelStore(s => s.clearScrollToFilePath)

  const scrollToPath = useStableCallback((path: string) => {
    if (items.length === 0) {
      pendingScrollRef.current = path
      return
    }
    if (!pathToItemId.has(path)) {
      return
    }
    if (!viewerRef.current?.scrollToPath(path)) {
      pendingScrollRef.current = path
    }
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
        <DiffLayoutToggle
          value={diffStyle}
          onValueChange={(value) => {
            startDiffStyleTransition(() => {
              setDiffStyle(value)
            })
          }}
          disabled={isDiffStylePending}
        />
      </div>
      <PatchDiffView
        ref={viewerRef}
        data={diffData}
        diffStyle={diffStyle}
        enableLineSelection
        className="flex-1"
      />
    </div>
  )
}
