import type { ReactElement } from 'react'
import { Fragment } from 'react'

import type { MatchRange } from '~/features/search/types'
import { cn } from '~/lib/cn'

interface HighlightedTextProps {
  text: string
  ranges: MatchRange[]
  /** Extra classes applied to highlighted segments. */
  highlightClassName?: string
  className?: string
}

/**
 * Render `text` as a run of spans, wrapping byte ranges indicated by `ranges`
 * in a styled <mark>. Ranges must be sorted and non-overlapping — which is
 * what the main-process engine guarantees.
 */
export function HighlightedText({
  text,
  ranges,
  highlightClassName,
  className,
}: HighlightedTextProps): ReactElement {
  if (!ranges.length) {
    return <span className={className}>{text}</span>
  }

  const out: ReactElement[] = []
  let cursor = 0
  ranges.forEach((range) => {
    if (range.start > cursor) {
      out.push(
        <Fragment key={`p-${cursor}-${range.start}`}>
          {text.slice(cursor, range.start)}
        </Fragment>,
      )
    }
    out.push(
      <mark
        key={`m-${range.start}-${range.end}`}
        className={cn(
          'rounded-[3px] bg-primary/15 px-0.5 font-semibold text-primary',
          highlightClassName,
        )}
      >
        {text.slice(range.start, range.end)}
      </mark>,
    )
    cursor = range.end
  })
  if (cursor < text.length) {
    out.push(<Fragment key="tail">{text.slice(cursor)}</Fragment>)
  }

  return <span className={className}>{out}</span>
}
