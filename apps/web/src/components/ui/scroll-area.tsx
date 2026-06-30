import * as React from "react"
import { ScrollArea as ScrollAreaPrimitive } from "radix-ui"

import { cn } from "~/lib/cn"

function ScrollArea({
  className,
  children,
  viewportClassName,
  contentClassName,
  viewportRef,
  scrollbarGutter: _scrollbarGutter,
  scrollFade = false,
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.Root> & {
  viewportClassName?: string
  contentClassName?: string
  viewportRef?: React.Ref<HTMLDivElement>
  scrollbarGutter?: boolean
  scrollFade?: boolean
}) {
  return (
    <ScrollAreaPrimitive.Root
      data-slot="scroll-area"
      className={cn(
        "relative",
        scrollFade && [
          "overflow-hidden [--scroll-area-fade-background:var(--background)]",
          "before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:z-10 before:h-4 before:bg-linear-to-b before:from-[var(--scroll-area-fade-background)] before:to-transparent",
          "after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:z-10 after:h-4 after:bg-linear-to-t after:from-[var(--scroll-area-fade-background)] after:to-transparent",
        ],
        className
      )}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport
        ref={viewportRef}
        data-slot="scroll-area-viewport"
        className={cn(
          "size-full rounded-[inherit] transition-[color,box-shadow] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1",
          contentClassName && "[&>div]:!block [&>div]:!min-w-0 [&>div]:!w-full [&>div]:!max-w-full",
          viewportClassName
        )}
      >
        {contentClassName ? <div className={contentClassName}>{children}</div> : children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollBar />
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  )
}

function ScrollBar({
  className,
  orientation = "vertical",
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>) {
  return (
    <ScrollAreaPrimitive.ScrollAreaScrollbar
      data-slot="scroll-area-scrollbar"
      data-orientation={orientation}
      orientation={orientation}
      className={cn(
        "flex touch-none p-px transition-colors select-none data-horizontal:h-2.5 data-horizontal:flex-col data-horizontal:border-t data-horizontal:border-t-transparent data-vertical:h-full data-vertical:w-2.5 data-vertical:border-l data-vertical:border-l-transparent",
        className
      )}
      {...props}
    >
      <ScrollAreaPrimitive.ScrollAreaThumb
        data-slot="scroll-area-thumb"
        className="relative flex-1 rounded-full bg-border"
      />
    </ScrollAreaPrimitive.ScrollAreaScrollbar>
  )
}

export { ScrollArea }
