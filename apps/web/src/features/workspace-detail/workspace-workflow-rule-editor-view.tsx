import { MarkdownEditor } from '~/components/editor/markdown-editor'

export interface WorkspaceWorkflowRuleEditorViewProps {
  agentId: string | null
  content: string | null
  placeholder: string
  onSave: (agentId: string | null, content: string) => void
}

export function WorkspaceWorkflowRuleEditorView({
  agentId,
  content,
  placeholder,
  onSave,
}: WorkspaceWorkflowRuleEditorViewProps) {
  return (
    <div
      data-testid="workspace-workflow-rules-editor"
      data-workflow-scope={agentId ?? 'global'}
    >
      <MarkdownEditor
        content={content}
        documentId={`workflow-rule:${agentId ?? 'global'}`}
        onSave={markdown => onSave(agentId, markdown)}
        placeholder={placeholder}
      />
    </div>
  )
}
