import {
  Chat1Line as AnnotationIcon,
  DeleteLine as TrashIcon,
  PencilLine as PencilIcon,
  SendLine as SendIcon,
} from '@mingcute/react'

import { Button } from '~/components/ui/button'
import { cn } from '~/lib/cn'
import type { BrowserAnnotationRecord } from '~/store/browser-panel'

import {
  countBrowserAnnotationDesignChanges,
  formatBrowserAnnotationAnchor,
  formatBrowserAnnotationSummary,
  getBrowserAnnotationPreviewTarget,
} from './browser-annotation-presenter'
import { BROWSER_NATIVE_SURFACE_OCCLUSION_PROPS } from './native-surface-occlusion'

export interface BrowserAnnotationRailViewProps {
  annotations: BrowserAnnotationRecord[]
  collapsed: boolean
  onCollapsedChange: (collapsed: boolean) => void
  onClear: () => void
  onEdit: (annotation: BrowserAnnotationRecord) => void
  onDelete: (annotationId: string) => void
  onSend: (annotation: BrowserAnnotationRecord) => void
}

export function BrowserAnnotationRailView({
  annotations,
  collapsed,
  onCollapsedChange,
  onClear,
  onEdit,
  onDelete,
  onSend,
}: BrowserAnnotationRailViewProps) {
  if (annotations.length === 0) {
    return null
  }

  if (collapsed) {
    return (
      <div
        {...BROWSER_NATIVE_SURFACE_OCCLUSION_PROPS}
        className="absolute right-3 top-3 z-20 flex max-h-[calc(100%-1.5rem)] items-start justify-end"
      >
        <Button
          type="button"
          size="icon"
          className="relative size-10 animate-[browser-annotation-popup-enter_200ms_cubic-bezier(0.34,1.56,0.64,1)_both] rounded-full bg-primary text-primary-foreground shadow-[0_10px_34px_rgba(0,0,0,0.16),inset_0_0_0_1px_rgba(0,0,0,0.04)] backdrop-blur-md hover:scale-105 hover:bg-primary/90 active:scale-[0.96] motion-reduce:animate-none dark:shadow-[0_12px_40px_rgba(0,0,0,0.45),inset_0_0_0_1px_rgba(255,255,255,0.12)]"
          onClick={() => onCollapsedChange(false)}
          aria-label={`Show ${annotations.length} browser annotations`}
          aria-expanded="false"
        >
          <AnnotationIcon className="size-4" />
          <span className="absolute -right-1 -top-1 flex min-w-5 items-center justify-center rounded-full bg-background px-1.5 text-[10px] font-medium tabular-nums text-primary shadow-sm ring-2 ring-primary">
            {annotations.length}
          </span>
        </Button>
      </div>
    )
  }

  return (
    <div
      {...BROWSER_NATIVE_SURFACE_OCCLUSION_PROPS}
      className="absolute right-3 top-3 z-20 flex max-h-[calc(100%-1.5rem)] items-start justify-end"
    >
      <div className="flex max-h-full w-72 origin-top-right animate-[browser-annotation-popup-enter_200ms_cubic-bezier(0.34,1.56,0.64,1)_both] flex-col overflow-hidden rounded-2xl bg-popover/95 text-popover-foreground shadow-[0_4px_24px_rgba(0,0,0,0.18),0_0_0_1px_rgba(0,0,0,0.06)] backdrop-blur-md motion-reduce:animate-none dark:bg-[#1a1a1a]/95 dark:shadow-[0_4px_24px_rgba(0,0,0,0.34),0_0_0_1px_rgba(255,255,255,0.08)]">
        <div className="flex h-10 shrink-0 items-center justify-between gap-2 px-2">
          <Button
            type="button"
            variant="ghost"
            className="h-auto min-w-0 justify-start gap-2 rounded-md px-2 py-1 text-left text-xs text-popover-foreground hover:bg-foreground/5"
            onClick={() => onCollapsedChange(true)}
            aria-label="Collapse browser annotations"
            aria-expanded="true"
          >
            <AnnotationIcon className="size-3.5 shrink-0 !text-primary" />
            <span className="truncate">Annotations</span>
            <span className="rounded bg-foreground/7 px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">
              {annotations.length}
            </span>
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground"
            onClick={onClear}
            title="Clear all browser annotations"
            aria-label="Clear all browser annotations"
          >
            <TrashIcon className="size-3.5" />
          </Button>
        </div>
        <div className="min-h-0 overflow-y-auto px-1.5 pb-1.5">
          {annotations.map((annotation, index) => {
            const previewTarget
              = getBrowserAnnotationPreviewTarget(annotation)
            const designChangeCount
              = countBrowserAnnotationDesignChanges(annotation.designChange)

            return (
              <div
                key={annotation.id}
                className="group mb-1.5 grid grid-cols-[44px_minmax(0,1fr)] gap-2 rounded-lg p-1.5 transition-[background-color,scale] duration-150 ease-out last:mb-0 hover:bg-foreground/5 active:scale-[0.99]"
              >
                <div className="relative h-11 overflow-hidden rounded-md bg-muted ring-1 ring-border/60">
                  <img
                    src={annotation.screenshot.url}
                    alt=""
                    className="size-full object-cover"
                    draggable={false}
                  />
                  <div
                    className="absolute inset-0 bg-black/5"
                    aria-hidden="true"
                  />
                  {previewTarget?.mode === 'rect'
                    ? (
                        <span
                          className="absolute rounded-[2px] border border-primary bg-primary/15 shadow-[0_0_0_1px_rgba(255,255,255,0.45)]"
                          style={previewTarget.style}
                          aria-hidden="true"
                        />
                      )
                    : null}
                  {previewTarget?.mode === 'point'
                    ? (
                        <span
                          className="absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary shadow-[0_0_0_2px_rgba(255,255,255,0.7)]"
                          style={previewTarget.style}
                          aria-hidden="true"
                        />
                      )
                    : null}
                  <span
                    className="absolute left-3 top-3 flex size-5 -translate-x-1/2 -translate-y-1/2 animate-[browser-annotation-marker-in_250ms_cubic-bezier(0.22,1,0.36,1)_both] items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground shadow-[0_2px_6px_rgba(0,0,0,0.20),inset_0_0_0_1px_rgba(0,0,0,0.04)] motion-reduce:animate-none"
                    style={{ animationDelay: `${index * 20}ms` }}
                    aria-hidden="true"
                  >
                    {index + 1}
                  </span>
                </div>
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-popover-foreground">
                      {formatBrowserAnnotationAnchor(annotation.anchor)}
                    </span>
                    <span
                      className={cn(
                        'shrink-0 rounded px-1.5 py-0.5 text-[10px] tabular-nums',
                        annotation.status === 'sent'
                          ? 'bg-primary/10 text-primary'
                          : 'bg-foreground/7 text-muted-foreground',
                      )}
                    >
                      {annotation.status}
                    </span>
                  </div>
                  <div className="mt-0.5 line-clamp-2 text-[11px] leading-4 text-muted-foreground">
                    {formatBrowserAnnotationSummary(annotation)}
                  </div>
                  <div className="mt-1.5 flex items-center justify-between gap-1">
                    <span className="truncate text-[10px] text-muted-foreground/80">
                      {designChangeCount > 0
                        ? `${designChangeCount} ${designChangeCount === 1 ? 'adjustment' : 'adjustments'}`
                        : 'Browser note'}
                    </span>
                    <span className="flex shrink-0 items-center gap-0.5">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="size-6 rounded-md text-muted-foreground hover:text-foreground"
                        onClick={() => onEdit(annotation)}
                        title="Edit browser annotation"
                        aria-label="Edit browser annotation"
                      >
                        <PencilIcon className="size-3" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="size-6 rounded-md text-muted-foreground hover:text-foreground"
                        onClick={() => onDelete(annotation.id)}
                        title="Delete browser annotation"
                        aria-label="Delete browser annotation"
                      >
                        <TrashIcon className="size-3" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="size-6 rounded-md text-muted-foreground hover:text-foreground"
                        onClick={() => onSend(annotation)}
                        title={
                          annotation.status === 'sent'
                            ? 'Resend browser annotation'
                            : 'Send browser annotation'
                        }
                        aria-label={
                          annotation.status === 'sent'
                            ? 'Resend browser annotation'
                            : 'Send browser annotation'
                        }
                      >
                        <SendIcon className="size-3" />
                      </Button>
                    </span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
