export interface TerminalSummaryViewProps { errorText?: string }

export function TerminalSummaryView({ errorText }: TerminalSummaryViewProps) {
  if (!errorText) { return null }
  return <div className="rounded-md bg-destructive/5 px-2.5 py-2 text-xs text-destructive/80">Command failed</div>
}
