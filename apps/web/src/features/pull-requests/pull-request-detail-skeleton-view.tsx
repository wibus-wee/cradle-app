import { Skeleton } from '~/components/ui/skeleton'

export function PullRequestDetailSkeletonView() {
  return (
    <div className="absolute inset-0 flex flex-col">
      <div className="flex justify-end px-4 py-2">
        <Skeleton className="size-7 rounded-md" />
      </div>
      <div className="mx-auto w-full max-w-3xl flex-1 px-6 pb-20">
        <Skeleton className="h-3.5 w-1/4" />
        <Skeleton className="mt-3 h-7 w-4/5" />
        <Skeleton className="mt-3 h-3.5 w-2/3" />
        <div className="mt-6 flex gap-1">
          <Skeleton className="h-7 w-20 rounded-md" />
          <Skeleton className="h-7 w-20 rounded-md" />
          <Skeleton className="h-7 w-20 rounded-md" />
        </div>
        <div className="mt-6 space-y-2">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-6" />
          ))}
        </div>
        <Skeleton className="mt-8 h-3 w-1/4" />
        <Skeleton className="mt-2 h-3 w-full" />
        <Skeleton className="mt-1.5 h-3 w-5/6" />
      </div>
    </div>
  )
}
