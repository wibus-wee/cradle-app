import { useMemo, useState } from 'react'

import { buildDiffData } from '~/components/common/diff/diff-data'
import type { DiffStyle } from '~/components/common/diff/diff-options'
import { PatchDiffView } from '~/components/common/diff/patch-diff-view'

import type { PullRequestDetail } from './api/pull-requests'
import { buildPullRequestFilePatch } from './pull-request-detail-presenter'

type PullRequestFile = PullRequestDetail['files'][number]

export interface PullRequestFileSectionViewProps {
  file: PullRequestFile
  diffStyle: DiffStyle
  patchUnavailableLabel: string
}

export function PullRequestFileSectionView({
  file,
  diffStyle,
  patchUnavailableLabel,
}: PullRequestFileSectionViewProps) {
  const [hasOpened, setHasOpened] = useState(false)
  const data = useMemo(
    () => file.patch ? buildDiffData(buildPullRequestFilePatch(file)) : null,
    [file],
  )

  return (
    <details
      className="group overflow-hidden rounded-lg border border-border/60 [content-visibility:auto]"
      onToggle={(event) => {
        if (event.currentTarget.open) {
          setHasOpened(true)
        }
      }}
    >
      <summary className="flex min-h-9 cursor-default list-none items-center gap-2.5 px-3 py-1.5 text-[11.5px] hover:bg-muted/40">
        <span className="min-w-0 flex-1 truncate font-mono text-foreground/80">
          {file.filename}
        </span>
        <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[9px] font-medium uppercase text-muted-foreground">
          {file.status}
        </span>
        <span className="shrink-0 font-mono tabular-nums text-success">
          +
          {file.additions}
        </span>
        <span className="shrink-0 font-mono tabular-nums text-destructive">
          -
          {file.deletions}
        </span>
      </summary>
      {data
        ? (
            hasOpened
              ? (
                  <PatchDiffView
                    data={data}
                    diffStyle={diffStyle}
                    className="max-h-128 border-t border-border/60"
                  />
                )
              : null
          )
        : (
            <div className="border-t border-border/60 px-3 py-3 text-[11px] text-muted-foreground">
              {patchUnavailableLabel}
            </div>
          )}
    </details>
  )
}
