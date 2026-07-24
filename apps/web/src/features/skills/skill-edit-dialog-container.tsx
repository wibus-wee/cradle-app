import type { SkillEditSubmission } from './skill-edit-dialog-view'
import { SkillEditDialogView } from './skill-edit-dialog-view'
import type {
  EditableSkillScope,
  SelectedSkillRef,
} from './skill-manager-contract'
import type { SkillScope } from './types'
import type { useSkills } from './use-skills'
import { useSkillDocument } from './use-skills'

interface SkillEditDialogContainerProps {
  open: boolean
  entry: SelectedSkillRef | null
  workspaceId?: string | null
  agentId?: string | null
  editableScope: EditableSkillScope
  createSkill: ReturnType<typeof useSkills>['createSkill']
  updateSkill: ReturnType<typeof useSkills>['updateSkill']
  onOpenChange: (open: boolean) => void
  onSaved: (scope: SkillScope, name: string) => void
}

export function SkillEditDialogContainer({
  open,
  entry,
  workspaceId,
  agentId,
  editableScope,
  createSkill,
  updateSkill,
  onOpenChange,
  onSaved,
}: SkillEditDialogContainerProps) {
  const isDraft = entry?.name === '__draft__'
  const documentQuery = useSkillDocument(
    { workspaceId, agentId },
    isDraft ? null : entry?.scope ?? null,
    isDraft ? null : entry?.name ?? null,
  )

  const handleSave = async (submission: SkillEditSubmission) => {
    if (isDraft) {
      const created = await createSkill.mutateAsync({
        scope: editableScope,
        ...submission,
      })
      onSaved(created.scope, created.name)
      onOpenChange(false)
      return
    }

    if (!entry) {
      throw new Error('No skill selected')
    }

    const updated = await updateSkill.mutateAsync({
      scope: entry.scope,
      currentName: entry.name,
      ...submission,
    })
    onSaved(updated.scope, updated.name)
    onOpenChange(false)
  }

  return (
    <SkillEditDialogView
      open={open}
      entry={entry}
      editableScope={editableScope}
      document={documentQuery.data ?? null}
      saving={createSkill.isPending || updateSkill.isPending}
      onOpenChange={onOpenChange}
      onSave={handleSave}
    />
  )
}
