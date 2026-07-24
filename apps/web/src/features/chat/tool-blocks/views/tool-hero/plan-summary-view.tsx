import type { ToolPayload } from '../../../rendering/tool-ui-classifier'
import type { PlanDocumentOpenInput } from '../plan-document-preview-view'
import { PlanDocumentPreviewView } from '../plan-document-preview-view'

export interface PlanSummaryViewProps {
  input: ToolPayload
  output: ToolPayload
  toolCallId: string
  onOpenPlanDocument?: (input: PlanDocumentOpenInput) => void
}

export function PlanSummaryView({ input, output, toolCallId, onOpenPlanDocument }: PlanSummaryViewProps) {
  const text = output.planContent ?? input.planContent ?? output.plan ?? input.plan ?? output.text ?? input.text ?? output.rawText ?? input.rawText
  return text ? <PlanDocumentPreviewView toolCallId={toolCallId} text={text} onOpen={onOpenPlanDocument} /> : null
}
