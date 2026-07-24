import type { ToolPayload } from '../../../rendering/tool-ui-classifier'
import { PathList, RawValue } from '../tool-call-details'

export interface SearchSummaryViewProps { output: ToolPayload }

export function SearchSummaryView({ output }: SearchSummaryViewProps) {
  return output.contentText
    ? <RawValue value={output.contentText} />
    : <PathList paths={output.filenames} emptyText="Search returned no files." />
}
