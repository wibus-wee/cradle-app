import type { ComponentPropsWithoutRef } from 'react'

import { requestComposerInsert } from '../../composer/composer-insert'
import type { CodeCommentData } from '../../rendering/code-comment-block-view'
import {
  CodeCommentBlockView,
} from '../../rendering/code-comment-block-view'
import { MarkdownFileLink } from '../../rendering/markdown-file-link'

export type CodeCommentMarkdownProps = ComponentPropsWithoutRef<'div'> & CodeCommentData

function formatCommentForComposer(comment: CodeCommentData): string {
  const lines: string[] = []
  if (comment.title) {
    lines.push(comment.title)
  }
  if (comment.file) {
    const range = comment.start
      ? `:${comment.start}${comment.end && comment.end !== comment.start ? `-${comment.end}` : ''}`
      : ''
    lines.push(`\`${comment.file}${range}\``)
  }
  if (comment.body) {
    lines.push('', comment.body)
  }
  return `${lines.join('\n')}\n\n`
}

function readLineRangeLabel(start?: string, end?: string): string | null {
  if (!start) {
    return null
  }
  return end && end !== start ? `${start}–${end}` : start
}

function readFileDisplayName(file: string): string {
  return file.split('/').filter(Boolean).at(-1) ?? file
}

/** Runtime adapter that adds workspace navigation and a composer action to a review finding. */
export function MessageCodeComment({
  sessionId,
  title,
  body,
  file,
  start,
  end,
  priority,
}: CodeCommentMarkdownProps & { sessionId: string }) {
  const lineRange = readLineRangeLabel(start, end)
  const fileLink = file
    ? (
        <MarkdownFileLink href={start ? `${file}:${start}` : file} sessionId={sessionId} className="font-mono" title={file}>
          {readFileDisplayName(file)}
          {lineRange ? `:${lineRange}` : ''}
        </MarkdownFileLink>
      )
    : undefined

  return (
    <CodeCommentBlockView
      title={title}
      body={body}
      file={file}
      start={start}
      end={end}
      priority={priority}
      fileLink={fileLink}
      onAddToComposer={comment => requestComposerInsert(sessionId, formatCommentForComposer(comment))}
    />
  )
}
