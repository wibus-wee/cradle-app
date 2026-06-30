import { cn } from "~/lib/cn"
import { LoadingLine as Loader2Icon } from '@mingcute/react'
import * as React from "react"

const DEFAULT_DELAY_MS = 180

function useDelayedBusyState(active: boolean, delayMs = DEFAULT_DELAY_MS) {
  const [visible, setVisible] = React.useState(false)

  React.useEffect(() => {
    if (!active) {
      setVisible(false)
      return
    }

    const timeoutId = window.setTimeout(() => setVisible(true), delayMs)
    return () => window.clearTimeout(timeoutId)
  }, [active, delayMs])

  return active && visible
}

function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  return (
    <Loader2Icon role="status" aria-label="Loading" className={cn("size-4 animate-spin", className)} {...props} />
  )
}

function DelayedSpinner({
  active,
  delayMs = DEFAULT_DELAY_MS,
  className,
  ...props
}: React.ComponentProps<"svg"> & {
  active: boolean
  delayMs?: number
}) {
  const visible = useDelayedBusyState(active, delayMs)

  if (!visible) {
    return null
  }

  return <Spinner className={className} {...props} />
}

export { DelayedSpinner, Spinner, useDelayedBusyState }
