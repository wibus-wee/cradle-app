"use client"

import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Tabs as TabsPrimitive } from "radix-ui"

import { cn } from "~/lib/cn"

function Tabs({
  className,
  orientation = "horizontal",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      className={cn(
        "group/tabs flex gap-2 data-horizontal:flex-col",
        className
      )}
      {...props}
    />
  )
}

const tabsListVariants = cva(
  "group/tabs-list relative isolate inline-flex w-fit items-center gap-0.5 rounded-lg bg-secondary p-0.5 text-muted-foreground ring-1 ring-inset ring-black/[0.03] group-data-vertical/tabs:h-fit group-data-vertical/tabs:flex-col group-data-vertical/tabs:items-stretch dark:ring-white/[0.06]",
  {
    variants: {
      variant: {
        default: "",
        line: "",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

interface IndicatorBox {
  left: number
  top: number
  width: number
  height: number
}

function TabsList({
  className,
  variant = "default",
  children,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> &
  VariantProps<typeof tabsListVariants>) {
  const listRef = React.useRef<React.ComponentRef<typeof TabsPrimitive.List>>(null)
  const [box, setBox] = React.useState<IndicatorBox | null>(null)
  const [ready, setReady] = React.useState(false)

  const measure = React.useCallback(() => {
    const list = listRef.current
    const active = list?.querySelector<HTMLElement>(
      "[data-slot='tabs-trigger'][data-state='active']"
    )
    setBox(
      list && active
        ? {
            left: active.offsetLeft,
            top: active.offsetTop,
            width: active.offsetWidth,
            height: active.offsetHeight,
          }
        : null
    )
  }, [])

  React.useLayoutEffect(() => {
    measure()
    // Slide only after the initial position is committed
    const frame = requestAnimationFrame(() => setReady(true))
    const list = listRef.current
    if (!list) return () => cancelAnimationFrame(frame)

    const resizeObserver = new ResizeObserver(measure)
    resizeObserver.observe(list)
    for (const trigger of list.querySelectorAll("[data-slot='tabs-trigger']")) {
      resizeObserver.observe(trigger)
    }
    const mutationObserver = new MutationObserver(measure)
    mutationObserver.observe(list, {
      attributes: true,
      subtree: true,
      attributeFilter: ["data-state"],
    })
    document.fonts?.ready.then(measure).catch(() => {})
    return () => {
      cancelAnimationFrame(frame)
      resizeObserver.disconnect()
      mutationObserver.disconnect()
    }
  }, [measure, children])

  return (
    <TabsPrimitive.List
      ref={listRef}
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(tabsListVariants({ variant }), className)}
      {...props}
    >
      <span
        data-slot="tabs-indicator"
        aria-hidden="true"
        className={cn(
          "absolute z-0 rounded-md bg-background shadow-[var(--shadow-xs)]",
          ready && "transition-[left,top,width,height] duration-200 ease-out",
          box ? "opacity-100" : "opacity-0"
        )}
        style={box ? { left: box.left, top: box.top, width: box.width, height: box.height } : undefined}
      />
      {children}
    </TabsPrimitive.List>
  )
}

function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "relative z-10 inline-flex h-7 flex-1 items-center justify-center gap-1.5 rounded-md px-2.5 text-[13px] leading-none font-medium whitespace-nowrap text-muted-foreground transition-colors duration-150 group-data-vertical/tabs:w-full group-data-vertical/tabs:justify-start group-data-vertical/tabs:px-2.5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 data-active:text-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
        className
      )}
      {...props}
    />
  )
}

function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn("flex-1 text-sm outline-none", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants }
