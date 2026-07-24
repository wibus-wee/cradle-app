import { Spinner } from '~/components/ui/spinner'

export function WorkspaceDetailLoadingView() {
  return (
    <div className="flex h-full items-center justify-center bg-background">
      <Spinner className="size-4 !text-muted-foreground" />
    </div>
  )
}
