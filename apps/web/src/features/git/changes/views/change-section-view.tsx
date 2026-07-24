import { useTranslation } from 'react-i18next'

import type { ChangeSection } from '../lib/changes-grouping'
import { ChangeFileRowView } from './change-file-row-view'

const CHANGE_SECTION_LABELS = {
  sources: 'changes.section.sources',
  docs: 'changes.section.docs',
  tests: 'changes.section.tests',
} as const

export interface ChangeSectionViewProps {
  section: ChangeSection
  onFileClick: (path: string) => void
}

export function ChangeSectionView({
  section,
  onFileClick,
}: ChangeSectionViewProps) {
  const { t } = useTranslation('git')
  const label = t(CHANGE_SECTION_LABELS[section.id])

  return (
    <section
      className="px-2 pb-3 last:pb-1"
      data-testid={`changes-section-${section.id}`}
      aria-label={label}
    >
      <div className="mb-1 flex h-5 items-center gap-2 px-1">
        <span className="min-w-0 flex-1 truncate text-[10px] font-semibold uppercase tracking-normal text-muted-foreground/70">
          {label}
        </span>
        <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/45">
          {section.files.length}
        </span>
      </div>
      <menu className="overflow-hidden rounded-md border border-border/35 bg-background/30">
        {section.files.map(file => (
          <ChangeFileRowView
            key={file.path}
            file={file}
            onClick={onFileClick}
          />
        ))}
      </menu>
    </section>
  )
}
