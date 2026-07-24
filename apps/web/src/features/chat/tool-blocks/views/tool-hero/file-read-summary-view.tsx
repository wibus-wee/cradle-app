import { FileLine as FileTextIcon, RightSmallLine as ChevronRightIcon } from '@mingcute/react'
import { useState } from 'react'

import { Button } from '~/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '~/components/ui/collapsible'
import { cn } from '~/lib/cn'

import type { ToolPayload } from '../../../rendering/tool-ui-classifier'
import { KeyValueTable, RawValue } from '../tool-call-details'

export interface FileReadSummaryViewProps { output: ToolPayload }

export function FileReadSummaryView({ output }: FileReadSummaryViewProps) {
  const [open, setOpen] = useState(false)
  const file = output.file
  if (!file) { return null }
  if (output.type === 'image') {
    return file.base64 ? <img src={`data:${file.type ?? 'image/png'};base64,${file.base64}`} alt="Tool result preview" className="max-h-64 rounded-md object-contain outline outline-1 outline-black/10 dark:outline-white/10" /> : null
  }
  if (output.type === 'text') {
    const segments = (file.filePath ?? '').split('/')
    const fileName = segments.at(-1) ?? file.filePath ?? 'file'
    const dirPath = segments.length > 1 ? `${segments.slice(0, -1).join('/')}/` : ''
    return (
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <Button type="button" variant="ghost" className={cn('group h-auto w-full min-w-0 justify-start gap-2 px-2 py-1.5', 'rounded-md transition-colors duration-100', 'hover:bg-accent/50 active:bg-accent/70', open && 'rounded-b-none bg-accent/30')}>
            <FileTextIcon className="size-3.5 shrink-0 !text-muted-foreground/50 transition-colors group-hover:!text-muted-foreground/70" aria-hidden />
            <span className="min-w-0 flex-1 truncate text-left font-mono text-[12px] leading-none">
{dirPath && <span className="text-muted-foreground/45">{dirPath}</span>}
<span className="text-foreground/75">{fileName}</span>
            </span>
            <ChevronRightIcon className={cn('size-3 shrink-0 !text-muted-foreground/40', 'transition-transform duration-200', open && 'rotate-90')} aria-hidden />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="overflow-hidden rounded-b-md"><RawValue value={file.content} /></CollapsibleContent>
      </Collapsible>
    )
  }
  return <KeyValueTable rows={[['Type', output.type], ['Path', file.filePath], ['Size', file.originalSize], ['Pages', file.count], ['Output', file.outputDir]]} />
}
