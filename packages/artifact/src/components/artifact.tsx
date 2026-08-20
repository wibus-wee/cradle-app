import type { ReactNode } from 'react'

import { cn } from '../cn'
import { ARTIFACT_THEME_STYLE } from '../theme'

export interface ArtifactProps {
  /** Optional document title shown above the body when Header is not used. */
  title?: string
  children?: ReactNode
  className?: string
}

/**
 * Root layout for an Agent Artifact. Matches the Context Usage Report density:
 * centered article, soft borders, compact type scale.
 */
export function Artifact({ title, children, className }: ArtifactProps) {
  return (
    <div
      className={cn('absolute inset-0 bg-[var(--color-surface)] text-[var(--text-primary)]', className)}
      data-cradle-artifact-root=""
      style={ARTIFACT_THEME_STYLE}
    >
      <div className="h-full overflow-auto">
        <article className="mx-auto max-w-[var(--layout-content-max-wide)] px-4 py-4 lg:px-5">
          {title
            ? (
              <h1 className="mb-3 text-balance text-[17px] font-semibold leading-6 text-[var(--text-primary)]">
                {title}
              </h1>
            )
            : null}
          {children}
        </article>
      </div>
    </div>
  )
}
