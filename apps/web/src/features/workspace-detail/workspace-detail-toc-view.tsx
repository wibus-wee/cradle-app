import type { CSSProperties } from 'react'

import { cn } from '~/lib/cn'

import { WORKSPACE_DETAIL_TOC_ITEM_HEIGHT } from './workspace-detail-toc'
import type {
  WorkspaceDetailTocHeading,
  WorkspaceDetailTocLayout,
} from './workspace-detail-types'

export interface WorkspaceDetailTocViewProps {
  headings: WorkspaceDetailTocHeading[]
  activeSlug: string | null
  layout: WorkspaceDetailTocLayout
  onNavigate: (slug: string) => void
}

export function WorkspaceDetailTocView({
  headings,
  activeSlug,
  layout,
  onNavigate,
}: WorkspaceDetailTocViewProps) {
  if (headings.length === 0) {
    return null
  }

  const layoutItems = layout.items.length > 0
    ? layout.items
    : headings.map((heading, index) => ({
        ...heading,
        top: index * WORKSPACE_DETAIL_TOC_ITEM_HEIGHT,
        height: WORKSPACE_DETAIL_TOC_ITEM_HEIGHT,
        visible: false,
        intensity: 0,
      }))
  const trackHeight = layout.height > 0
    ? layout.height
    : layoutItems.length * WORKSPACE_DETAIL_TOC_ITEM_HEIGHT
  const minLevel = Math.min(...headings.map(heading => heading.level))
  const xPerLevel = 10
  const trunkBase = 7
  const tocLabel = layoutItems[0]?.file ?? headings[0]?.file ?? 'Outline'
  const currentActiveSlug = layout.activeSlug ?? activeSlug
  const points: string[] = []

  for (let index = 0; index < layoutItems.length; index++) {
    const x = trunkBase + (layoutItems[index]!.level - minLevel) * xPerLevel
    const y = layoutItems[index]!.top + layoutItems[index]!.height / 2

    if (index === 0) {
      points.push(`M ${x} ${y}`)
      continue
    }

    const previousX = trunkBase
      + (layoutItems[index - 1]!.level - minLevel)
      * xPerLevel
    points.push(`L ${previousX} ${y}`)
    if (previousX !== x) {
      points.push(`L ${x} ${y}`)
    }
  }

  return (
    <nav className="sticky top-6 w-58 shrink-0 pt-6 pr-4 select-none">
      <span className="mb-1.5 block px-2 font-mono text-[10px] font-medium text-muted-foreground">
        {tocLabel}
      </span>
      <div className="relative" style={{ height: trackHeight }}>
        <svg
          className="pointer-events-none absolute inset-0"
          width="100%"
          height={trackHeight}
          aria-hidden="true"
        >
          <path
            d={points.join(' ')}
            fill="none"
            stroke="currentColor"
            strokeWidth="1"
            className="text-border/50"
          />
        </svg>

        {layoutItems.map((heading) => {
          const indent = (heading.level - minLevel) * xPerLevel
          const x = trunkBase + indent
          const isActive = currentActiveSlug === heading.slug
          const isVisible = heading.visible && !isActive
          const proximityOpacity = 0.42 + heading.intensity * 0.42
          const style = {
            'top': heading.top,
            'height': heading.height,
            'paddingLeft': x + 10,
            '--toc-item-opacity': isActive ? 1 : proximityOpacity,
            '--toc-dot-opacity': isActive
              ? 1
              : Math.max(proximityOpacity, isVisible ? 0.78 : 0.5),
          } as CSSProperties

          return (
            <button
              key={`${heading.file}-${heading.slug}`}
              type="button"
              onClick={() => onNavigate(heading.slug)}
              className={cn(
                'group/toc-item absolute flex w-full items-center text-left transition-[color,opacity,text-shadow]',
                'opacity-[var(--toc-item-opacity)] hover:opacity-100 focus-visible:opacity-100',
                'focus-visible:outline-none',
                isActive
                  ? 'text-foreground'
                  : isVisible
                    ? 'text-foreground/70 hover:text-foreground focus-visible:text-foreground'
                    : 'text-muted-foreground hover:text-foreground focus-visible:text-foreground',
              )}
              style={style}
            >
              <span
                className={cn(
                  'absolute size-1.5 rounded-full border transition-[background-color,border-color,box-shadow,opacity]',
                  'opacity-[var(--toc-dot-opacity)] group-hover/toc-item:opacity-100 group-focus-visible/toc-item:opacity-100',
                  isActive
                    ? 'border-foreground bg-foreground shadow-[0_0_10px_color-mix(in_oklab,currentColor_60%,transparent)]'
                    : isVisible
                      ? 'border-foreground/35 bg-foreground/35 group-hover/toc-item:border-foreground/75 group-hover/toc-item:bg-foreground/75 group-hover/toc-item:shadow-[0_0_10px_color-mix(in_oklab,currentColor_45%,transparent)] group-focus-visible/toc-item:border-foreground/75 group-focus-visible/toc-item:bg-foreground/75 group-focus-visible/toc-item:shadow-[0_0_10px_color-mix(in_oklab,currentColor_45%,transparent)]'
                      : 'border-muted-foreground/30 bg-background group-hover/toc-item:border-foreground/70 group-hover/toc-item:bg-foreground/70 group-hover/toc-item:shadow-[0_0_10px_color-mix(in_oklab,currentColor_40%,transparent)] group-focus-visible/toc-item:border-foreground/70 group-focus-visible/toc-item:bg-foreground/70 group-focus-visible/toc-item:shadow-[0_0_10px_color-mix(in_oklab,currentColor_40%,transparent)]',
                )}
                style={{ left: x - 3 }}
              />
              <span className="truncate text-[11px] transition-[text-shadow] group-hover/toc-item:[text-shadow:0_0_12px_color-mix(in_oklab,currentColor_45%,transparent)] group-focus-visible/toc-item:[text-shadow:0_0_12px_color-mix(in_oklab,currentColor_45%,transparent)]">
                {heading.text}
              </span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}
