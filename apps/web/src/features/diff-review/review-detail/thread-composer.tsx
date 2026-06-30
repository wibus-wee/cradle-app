import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '~/components/ui/button'
import { Textarea } from '~/components/ui/textarea'
import { cn } from '~/lib/cn'

import type { CodeViewLineSelection } from '../shared/diff-items'
import { formatSelectedReviewRange, getSelectedReviewRange } from '../shared/diff-items'
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
      className="my-px border-l border-border bg-background"
      data-testid="thread-composer"
    >
      <div className="flex items-start gap-2 px-3 py-2 pl-5">
        <span className="mt-1.5 max-w-48 shrink-0 truncate font-mono text-[12px] text-muted-foreground">
          {formatSelectedReviewRange(range)}
        </span>
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
            'min-h-7 flex-1 resize-none border-0 bg-transparent p-0 text-[13px] shadow-none focus-visible:ring-0',
            'placeholder:text-muted-foreground/60',
          )}
          rows={1}
        />
        <div className="mt-0.5 flex shrink-0 items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 text-[12px] text-muted-foreground"
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            className="h-6 text-[12px]"
            disabled={!draft.trim() || pending}
            onClick={submit}
          >
            Comment
          </Button>
        </div>
      </div>
    </div>
  )
}
