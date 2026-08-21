import { cn } from '../cn'
import { Badge } from './badge'

export interface CodeBlockProps {
  code: string
  /** Optional filename or context label in the header row. */
  title?: string
  /** Optional language tag rendered as a badge. */
  language?: string
  className?: string
}

/** Mono snippet well with an optional header row. Content is plain text — never executed. */
export function CodeBlock({ code, title, language, className }: CodeBlockProps) {
  return (
    <figure className={cn('overflow-hidden rounded-[var(--radius-lg)] bg-[color-mix(in_srgb,var(--foreground)_4%,transparent)]', className)}>
      {(title || language)
        ? (
            <figcaption className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-3 py-1.5">
              <span className="min-w-0 truncate font-mono text-[11px] text-[var(--muted-foreground)]">{title}</span>
              {language ? <Badge className="shrink-0">{language}</Badge> : null}
            </figcaption>
          )
        : null}
      <pre className="overflow-x-auto p-3 font-mono text-[11px] leading-relaxed text-[var(--foreground)]">
        <code>{code}</code>
      </pre>
    </figure>
  )
}
