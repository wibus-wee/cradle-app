import { toBlobContentUrl } from '~/features/assets/blob-url'
import { cn } from '~/lib/cn'

function formatCount(value: number, singular: string, plural = `${singular}s`): string {
  return `${value.toLocaleString()} ${value === 1 ? singular : plural}`
}

/**
 * Plain-link notice for an externalized overflow (tool payload or text/reasoning).
 * Deliberately a link rather than an in-place expander — no fetch, no loading
 * state, no Container owning a query (Frontend Rendering Seams §3).
 */
export function BlobOverflowNotice({
  truncatedOriginalChars,
  blobId,
  sessionId,
  fullLabel = 'open full output',
}: {
  truncatedOriginalChars: number | null
  blobId: string | null
  sessionId?: string | null
  fullLabel?: string
}) {
  if (truncatedOriginalChars === null) {
    return null
  }

  const sizeLabel = formatCount(truncatedOriginalChars, 'character')

  if (blobId && sessionId) {
    return (
      <a
        href={toBlobContentUrl(blobId, sessionId)}
        target="_blank"
        rel="noreferrer"
        className={cn(
          'inline-flex text-xs text-muted-foreground underline-offset-2',
          'hover:text-foreground hover:underline active:scale-[0.98]',
        )}
        onClick={event => event.stopPropagation()}
      >
        {`Original was ${sizeLabel} — ${fullLabel}`}
      </a>
    )
  }

  return (
    <p className="text-xs text-muted-foreground">
      {`Original was ${sizeLabel}; remainder unavailable.`}
    </p>
  )
}
