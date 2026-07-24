import { Skeleton } from '~/components/ui/skeleton'

export function PullRequestListSkeletonView() {
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-0.5 px-3 pt-3 pb-6">
      {Array.from({ length: 4 }, (_, index) => (
        <div key={index} className="flex items-center gap-3 rounded-lg px-3 py-2.5">
          <Skeleton className="size-4 rounded" />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Skeleton className="h-3 w-2/3" />
            <Skeleton className="h-2.5 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  )
}
