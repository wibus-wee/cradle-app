"use client";

import { Toast } from "@base-ui/react/toast";
import {
  AlertLine as CircleAlertIcon,
  CheckCircleLine as CircleCheckIcon,
  InformationLine as InfoIcon,
  LoadingLine as LoaderCircleIcon,
  WarningLine as TriangleAlertIcon,
  CloseLine as XIcon
} from '@mingcute/react';
import type React from "react";
import { cn } from "~/lib/cn";

// ── Icon mapping ──────────────────────────────────────────────────────────

const TOAST_ICONS = {
  error: CircleAlertIcon,
  info: InfoIcon,
  loading: LoaderCircleIcon,
  success: CircleCheckIcon,
  warning: TriangleAlertIcon,
} as const;

const TOAST_ICON_COLORS: Record<keyof typeof TOAST_ICONS, string> = {
  error: "text-destructive",
  info: "text-info",
  loading: "animate-spin text-foreground opacity-80",
  success: "text-success",
  warning: "text-warning",
};

// ── Helpers ───────────────────────────────────────────────────────────────

type SwipeDirection = "up" | "down" | "left" | "right";

function getSwipeDirection(position: ToastPosition): SwipeDirection[] {
  const verticalDirection: SwipeDirection = position.startsWith("top")
    ? "up"
    : "down";

  if (position.includes("center")) {
    return [verticalDirection];
  }

  if (position.includes("left")) {
    return ["left", verticalDirection];
  }

  return ["right", verticalDirection];
}

function upsertReplayClassName(toast: {
  type?: string;
  updateKey?: number;
}): string | undefined {
  const k = toast.updateKey ?? 0;
  if (k <= 0) return undefined;
  const isEven = k % 2 === 0;
  if (toast.type === "error") {
    return isEven ? "animate-toast-error-even" : "animate-toast-error-odd";
  }
  return isEven ? "animate-toast-success-even" : "animate-toast-success-odd";
}

// ── Toast root stacking classes ───────────────────────────────────────────

const TOAST_ROOT_POSITION_CLASSES = {
  // Right positioning
  "data-[position*=right]:right-0 data-[position*=right]:left-auto": true,
  // Left positioning
  "data-[position*=left]:right-auto data-[position*=left]:left-0": true,
  // Center positioning
  "data-[position*=center]:right-0 data-[position*=center]:left-0": true,
  // Top origin
  "data-[position*=top]:top-0 data-[position*=top]:bottom-auto data-[position*=top]:origin-[50%_calc(50%-50%*min(var(--toast-index,0),1))]": true,
  // Bottom origin
  "data-[position*=bottom]:top-auto data-[position*=bottom]:bottom-0 data-[position*=bottom]:origin-[50%_calc(50%+50%*min(var(--toast-index,0),1))]": true,
  // Gap fill for hover
  "after:absolute after:left-0 after:h-[calc(var(--toast-gap)+1px)] after:w-full": true,
  "data-[position*=top]:after:top-full": true,
  "data-[position*=bottom]:after:bottom-full": true,
  // Stacking variables
  "[--toast-calc-height:var(--toast-frontmost-height,var(--toast-height))] [--toast-gap:--spacing(3)] [--toast-peek:--spacing(3)] [--toast-scale:calc(max(0,1-(var(--toast-index)*.1)))] [--toast-shrink:calc(1-var(--toast-scale))]": true,
  // Offset-y
  "data-[position*=top]:[--toast-calc-offset-y:calc(var(--toast-offset-y)+var(--toast-index)*var(--toast-gap)+var(--toast-swipe-movement-y))]": true,
  "data-[position*=bottom]:[--toast-calc-offset-y:calc(var(--toast-offset-y)*-1+var(--toast-index)*var(--toast-gap)*-1+var(--toast-swipe-movement-y))]": true,
  // Default state transform
  "data-[position*=top]:transform-[translateX(var(--toast-swipe-movement-x))_translateY(calc(var(--toast-swipe-movement-y)+(var(--toast-index)*var(--toast-peek))+(var(--toast-shrink)*var(--toast-calc-height))))_scale(var(--toast-scale))]": true,
  "data-[position*=bottom]:transform-[translateX(var(--toast-swipe-movement-x))_translateY(calc(var(--toast-swipe-movement-y)-(var(--toast-index)*var(--toast-peek))-(var(--toast-shrink)*var(--toast-calc-height))))_scale(var(--toast-scale))]": true,
  // Limited state
  "data-limited:opacity-0": true,
  // Expanded state
  "data-expanded:h-(--toast-height)": true,
  "data-position:data-expanded:transform-[translateX(var(--toast-swipe-movement-x))_translateY(var(--toast-calc-offset-y))]": true,
  // Starting and ending animations
  "data-[position*=top]:data-starting-style:transform-[translateY(calc(-100%-var(--toast-inset)))]": true,
  "data-[position*=bottom]:data-starting-style:transform-[translateY(calc(100%+var(--toast-inset)))]": true,
  "data-ending-style:opacity-0": true,
  // Ending animations (direction-aware)
  "data-ending-style:not-data-limited:not-data-swipe-direction:transform-[translateY(calc(100%+var(--toast-inset)))]": true,
  "data-ending-style:data-[swipe-direction=left]:transform-[translateX(calc(var(--toast-swipe-movement-x)-100%-var(--toast-inset)))_translateY(var(--toast-calc-offset-y))]": true,
  "data-ending-style:data-[swipe-direction=right]:transform-[translateX(calc(var(--toast-swipe-movement-x)+100%+var(--toast-inset)))_translateY(var(--toast-calc-offset-y))]": true,
  "data-ending-style:data-[swipe-direction=up]:transform-[translateY(calc(var(--toast-swipe-movement-y)-100%-var(--toast-inset)))]": true,
  "data-ending-style:data-[swipe-direction=down]:transform-[translateY(calc(var(--toast-swipe-movement-y)+100%+var(--toast-inset)))]": true,
  // Ending animations (expanded)
  "data-expanded:data-ending-style:data-[swipe-direction=left]:transform-[translateX(calc(var(--toast-swipe-movement-x)-100%-var(--toast-inset)))_translateY(var(--toast-calc-offset-y))]": true,
  "data-expanded:data-ending-style:data-[swipe-direction=right]:transform-[translateX(calc(var(--toast-swipe-movement-x)+100%+var(--toast-inset)))_translateY(var(--toast-calc-offset-y))]": true,
  "data-expanded:data-ending-style:data-[swipe-direction=up]:transform-[translateY(calc(var(--toast-swipe-movement-y)-100%-var(--toast-inset)))]": true,
  "data-expanded:data-ending-style:data-[swipe-direction=down]:transform-[translateY(calc(var(--toast-swipe-movement-y)+100%+var(--toast-inset)))]": true,
};

