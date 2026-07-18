import {
  FileLine as FilePenLineIcon,
  RightSmallLine as ChevronRightIcon,
} from '@mingcute/react'
import { m } from 'motion/react'
import { useState } from 'react'

import { DiffLayoutToggle } from '~/components/common/diff/diff-layout-toggle'
import type { DiffStyle } from '~/components/common/diff/diff-options'
import { FileContentsDiffView } from '~/components/common/diff/file-contents-diff-view'
import { Button } from '~/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '~/components/ui/collapsible'
import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip'
import { cn } from '~/lib/cn'

interface EditFileBlockProps {
  filePath: string
  oldContent: string
  newContent: string
  /** Detail mode is already owned by the surrounding tool row. @default 'preview' */
  presentation?: 'preview' | 'detail'
  /** Whether the diff viewer is open initially. @default false */
  defaultOpen?: boolean
}

/** Line-level change stats, approximate for visual indicator only. */
function computeChangeStats(oldContent: string, newContent: string) {
  const oldLines = oldContent.split('\n').filter(l => l.trim())
  const newLines = newContent.split('\n').filter(l => l.trim())
  const oldSet = new Set(oldLines)
  const newSet = new Set(newLines)
  return {
    added: newLines.filter(l => !oldSet.has(l)).length,
    removed: oldLines.filter(l => !newSet.has(l)).length,
  }
}

function EditFileDiffPane({
  filePath,
  oldContent,
  newContent,
  diffStyle,
  showFilePath,
  onDiffStyleChange,
}: {
  filePath: string
  oldContent: string
  newContent: string
  diffStyle: DiffStyle
  showFilePath: boolean
  onDiffStyleChange: (diffStyle: DiffStyle) => void
}) {
  return (
    <>
      <div
        className={cn(
          'flex items-center bg-muted/30 px-2 py-1',
          showFilePath ? 'justify-between' : 'justify-end',
        )}
      >
        {showFilePath && (
          <span className="truncate font-mono text-[10px] text-muted-foreground/40" title={filePath}>
            {filePath}
          </span>
        )}
        <DiffLayoutToggle value={diffStyle} onValueChange={onDiffStyleChange} />
      </div>

      <FileContentsDiffView
        filePath={filePath}
        oldContent={oldContent}
        newContent={newContent}
        diffStyle={diffStyle}
      />
    </>
  )
}

export function EditFileBlock({
  filePath,
  oldContent,
  newContent,
  presentation = 'preview',
  defaultOpen = false,
}: EditFileBlockProps) {
  const [open, setOpen] = useState(defaultOpen)
  const [diffStyle, setDiffStyle] = useState<DiffStyle>('split')

  const stats = computeChangeStats(oldContent, newContent)

  const segments = filePath.split('/')
  const fileName = segments.at(-1) ?? filePath
  const dirPath = segments.length > 1 ? `${segments.slice(0, -1).join('/')}/` : ''

  if (presentation === 'detail') {
    return (
      <m.div
        initial={{ opacity: 0, y: 3 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.18, ease: [0.25, 0.1, 0.25, 1] }}
        data-testid="chat-edit-file-block"
        className="overflow-hidden rounded-md border border-border/60 bg-background/60"
      >
        <EditFileDiffPane
          filePath={filePath}
          oldContent={oldContent}
          newContent={newContent}
          diffStyle={diffStyle}
          showFilePath
          onDiffStyleChange={setDiffStyle}
        />
      </m.div>
    )
  }

  return (
    <m.div
      initial={{ opacity: 0, y: 3 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: [0.25, 0.1, 0.25, 1] }}
      data-testid="chat-edit-file-block"
      className="overflow-hidden rounded-md"
    >
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            className={cn(
              'group h-auto w-full min-w-0 justify-start gap-2 px-2 py-1.5',
              'transition-colors duration-100',
              'hover:bg-accent/50 active:bg-accent/70',
              open ? 'rounded-t-md bg-accent/30' : 'rounded-md',
            )}
          >
            <FilePenLineIcon
              className="size-3.5 shrink-0 !text-muted-foreground/50 transition-colors group-hover:!text-muted-foreground/70"
              aria-hidden
            />

            <Tooltip>
              <TooltipTrigger asChild>
                <span className="min-w-0 flex-1 truncate text-left font-mono text-[12px] leading-none">
                  {dirPath && <span className="text-muted-foreground/45">{dirPath}</span>}
                  <span className="text-foreground/75">{fileName}</span>
                </span>
              </TooltipTrigger>
              <TooltipContent side="top" className="font-mono text-[11px]">
                {filePath}
              </TooltipContent>
            </Tooltip>

            {(stats.added > 0 || stats.removed > 0) && (
              <span className="flex shrink-0 items-center gap-1.5 font-mono text-[11px] tabular-nums">
                {stats.added > 0 && (
                  <span className="text-emerald-500 dark:text-emerald-400">
+
{stats.added}
                  </span>
                )}
                {stats.removed > 0 && (
                  <span className="text-red-400 dark:text-red-400">
-
{stats.removed}
                  </span>
                )}
              </span>
            )}

            <ChevronRightIcon
              className={cn(
                'size-3 shrink-0 !text-muted-foreground/40',
                'transition-transform duration-200',
                open && 'rotate-90',
              )}
              aria-hidden
            />
          </Button>
        </CollapsibleTrigger>

        {open && (
          <CollapsibleContent className="overflow-hidden rounded-b-md">
            <EditFileDiffPane
              filePath={filePath}
              oldContent={oldContent}
              newContent={newContent}
              diffStyle={diffStyle}
              showFilePath={false}
              onDiffStyleChange={setDiffStyle}
            />
          </CollapsibleContent>
        )}
      </Collapsible>
    </m.div>
  )
}
