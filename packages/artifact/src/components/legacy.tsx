import { cn } from '../cn'
import { Metrics } from './metrics'
import { ShareList } from './share-list'

/**
 * Adapters for component names that existed before the visual redesign.
 * Persisted Artifact sources are compiled at runtime, so old names must keep
 * resolving in `createArtifactModuleExports()` — otherwise every stored
 * artifact written before the redesign would crash on render. These adapters
 * intentionally stay out of the package's public exports; new sources should
 * use `Metrics` / `ShareList` directly.
 */

export interface LegacyMetricItem {
  label: string
  value: string
  meta?: string
}

export function LegacyMetricGrid({ items, className }: { items: LegacyMetricItem[], className?: string }) {
  return (
    <Metrics
      className={className}
      items={items.map(item => ({
        label: item.label,
        value: item.value,
        caption: item.meta,
      }))}
    />
  )
}

export function LegacyMetricCell({ label, value, meta }: LegacyMetricItem) {
  return (
    <div className={cn('flex min-w-[128px] flex-col gap-1')}>
      <div className="text-[11px] font-medium text-[var(--muted-foreground)]">{label}</div>
      <div className="truncate text-[28px] font-semibold leading-tight tracking-[-0.02em] tabular-nums text-[var(--foreground)]">
        {value}
      </div>
      {meta
        ? (
            <div className="text-[10.5px] text-[var(--muted-foreground)]">{meta}</div>
          )
        : null}
    </div>
  )
}

export interface LegacySegmentedBarSegment {
  label: string
  value: number
}

export function LegacySegmentedBar({
  segments,
  className,
}: {
  segments: LegacySegmentedBarSegment[]
  showLegend?: boolean
  className?: string
}) {
  return <ShareList className={className} items={segments.map(({ label, value }) => ({ label, value }))} />
}
