import {
  DeleteLine as Trash2Icon,
  DownloadLine as DownloadIcon,
  PencilLine as PencilIcon,
} from '@mingcute/react'

import { Button } from '~/components/ui/button'
import { ScrollArea } from '~/components/ui/scroll-area'
import { TruncatedText } from '~/components/ui/truncated-text'
import { cn } from '~/lib/cn'

import type { EditableSkillScope } from './skill-manager-contract'
import {
  skillScopeAccentClasses,
  skillScopeIcons,
  skillScopeLabels,
} from './skill-scope-presentation'
import type { SkillDocument, SkillInventoryEntry } from './types'

interface SkillDetailViewProps {
  entry: SkillInventoryEntry
  document: SkillDocument | null
  editableScope: EditableSkillScope
  onEdit: () => void
  onExport: () => void
  onDelete: () => void
}

export function SkillDetailView({
  entry,
  document,
  editableScope,
  onEdit,
  onExport,
  onDelete,
}: SkillDetailViewProps) {
  const isEditable = entry.scope === editableScope
  const Icon = skillScopeIcons[entry.scope]

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            className={cn(
              'flex size-7 shrink-0 items-center justify-center rounded-lg',
              skillScopeAccentClasses[entry.scope],
            )}
          >
            <Icon className="size-3.5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h3 className="truncate text-sm font-medium text-foreground">{entry.name}</h3>
            <span className="text-[11px] text-muted-foreground">
              {skillScopeLabels[entry.scope]}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {isEditable && (
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={onEdit}
              className="text-muted-foreground hover:text-foreground"
              aria-label={`Edit ${entry.name}`}
              data-testid="skill-edit-btn"
            >
              <PencilIcon aria-hidden="true" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={onExport}
            className="text-muted-foreground hover:text-foreground"
            aria-label={`Export ${entry.name}`}
            data-testid="skill-export-btn"
          >
            <DownloadIcon aria-hidden="true" />
          </Button>
          {isEditable && (
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={onDelete}
              className="text-muted-foreground hover:text-destructive"
              aria-label={`Delete ${entry.name}`}
              data-testid="skill-delete-btn"
            >
              <Trash2Icon aria-hidden="true" />
            </Button>
          )}
        </div>
      </div>

      {entry.description && (
        <TruncatedText maxLines={3} className="text-xs text-muted-foreground/60">
          {entry.description}
        </TruncatedText>
      )}

      {document?.body && (
        <div>
          <span className="text-[10px] text-muted-foreground">Content</span>
          <ScrollArea className="mt-1.5 max-h-96">
            <pre className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-muted-foreground/60">
              {document.body}
            </pre>
          </ScrollArea>
        </div>
      )}
    </div>
  )
}
