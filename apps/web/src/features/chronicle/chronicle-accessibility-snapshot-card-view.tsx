import { EyeLine as EyeIcon } from '@mingcute/react'
import { useTranslation } from 'react-i18next'

import { Badge } from '~/components/ui/badge'
import { cn } from '~/lib/cn'

import {
  formatChronicleAccessibilityStatus,
  getChronicleAccessibilityArtifactPath,
} from './chronicle-accessibility-presenter'
import { ChronicleAccessibilityTreeView } from './chronicle-accessibility-tree-view'
import { formatChronicleDateTime } from './chronicle-time-presenter'
import type { ChronicleAccessibilitySnapshot } from './use-chronicle'

export interface ChronicleAccessibilitySnapshotCardViewProps {
  snapshot: ChronicleAccessibilitySnapshot
}

export function ChronicleAccessibilitySnapshotCardView({
  snapshot,
}: ChronicleAccessibilitySnapshotCardViewProps) {
  const { t } = useTranslation('chronicle')
  const artifactPath = getChronicleAccessibilityArtifactPath(snapshot.metadata)

  return (
    <article className="rounded-lg border border-foreground/5 bg-background p-3 shadow-sm">
      <div className="mb-2 flex min-w-0 items-center gap-2">
        <EyeIcon className="size-3.5 shrink-0 !text-muted-foreground" />
        <span className="truncate text-[13px] font-medium text-foreground">
          {snapshot.windowTitle ?? snapshot.appBundleId ?? t('accessibility.snapshotFallback.title')}
        </span>
        <Badge
          variant={snapshot.status === 'ready' ? 'secondary' : 'outline'}
          className={cn(
            'ml-auto text-[11px]',
            {
              'border-destructive/20 bg-destructive/10 text-destructive': snapshot.status === 'error',
              'border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300': snapshot.status === 'permission-denied',
            },
          )}
        >
          {formatChronicleAccessibilityStatus(t, snapshot.status)}
        </Badge>
      </div>
      <p className="line-clamp-4 text-[13px] leading-5 text-foreground">
        {snapshot.text ?? t('accessibility.snapshotFallback.text')}
      </p>
      <div className="mt-2 grid grid-cols-2 gap-1 text-[11px] text-muted-foreground">
        <span className="truncate font-mono">
          {formatChronicleDateTime(t, snapshot.capturedAt)}
        </span>
        <span className="truncate text-right">
          {t('accessibility.elementCount', { count: snapshot.elementCount })}
        </span>
        <span className="truncate">{snapshot.provider}</span>
        <span className="truncate text-right">
          {snapshot.appBundleId ?? t('common.status.unknownApp')}
        </span>
      </div>
      {artifactPath && (
        <p className="mt-2 truncate font-mono text-[11px] text-muted-foreground/70">
          {artifactPath}
        </p>
      )}
      <ChronicleAccessibilityTreeView tree={snapshot.tree} />
    </article>
  )
}
