"use client";

import { OTPField as OTPFieldPrimitive } from "@base-ui/react/otp-field";
import type * as React from "react";
import { cn } from "~/lib/cn";
import { Separator } from "~/components/ui/separator";

export function OTPField({
  className,
  size = "default",
  ...props
}: React.ComponentProps<typeof OTPFieldPrimitive.Root> & {
  size?: "default" | "lg";
}): React.ReactElement {
  return (
    <OTPFieldPrimitive.Root
      className={cn(
        "flex items-center gap-2 has-disabled:opacity-50 has-disabled:**:data-[slot=otp-field-input]:shadow-none",
        className,
      )}
      data-size={size}
      data-slot="otp-field"
      {...props}
    />
  );
}

export function OTPFieldInput({
  className,
  ...props
}: React.ComponentProps<typeof OTPFieldPrimitive.Input>): React.ReactElement {
  return (
    <OTPFieldPrimitive.Input
      className={cn(
        "relative in-[[data-slot=otp-field][data-size=lg]]:size-10 size-9 min-w-0 rounded-lg border border-input bg-background text-center in-[[data-slot=otp-field][data-size=lg]]:text-lg text-base text-foreground in-[[data-slot=otp-field][data-size=lg]]:leading-10 leading-9 shadow-[var(--shadow-xs)] outline-none transition-shadow focus-visible:z-10 focus-visible:border-ring focus-visible:shadow-none focus-visible:ring-ring/20 aria-invalid:border-destructive aria-invalid:shadow-none aria-invalid:focus-visible:border-destructive aria-invalid:focus-visible:ring-destructive/20 sm:in-[[data-slot=otp-field][data-size=lg]]:size-9 sm:size-8 sm:in-[[data-slot=otp-field][data-size=lg]]:text-base sm:text-sm sm:in-[[data-slot=otp-field][data-size=lg]]:leading-9 sm:leading-8",
        className,
      )}
      data-slot="otp-field-input"
      spellCheck={false}
      {...props}
    />
  );
}

export function OTPFieldSeparator({
  className,
  ...props
}: React.ComponentProps<typeof Separator>): React.ReactElement {
  return (
    <OTPFieldPrimitive.Separator
      render={
        <Separator
          className={cn(
            "rounded-full bg-input data-[orientation=horizontal]:h-0.5 data-[orientation=horizontal]:w-3",
            className,
          )}
          orientation="horizontal"
          {...props}
        />
      }
    />
  );
}

export { OTPFieldPrimitive };
