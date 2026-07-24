import { Spinner } from '~/components/ui/spinner'

export interface WorkspacePaneLoadingViewProps {
  label: string
  testId: string
}

export function WorkspacePaneLoadingView({
  label,
  testId,
}: WorkspacePaneLoadingViewProps) {
  return (
    <output
      data-testid={testId}
      className="flex min-h-48 items-center justify-center text-sm text-muted-foreground"
    >
      <span className="inline-flex items-center gap-2 rounded-md bg-foreground/4 px-3 py-2">
        <Spinner className="size-3.5" />
        <span>{label}</span>
      </span>
    </output>
  )
}
