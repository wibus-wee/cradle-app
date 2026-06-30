import { useEffect, useRef } from 'react'

import type { KanbanIssue } from '~/features/kanban/types'
import { cn } from '~/lib/cn'

interface IssueTitleProps {
  issue: KanbanIssue
  onUpdate: (patch: { title: string }) => void
  readOnly?: boolean
}

export function IssueTitle({ issue, onUpdate, readOnly = false }: IssueTitleProps) {
  return (
    <IssueTitleEditor
      key={`${issue.id}:${issue.title}`}
      initialTitle={issue.title}
      readOnly={readOnly}
      onCommit={(title) => {
        if (!readOnly && title !== issue.title) {
          onUpdate({ title })
        }
      }}
    />
  )
}

function IssueTitleEditor({
  initialTitle,
  readOnly,
  onCommit,
}: {
  initialTitle: string
  readOnly: boolean
  onCommit: (title: string) => void
}) {
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    requestAnimationFrame(() => {
      if (ref.current) {
        ref.current.style.height = '0'
        const h = ref.current.scrollHeight
        ref.current.style.height = `${h}px`
      }
    })
  }, [])

  const commitTitleEdit = () => {
    if (readOnly) {
      return
    }
    const trimmed = ref.current?.value.trim() ?? ''
    if (trimmed) {
      onCommit(trimmed)
    }
  }

  return (
    <div data-testid="issue-title-display">
      <textarea
        ref={ref}
        defaultValue={initialTitle}
        aria-label="Issue title"
        readOnly={readOnly}
        onChange={(e) => {
          if (readOnly) {
            return
          }
          const el = e.currentTarget
          el.style.height = '0'
          const h = el.scrollHeight
          el.style.height = `${h}px`
        }}
        onBlur={commitTitleEdit}
        onKeyDown={(e) => {
          if (readOnly) {
            return
          }
          if (e.key === 'Enter') {
            e.preventDefault()
            e.currentTarget.blur()
          }
        }}
        placeholder="Issue title"
        rows={1}
        data-testid="issue-title-input"
        className={cn(
          'w-full resize-none overflow-hidden border-none bg-transparent text-2xl font-semibold text-foreground outline-none placeholder:text-muted-foreground/50',
          readOnly && 'cursor-default',
        )}
      />
    </div>
  )
}
