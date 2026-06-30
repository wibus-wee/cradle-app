import { LoadingLine as LoaderCircleIcon } from '@mingcute/react'
export function RouteLoadingFallback() {
  return (
    <div className="flex h-full items-center justify-center">
      <LoaderCircleIcon className="size-4 animate-spin !text-muted-foreground/40" />
    </div>
  )
}
