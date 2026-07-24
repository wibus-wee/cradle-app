import { SkillDetailView } from './skill-detail-view'
import type { EditableSkillScope } from './skill-manager-contract'
import type { SkillInventoryEntry } from './types'
import { useSkillDocument } from './use-skills'

interface SkillDetailContainerProps {
  entry: SkillInventoryEntry
  workspaceId?: string | null
  agentId?: string | null
  editableScope: EditableSkillScope
  onEdit: () => void
  onExport: () => void
  onDelete: () => void
}

export function SkillDetailContainer({
  entry,
  workspaceId,
  agentId,
  editableScope,
  onEdit,
  onExport,
  onDelete,
}: SkillDetailContainerProps) {
  const documentQuery = useSkillDocument({ workspaceId, agentId }, entry.scope, entry.name)

  return (
    <SkillDetailView
      entry={entry}
      document={documentQuery.data ?? null}
      editableScope={editableScope}
      onEdit={onEdit}
      onExport={onExport}
      onDelete={onDelete}
    />
  )
}
