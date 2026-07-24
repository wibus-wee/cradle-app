import type { ToolPayload } from '../../../rendering/tool-ui-classifier'

export interface WebSummaryViewProps { output: ToolPayload }

export function WebSummaryView({ output }: WebSummaryViewProps) {
  const links = output.results.flatMap(item => item.content.map(hit => ({ title: hit.title ?? 'Untitled', url: hit.url ?? '' })))
  if (links.length === 0) { return null }
  return (
<div className="grid gap-1">
{links.slice(0, 8).map(link => (
<a key={`${link.title}:${link.url}`} href={link.url} target="_blank" rel="noreferrer" className="rounded-md bg-muted/30 px-2 py-1.5 text-xs text-foreground/85 transition-colors hover:bg-muted/60">
<span className="block truncate">{link.title}</span>
<span className="block truncate font-mono text-[10px] text-muted-foreground">{link.url}</span>
</a>
))}
</div>
)
}
