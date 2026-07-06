import { StaticRender } from '@cradle/streamdown'
import { LayoutTopLine as PanelTopIcon } from '@mingcute/react'

interface PlanDocumentViewerProps {
  title: string
  text: string
}

export function PlanDocumentViewer({ title, text }: PlanDocumentViewerProps) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border/70 px-4">
        <PanelTopIcon className="size-3.5 shrink-0 !text-muted-foreground/70" aria-hidden="true" />
        <span className="min-w-0 truncate text-[13px] font-medium text-foreground">{title}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="streamdown-root px-5 py-4 text-sm leading-relaxed">
          <StaticRender content={text} />
        </div>
      </div>
    </div>
  )
}
