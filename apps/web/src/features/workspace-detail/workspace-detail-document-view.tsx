import { useTranslation } from 'react-i18next'

import { MarkdownEditor } from '~/components/editor/markdown-editor'
import { Spinner } from '~/components/ui/spinner'

import type { WorkspaceDetailDocumentState } from './workspace-detail-types'

export interface WorkspaceDetailDocumentViewProps {
  id: string
  filename: string
  testId?: string
  document: WorkspaceDetailDocumentState
  placeholder: string
}

export function WorkspaceDetailDocumentView({
  id,
  filename,
  testId,
  document,
  placeholder,
}: WorkspaceDetailDocumentViewProps) {
  const { t } = useTranslation('workspace')

  if (document.loading) {
    return (
      <div
        id={id}
        className="flex items-center gap-2 py-8 text-sm text-muted-foreground"
      >
        <Spinner className="size-3.5" />
        {t('document.status.loading')}
      </div>
    )
  }

  if (document.content === null) {
    return null
  }

  return (
    <section id={id} data-testid={testId}>
      <div className="mb-3 flex items-center gap-2">
        <span className="font-mono text-[12px] text-muted-foreground">
          {filename}
        </span>
        {document.saving
          ? (
              <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                <Spinner className="size-2.5" />
                {t('document.status.saving')}
              </span>
            )
          : null}
      </div>
      <MarkdownEditor
        content={document.content}
        documentId={id}
        onSave={nextContent => document.save(nextContent).then(() => undefined)}
        placeholder={placeholder}
      />
    </section>
  )
}
