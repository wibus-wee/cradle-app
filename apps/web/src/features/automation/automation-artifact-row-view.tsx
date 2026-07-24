import { FileLine as FileTextIcon } from '@mingcute/react'
import { useTranslation } from 'react-i18next'

import { cn } from '~/lib/cn'

import type { AutomationArtifact } from './types'

export interface AutomationArtifactRowViewProps {
  artifact: AutomationArtifact
  active: boolean
  onSelect: (artifactId: string) => void
}

export function AutomationArtifactRowView({
  artifact,
  active,
  onSelect,
}: AutomationArtifactRowViewProps) {
  const { t } = useTranslation('automation')

  return (
    <button
      type="button"
      onClick={() => onSelect(artifact.id)}
      className={cn(
        'group flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-xs transition-colors',
        active
          ? 'bg-accent text-foreground'
          : 'hover:bg-accent/50',
      )}
    >
      <FileTextIcon className="size-3.5 shrink-0 !text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate text-foreground">
        {artifact.title ?? artifact.name ?? artifact.id}
      </span>
      <span className="shrink-0 text-[10px] text-muted-foreground">
        {artifact.kind ?? artifact.mediaType ?? t('artifact.fallbackKind')}
      </span>
    </button>
  )
}
