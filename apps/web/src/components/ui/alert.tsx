import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "~/lib/cn"

const alertVariants = cva(
  "group/alert relative grid w-full gap-0.5 rounded-xl border px-3.5 py-3 text-left text-[13px] leading-5 shadow-[inset_0_1px_0_0_--alpha(var(--color-white)/60%)] has-data-[slot=alert-action]:pr-16 has-[>svg]:grid-cols-[auto_1fr] has-[>svg]:gap-x-2.5 *:[svg]:row-span-2 *:[svg]:translate-y-[3px] *:[svg]:size-4 dark:shadow-[inset_0_1px_0_0_--alpha(var(--color-white)/8%)]",
  {
    variants: {
      variant: {
        default: "border-border bg-card text-foreground *:[svg]:text-muted-foreground",
        info: "border-info/15 bg-info/[0.05] text-foreground *:[svg]:text-info",
        success: "border-success/15 bg-success/[0.05] text-foreground *:[svg]:text-success",
        warning: "border-warning/15 bg-warning/[0.05] text-foreground *:[svg]:text-warning",
        destructive: "border-destructive/15 bg-destructive/[0.05] text-foreground *:[svg]:text-destructive",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Alert({
  className,
  variant,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  return (
    <div
      data-slot="alert"
      role="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  )
}

function AlertTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-title"
      className={cn(
        "self-center font-medium tracking-[-0.006em] group-has-[>svg]/alert:col-start-2 [&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-foreground",
        className
      )}
      {...props}
    />
  )
}

function AlertDescription({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-description"
      className={cn(
        "text-balance text-muted-foreground group-has-[>svg]/alert:col-start-2 md:text-pretty [&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-foreground [&_p:not(:last-child)]:mb-4",
        className
      )}
      {...props}
    />
  )
}

function AlertAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-action"
      className={cn("absolute top-2 right-2", className)}
      {...props}
    />
  )
}

export { Alert, AlertTitle, AlertDescription, AlertAction }
