import type { ToolPayload } from '../../../rendering/tool-ui-classifier'
import { KeyValueTable, RawValue } from '../tool-call-details'

export interface QuestionSummaryViewProps { output: ToolPayload }

export function QuestionSummaryView({ output }: QuestionSummaryViewProps) {
  return output.answers
    ? <KeyValueTable rows={Object.entries(output.answers).map(([question, answer]) => [question, String(answer)])} />
    : <RawValue value={output} />
}
