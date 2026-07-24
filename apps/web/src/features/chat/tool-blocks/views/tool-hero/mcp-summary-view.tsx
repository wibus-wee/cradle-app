import type { ToolPayload } from '../../../rendering/tool-ui-classifier'
import { RawValue } from '../tool-call-details'

export interface McpSummaryViewProps { output: ToolPayload, errorText?: string }

export function McpSummaryView({ output, errorText }: McpSummaryViewProps) {
  if (errorText || output.error) { return <div className="rounded-md bg-destructive/5 px-2.5 py-2 text-xs text-destructive/80">{errorText || output.error}</div> }
  const blocks = output.contentBlocks.length > 0 ? output.contentBlocks : output.contents
  const content = blocks.map(item => item.text).filter(Boolean).join('\n\n')
  if (content) { return <RawValue value={content} className="max-h-64" /> }
  const rawText = output.rawText ?? output.outputText ?? output.contentText ?? output.text
  if (rawText) { return <RawValue value={rawText} className="max-h-64" /> }
  return blocks.length > 0 ? <div className="rounded-md bg-muted/30 px-2.5 py-2 text-xs text-muted-foreground">{`${blocks.length} content block${blocks.length === 1 ? '' : 's'}`}</div> : null
}
