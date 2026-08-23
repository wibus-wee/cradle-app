import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '~/components/ui/button'
import { Textarea } from '~/components/ui/textarea'
import { cn } from '~/lib/cn'

import type { CodeViewLineSelection } from '../shared/diff-items'
import { getSelectedReviewRange } from '../shared/diff-items'
import type { ReviewFile } from '../shared/types'

type DiffReviewKey = keyof typeof import('~/locales/default').default['diff-review']

interface ThreadComposerProps {
  selection: CodeViewLineSelection
  files: ReviewFile[]
  itemIdToPath: Map<string, string>
  onClose: () => void
  onCreate: (input: { fileId: string, anchor: { fileId: string, side: 'base' | 'head', startLine: number, endLine: number }, bodyMarkdown: string }) => void
  pending: boolean
}

/**
 * Inline "add a comment" composer, rendered inside a Pierre annotation slot.
 *
 * Annotation slots are half the diff width in split view and wrap-hostile
 * (pre-wrap, min-width:0 flow roots), so this card must be self-contained:
 * no wide intrinsic content, everything flexes or wraps. The selected lines
 * above it already communicate the anchor — the composer only asks for text.
 */
export function ThreadComposer({
  selection,
  files,
  itemIdToPath,
  onClose,
  onCreate,
  pending,
}: ThreadComposerProps) {
  const { t } = useTranslation('diff-review')
  const [draft, setDraft] = useState('')
  const range = getSelectedReviewRange(selection, files, itemIdToPath)

  if (!range) {
    return null
  }

  const submit = () => {
    const body = draft.trim()
    if (!body) {
      return
    }
    onCreate({
      fileId: range.file.id,
      anchor: {
        fileId: range.file.id,
        side: range.side,
        startLine: range.startLine,
        endLine: range.endLine,
      },
      bodyMarkdown: body,
    })
  }

  return (
    <div
      className="min-w-0 px-1.5 py-0.5"
      data-testid="thread-composer"
    >
      <div
        className={cn(
          'min-w-0 overflow-hidden rounded-lg border border-border bg-card',
          'shadow-[var(--rv-shadow-pop)]',
        )}
      >
        <Textarea
          autoFocus
          value={draft}
          onChange={event => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
              event.preventDefault()
              submit()
            }
            if (event.key === 'Escape') {
              event.preventDefault()
              onClose()
            }
          }}
          placeholder={t('thread.addComment.placeholder' as DiffReviewKey)}
          className={cn(
            'max-h-48 min-h-14 w-full resize-none border-0 bg-transparent p-2.5',
            'text-[12.5px] shadow-none focus-visible:ring-0',
            'placeholder:text-muted-foreground/60',
          )}
        />
        <div className="flex items-center justify-between gap-2 border-t border-border/60 px-2 py-1.5">
          <span className="min-w-0 truncate text-[11px] text-muted-foreground/60">
            {t('thread.composer.submitHint' as DiffReviewKey, { shortcut: '⌘↵' })}
          </span>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-[12px] text-muted-foreground"
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              className="h-6 px-2.5 text-[12px]"
              disabled={!draft.trim() || pending}
              onClick={submit}
            >
              Comment
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
