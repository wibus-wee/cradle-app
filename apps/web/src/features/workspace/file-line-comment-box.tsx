import { CloseLine as XIcon, SendLine as SendIcon } from '@mingcute/react'
import { useEffect, useRef, useState } from 'react'

import { Button } from '~/components/ui/button'

export function FileLineCommentBox({
  lineNumber,
  onCancel,
  onSubmit,
}: {
  lineNumber: number
  onCancel: () => void
  onSubmit: (comment: string) => void
}) {
  const [value, setValue] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  return (
    <div
      className="absolute right-4 z-20 w-[min(26rem,calc(100%-4rem))] rounded-xl bg-[var(--color-surface)] p-3 shadow-[var(--shadow-md)]"
      onMouseDown={event => event.stopPropagation()}
      data-testid="workspace-file-line-comment-box"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-[var(--text-primary)]">
          Comment on line
{' '}
{lineNumber}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="Cancel line comment"
          onClick={onCancel}
        >
          <XIcon className="size-3" aria-hidden="true" />
        </Button>
      </div>
      <textarea
        ref={textareaRef}
        value={value}
        rows={3}
        placeholder="Describe the change you want"
        className="w-full resize-none rounded-lg bg-[var(--color-surface-inset)] px-2.5 py-2 text-xs text-[var(--text-primary)] outline-none shadow-[var(--shadow-inset-ring)] placeholder:text-[var(--text-dim)] focus-visible:ring-2 focus-visible:ring-[var(--color-accent-scope)]/30"
        onChange={event => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            onCancel()
          }
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && value.trim()) {
            event.preventDefault()
            onSubmit(value.trim())
          }
        }}
      />
      <div className="mt-2 flex justify-end">
        <Button
          type="button"
          size="sm"
          disabled={!value.trim()}
          onClick={() => onSubmit(value.trim())}
        >
          <SendIcon className="size-3.5" aria-hidden="true" />
          Add to prompt
        </Button>
      </div>
    </div>
  )
}