// ── Toasts (viewport) ─────────────────────────────────────────────────────

function Toasts({ position }: { position: ToastPosition }): React.ReactElement {
  const { toasts } = Toast.useToastManager();
  const swipeDirection = getSwipeDirection(position);

  return (
    <Toast.Portal data-slot="toast-portal">
      <Toast.Viewport
        className={cn(
          "fixed z-60 mx-auto flex w-[calc(100%-var(--toast-inset)*2)] max-w-90 [--toast-inset:--spacing(4)] sm:[--toast-inset:--spacing(8)]",
          "data-[position*=top]:top-(--toast-inset)",
          "data-[position*=bottom]:bottom-(--toast-inset)",
          "data-[position*=left]:left-(--toast-inset)",
          "data-[position*=right]:right-(--toast-inset)",
          "data-[position*=center]:left-1/2 data-[position*=center]:-translate-x-1/2",
        )}
        data-position={position}
        data-slot="toast-viewport"
      >
        {toasts.map((toast) => {
          const type = toast.type as keyof typeof TOAST_ICONS | undefined;
          const Icon = type ? TOAST_ICONS[type] : null;
          const iconColor = type ? TOAST_ICON_COLORS[type] : undefined;
          const replayClassName = upsertReplayClassName(toast);

          return (
            <Toast.Root
              key={toast.id}
              className={cn(
                // Base: floating surface
                "absolute z-[calc(9999-var(--toast-index))] h-(--toast-calc-height) w-full select-none rounded-xl border border-border/50 bg-popover/95 backdrop-blur-sm text-popover-foreground shadow-lg [transition:transform_.5s_cubic-bezier(.22,1,.36,1),opacity_.5s,height_.15s] data-expanded:bg-popover",
                // Stacking + positioning
                TOAST_ROOT_POSITION_CLASSES,
                replayClassName,
              )}
              data-position={position}
              swipeDirection={swipeDirection}
              toast={toast}
            >
              <Toast.Content className="pointer-events-auto flex items-start justify-between gap-2 overflow-hidden px-3.5 py-3 transition-opacity duration-250 data-behind:not-data-expanded:pointer-events-none data-behind:opacity-0 data-expanded:opacity-100">
                <div className="flex min-w-0 gap-2">
                  {Icon && (
                    <div
                      className="mt-px [&>svg]:size-4 [&>svg]:shrink-0"
                      data-slot="toast-icon"
                    >
                      <Icon className={iconColor} />
                    </div>
                  )}

                  <div className="flex min-w-0 flex-col gap-0.5">
                    <Toast.Title
                      className="text-sm font-medium text-foreground"
                      data-slot="toast-title"
                    />
                    <Toast.Description
                      className="text-xs text-muted-foreground"
                      data-slot="toast-description"
                    />
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  {toast.actionProps && (
                    <Toast.Action
                      className="inline-flex h-6 items-center rounded-md bg-muted px-2 text-xs font-medium text-foreground transition-colors hover:bg-muted/80"
                      data-slot="toast-action"
                    >
                      {toast.actionProps.children}
                    </Toast.Action>
                  )}
                  <Toast.Close
                    className="flex size-6 shrink-0 items-center justify-center rounded-md text-[--color-text-dim] transition-colors hover:text-secondary-foreground"
                    aria-label="Dismiss"
                  >
                    <XIcon className="size-3.5" />
                  </Toast.Close>
                </div>
              </Toast.Content>
            </Toast.Root>
          );
        })}
      </Toast.Viewport>
    </Toast.Portal>
  );
}

// ── Toast Manager (programmatic API) ──────────────────────────────────────

export const toastManager: ReturnType<typeof Toast.createToastManager> =
  Toast.createToastManager();

// ── Position type ─────────────────────────────────────────────────────────

type ToastPosition =
  | "top-left"
  | "top-center"
  | "top-right"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right";

// ── Provider ──────────────────────────────────────────────────────────────

export interface ToastProviderProps extends Toast.Provider.Props {
  position?: ToastPosition;
}

export function ToastProvider({
  children,
  position = "bottom-right",
  ...props
}: ToastProviderProps): React.ReactElement {
  return (
    <Toast.Provider toastManager={toastManager} {...props}>
      {children}
      <Toasts position={position} />
    </Toast.Provider>
  );
}
