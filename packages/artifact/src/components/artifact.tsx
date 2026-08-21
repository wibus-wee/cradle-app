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
 * Bare-element rhythm for agent-authored HTML. The sandbox allows raw
 * `h2`/`p`/`ul`/… elements, and Tailwind preflight zeroes their margins —
 * without these defaults every hand-written heading and paragraph collapses
 * into a wall of text.
 */
const BARE_ELEMENT_STYLES = [
  // Headings
  '[&_h1]:text-[22px] [&_h1]:font-semibold [&_h1]:leading-tight [&_h1]:tracking-[-0.01em] [&_h1]:mt-2',
  '[&_h2]:mt-7 [&_h2]:text-[15px] [&_h2]:font-semibold [&_h2]:leading-snug',
  '[&_h3]:mt-5 [&_h3]:text-[13px] [&_h3]:font-semibold [&_h3]:leading-snug',
  '[&_h4]:mt-4 [&_h4]:text-[13px] [&_h4]:font-medium',
  '[&_h1:first-child]:mt-0 [&_h2:first-child]:mt-0 [&_h3:first-child]:mt-0 [&_h4:first-child]:mt-0',
  // Body text
  '[&_p]:my-2.5 [&_p]:text-[13px] [&_p]:leading-relaxed [&_p]:text-pretty',
  '[&_p:first-child]:mt-0 [&_p:last-child]:mb-0',
  // Lists
  '[&_ul]:my-2.5 [&_ol]:my-2.5 [&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-5 [&_ol]:pl-5',
  '[&_li]:my-1 [&_li]:text-[13px] [&_li]:leading-relaxed',
  '[&_li>::marker]:text-[var(--text-dim)]',
  // Inline semantics
  '[&_strong]:font-semibold [&_em]:italic',
  '[&_a]:text-[var(--info)] [&_a]:underline [&_a]:underline-offset-2',
  '[&_code]:rounded-sm [&_code]:bg-[var(--muted)] [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[11px]',
  '[&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-[var(--radius-lg)] [&_pre]:bg-[color-mix(in_srgb,var(--foreground)_4%,transparent)] [&_pre]:p-3 [&_pre]:font-mono [&_pre]:text-[11px] [&_pre]:leading-relaxed',
  '[&_pre_code]:bg-transparent [&_pre_code]:p-0',
  '[&_blockquote]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:border-[var(--border)] [&_blockquote]:pl-3 [&_blockquote]:text-[var(--muted-foreground)]',
  '[&_hr]:my-5 [&_hr]:border-0 [&_hr]:border-t [&_hr]:border-[var(--border)]',
].join(' ')

/**
 * Root layout for an Agent Artifact: a quiet document column that lives
 * inside the Browser Panel surface. Sections separate by space, not rules.
 */
export function Artifact({ title, children, className }: ArtifactProps) {
  return (
    <div
      className={cn(
        'absolute inset-0 bg-[var(--card)] text-[var(--foreground)]',
        BARE_ELEMENT_STYLES,
        className,
      )}
      data-cradle-artifact-root=""
      style={ARTIFACT_THEME_STYLE}
    >
      <div className="h-full overflow-auto">
        <article className="mx-auto flex max-w-3xl flex-col gap-y-9 px-5 py-6">
          {title
            ? (
                <h1 className="text-balance text-[22px] font-semibold leading-tight tracking-[-0.01em] text-[var(--foreground)]">
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
