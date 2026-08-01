import type { ComponentPropsWithoutRef } from 'react'

import { requestComposerInsert } from '../../composer/composer-insert'
import type { CommitGroupData } from '../../rendering/commit-group-block-view'
import {
  CommitGroupBlockView,
  parseCommitGroupFiles,
} from '../../rendering/commit-group-block-view'
import { MarkdownFileLink } from '../../rendering/markdown-file-link'

export type CommitGroupMarkdownProps = ComponentPropsWithoutRef<'div'> & CommitGroupData

function formatGroupForComposer(group: CommitGroupData): string {
  const files = parseCommitGroupFiles(group.files)
  const lines: string[] = [
    'Commit this group now.',
  ]
  if (group.message) {
    lines.push(`Message: ${group.message}`)
  }
  if (files.length > 0) {
    lines.push('Files:')
    for (const file of files) {
      lines.push(`- ${file}`)
    }
  }
  if (group.body) {
    lines.push('', group.body)
  }
  lines.push('', 'Stage only these files and create the commit. Do not push.')
  return `${lines.join('\n')}\n\n`
}

function readFileDisplayName(file: string): string {
  return file.split('/').filter(Boolean).at(-1) ?? file
}

/** Runtime adapter that adds workspace file links and a composer action to a commit group. */
export function MessageCommitGroup({
  sessionId,
  message,
  files,
  body,
}: CommitGroupMarkdownProps & { sessionId: string }) {
  const filePaths = parseCommitGroupFiles(files)
  const fileLinks = filePaths.length > 0
    ? new Map(filePaths.map(file => [
        file,
        <MarkdownFileLink key={file} href={file} sessionId={sessionId} className="font-mono" title={file}>
          {readFileDisplayName(file)}
        </MarkdownFileLink>,
      ]))
    : undefined

  return (
    <CommitGroupBlockView
      message={message}
      files={files}
      body={body}
      fileLinks={fileLinks}
      onAddToComposer={group => requestComposerInsert(sessionId, formatGroupForComposer({ ...group, files }))}
    />
  )
}
