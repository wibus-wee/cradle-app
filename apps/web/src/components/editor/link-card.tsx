import { ExternalLinkLine as ExternalLinkIcon } from '@mingcute/react'
import type { ReactNode } from 'react'

import { cn } from '~/lib/cn'

import { useLinkPreview } from './use-link-preview'

export type LinkCardDisplay = 'card' | 'compact'

interface LinkCardProps {
  href: string
  display: LinkCardDisplay
  /** Render an interactive toolbar (mode switch / open). Read-only contexts omit this. */
  toolbar?: ReactNode
  className?: string
}

/**
 * Notion-style link card. Renders OG metadata fetched server-side.
 *
 * Root is a `<span className="block">` (not a `<div>`) so it stays valid phrasing
 * content inside the `<p>` that react-markdown wraps a standalone link in — the
 * card simply fills the paragraph block. In the editor it sits inside a
 * `NodeViewWrapper` which is block-level, so the same component works in both.
 */
export function LinkCard({ href, display, toolbar, className }: LinkCardProps) {
  const { data, isPending, isError } = useLinkPreview(href)

  if (isPending) {
    return (
      <CardShell display={display} href={href} toolbar={toolbar} className={className}>
        <CardSkeleton display={display} />
      </CardShell>
    )
  }

  // Degrade to a plain inline-style link when unfurling fails or returns nothing.
  if (isError || !data || (!data.title && !data.image && !data.description)) {
    return (
      <CardShell display={display} href={href} toolbar={toolbar} className={className}>
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="inline-flex items-center gap-1 text-[13px] text-foreground underline underline-offset-4 decoration-border hover:decoration-foreground"
        >
          <span className="truncate">{displayUrl(href)}</span>
          <ExternalLinkIcon className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
        </a>
      </CardShell>
    )
  }

  return (
    <CardShell display={display} href={href} toolbar={toolbar} className={className}>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer nofollow"
        className="flex gap-3 no-underline"
      >
        {display === 'card'
          ? (
              <CardBody data={data} />
            )
          : (
              <CompactBody data={data} />
            )}
      </a>
    </CardShell>
  )
}

function CardShell({
  display,
  href,
  toolbar,
  className,
  children,
}: {
  display: LinkCardDisplay
  href: string
  toolbar?: ReactNode
  className?: string
  children: ReactNode
}) {
  return (
    <span
      data-link-card={display}
      data-href={href}
      className={cn(
        'group/link-card my-1 block w-full overflow-hidden rounded-lg ring-1 ring-foreground/10 bg-card text-card-foreground transition-colors',
        'hover:ring-foreground/20',
        display === 'compact' && 'max-w-md',
        className,
      )}
    >
      <span className="relative block">
        {children}
        {toolbar && (
          <span className="absolute right-1.5 top-1.5 z-10 flex items-center gap-0.5 rounded-md border border-border bg-popover/95 p-0.5 opacity-0 shadow-sm transition-opacity group-hover/link-card:opacity-100">
            {toolbar}
          </span>
        )}
      </span>
    </span>
  )
}

function CardBody({ data }: { data: { title: string | null, description: string | null, image: string | null, siteName: string | null, favicon: string | null } }) {
  return (
    <>
      <span className="flex min-w-0 flex-1 flex-col justify-center gap-1 p-3">
        {data.title && (
          <span className="line-clamp-2 text-[13px] font-medium leading-snug text-foreground">
            {data.title}
          </span>
        )}
        {data.description && (
          <span className="line-clamp-2 text-[12px] leading-5 text-muted-foreground">
            {data.description}
          </span>
        )}
        <SiteLine data={data} />
      </span>
      {data.image && (
        <span className="block h-full max-h-32 w-28 shrink-0 overflow-hidden bg-muted">
          <img
            src={data.image}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            className="h-full w-full object-cover"
          />
        </span>
      )}
    </>
  )
}

function CompactBody({ data }: { data: { title: string | null, image: string | null, siteName: string | null, favicon: string | null } }) {
  return (
    <span className="flex min-w-0 items-center gap-2 p-2">
      {data.image
        ? (
            <span className="block size-9 shrink-0 overflow-hidden rounded-md bg-muted">
              <img
                src={data.image}
                alt=""
                loading="lazy"
                referrerPolicy="no-referrer"
                className="size-full object-cover"
              />
            </span>
          )
        : data.favicon
          ? (
              <span className="block size-9 shrink-0 overflow-hidden rounded-md bg-muted p-1.5">
                <img
                  src={data.favicon}
                  alt=""
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  className="size-full object-contain"
                  onError={(event) => {
                    (event.currentTarget.parentElement as HTMLElement | null)?.style.setProperty('display', 'none')
                  }}
                />
              </span>
            )
          : null}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="line-clamp-1 text-[12px] font-medium text-foreground">
          {data.title || data.siteName}
        </span>
        <SiteLine data={data} compact />
      </span>
    </span>
  )
}

function SiteLine({
  data,
  compact = false,
}: {
  data: { siteName: string | null, favicon: string | null, url?: string }
  compact?: boolean
}) {
  return (
    <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
      {data.favicon && (
        <img
          src={data.favicon}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          className="size-3 shrink-0 object-contain"
          onError={(event) => {
            (event.currentTarget as HTMLElement).style.setProperty('display', 'none')
          }}
        />
      )}
      <span className={cn('truncate', compact && 'line-clamp-1')}>{data.siteName}</span>
    </span>
  )
}

function CardSkeleton({ display }: { display: LinkCardDisplay }) {
  if (display === 'compact') {
    return (
      <span className="flex items-center gap-2 p-2">
        <span className="size-9 shrink-0 animate-pulse rounded-md bg-muted" />
        <span className="flex flex-1 flex-col gap-1.5">
          <span className="h-3 w-2/3 animate-pulse rounded bg-muted" />
          <span className="h-2.5 w-1/3 animate-pulse rounded bg-muted" />
        </span>
      </span>
    )
  }
  return (
    <span className="flex gap-3 p-3">
      <span className="flex flex-1 flex-col gap-2">
        <span className="h-3.5 w-4/5 animate-pulse rounded bg-muted" />
        <span className="h-3 w-full animate-pulse rounded bg-muted" />
        <span className="h-2.5 w-1/4 animate-pulse rounded bg-muted" />
      </span>
      <span className="h-24 w-28 shrink-0 animate-pulse bg-muted" />
    </span>
  )
}

function displayUrl(href: string): string {
  try {
    const parsed = new URL(href)
    return `${parsed.hostname}${parsed.pathname === '/' ? '' : parsed.pathname}`
  }
  catch {
    return href
  }
}
