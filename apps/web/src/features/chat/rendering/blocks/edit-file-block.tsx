import {
  Columns2Line as Columns2Icon,
  FileLine as FilePenLineIcon,
  RightSmallLine as ChevronRightIcon,
  Rows3Line as Rows3Icon,
} from '@mingcute/react'
import type { FileContents, MultiFileDiffProps } from '@pierre/diffs/react'
import { MultiFileDiff } from '@pierre/diffs/react'
import { m } from 'motion/react'
import { useState } from 'react'

import { Button } from '~/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '~/components/ui/collapsible'
import { ToggleGroup, ToggleGroupItem } from '~/components/ui/toggle-group'
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

type DiffLayout = 'split' | 'stacked'
type DiffsDiffStyle = 'split' | 'unified'
type DiffOptions = NonNullable<MultiFileDiffProps<undefined>['options']>

const layoutDiffStyles: Record<DiffLayout, DiffsDiffStyle> = {
  split: 'split',
  stacked: 'unified',
}

const DIFF_THEMES = {
  dark: 'pierre-dark',
  light: 'pierre-light',
} as const

function diffCacheKey(prefix: string, filePath: string, content: string): string {
  return `${prefix}:${filePath}:${content.length}:${content.slice(0, 64)}:${content.slice(-64)}`
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
  oldFile,
  newFile,
  diffOptions,
  layout,
  showFilePath,
  onLayoutChange,
}: {
  filePath: string
  oldFile: FileContents
  newFile: FileContents
  diffOptions: DiffOptions
  layout: DiffLayout
  showFilePath: boolean
  onLayoutChange: (layout: DiffLayout) => void
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
        <ToggleGroup
          type="single"
          value={layout}
          onValueChange={(v) => {
            if (v === 'split' || v === 'stacked') {
              onLayoutChange(v)
            }
          }}
          variant="outline"
          size="sm"
          className="h-5 shrink-0 gap-px"
          aria-label="Diff layout"
        >
          <ToggleGroupItem value="split" aria-label="Split" className="h-5 gap-1 px-1.5 text-[10px]">
            <Columns2Icon className="size-2.5" />
            Split
          </ToggleGroupItem>
          <ToggleGroupItem value="stacked" aria-label="Stacked" className="h-5 gap-1 px-1.5 text-[10px]">
            <Rows3Icon className="size-2.5" />
            Stacked
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      <MultiFileDiff
        oldFile={oldFile}
        newFile={newFile}
        options={diffOptions}
        className="max-h-128 overflow-auto [--diffs-font-size:11px] [--diffs-line-height:18px]"
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
  const [layout, setLayout] = useState<DiffLayout>('split')

  const stats = computeChangeStats(oldContent, newContent)

  const segments = filePath.split('/')
  const fileName = segments.at(-1) ?? filePath
  const dirPath = segments.length > 1 ? `${segments.slice(0, -1).join('/')}/` : ''

  const oldFile: FileContents = {
    name: filePath,
    contents: oldContent,
    cacheKey: diffCacheKey('old', filePath, oldContent),
  }

  const newFile: FileContents = {
    name: filePath,
    contents: newContent,
    cacheKey: diffCacheKey('new', filePath, newContent),
  }

  const diffOptions: DiffOptions = {
    theme: DIFF_THEMES,
    themeType: 'system',
    diffStyle: layoutDiffStyles[layout],
    disableFileHeader: true,
    disableBackground: false,
    diffIndicators: 'bars',
    hunkSeparators: 'line-info-basic',
    lineDiffType: 'word' as const,
    overflow: 'scroll' as const,
    parseDiffOptions: { context: 3 },
  }

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
          oldFile={oldFile}
          newFile={newFile}
          diffOptions={diffOptions}
          layout={layout}
          showFilePath
          onLayoutChange={setLayout}
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
              oldFile={oldFile}
              newFile={newFile}
              diffOptions={diffOptions}
              layout={layout}
              showFilePath={false}
              onLayoutChange={setLayout}
            />
          </CollapsibleContent>
        )}
      </Collapsible>
    </m.div>
  )
}
