// "What's New" dialog: seeded mesh-gradient hero + markdown release notes.
// Past versions are browsable via a small history popover on the hero's left.
import { StaticRender } from '@cradle/streamdown'
import { HistoryLine as HistoryIcon } from '@mingcute/react'
import { useTranslation } from 'react-i18next'

import { Button } from '~/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '~/components/ui/dialog'
import { Popover, PopoverContent, PopoverTrigger } from '~/components/ui/popover'
import { DelayedSpinner } from '~/components/ui/spinner'
import { cn } from '~/lib/cn'

import type { ChangelogEntry } from './use-changelog'
import { resolveLocalizedText } from './use-changelog'
import { WhatsNewHero } from './whats-new-hero'

const MARKDOWN_BODY_CLASSES = cn(
  'text-sm',
  '[&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:text-sm [&_h2]:font-semibold [&_h2]:text-foreground',
  '[&_h3]:mt-3 [&_h3]:mb-1.5 [&_h3]:text-[13px] [&_h3]:font-medium [&_h3]:text-foreground',
  '[&_p]:my-1.5 [&_p]:text-foreground/90',
  '[&_ul]:my-1.5 [&_ul]:list-disc [&_ul]:pl-5',
  '[&_ol]:my-1.5 [&_ol]:list-decimal [&_ol]:pl-5',
  '[&_li]:my-0.5 [&_li]:text-foreground/90',
  '[&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_blockquote]:italic',
  '[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[12px] [&_code]:font-mono',
)

interface WhatsNewDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  entries: ChangelogEntry[]
  selectedVersion: string | null
  onSelectVersion: (version: string) => void
  markdown: string | undefined
}

export function WhatsNewDialog({
  open,
  onOpenChange,
  entries,
  selectedVersion,
  onSelectVersion,
  markdown,
}: WhatsNewDialogProps) {
  const { t } = useTranslation('chrome')

  const entry = entries.find(e => e.version === selectedVersion) ?? entries[0]
  // Strip the leading frontmatter if present (should already be stripped by fetch)
  const body = markdown?.replace(/^---\n[\s\S]*?\n---\n?/, '').trim()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          'overflow-hidden sm:max-w-xl',
          // The close button floats over the dark hero artwork.
          '[&_[data-slot=dialog-close]]:text-white/80 [&_[data-slot=dialog-close]]:hover:bg-white/15 [&_[data-slot=dialog-close]]:hover:text-white',
        )}
        showCloseButton
      >
        <div className="relative -mx-4 -mt-4">
          <WhatsNewHero version={entry.version}>
            <div className="flex flex-row gap-0.5 justify-between items-end">
              <div>
              <DialogTitle className="text-xl leading-snug font-semibold text-balance text-white">
                {resolveLocalizedText(entry?.title, t('whatsNew.eyebrow'))}
              </DialogTitle>
              <DialogDescription className="font-mono text-[11px] text-white/60 tabular-nums">
                {entry.version}
                {entry.date && ` · ${entry.date}`}
              </DialogDescription>
              </div>

              {/* icon png */}
              <img src="/icon.png" alt="Cradle icon" className="h-8 w-8 opacity-70 mix-blend-lighten" />
            </div>
          </WhatsNewHero>

          {/* History: a small chip on the hero's left edge that pops the version list */}
          {entries.length > 1 && (
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('whatsNew.history')}
                  className="absolute top-3 left-3 text-white/80 hover:bg-white/15 hover:text-white"
                >
                  <HistoryIcon aria-hidden="true" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-56 p-1.5">
                <div className="max-h-[min(50vh,22rem)] overflow-y-auto">
                  <div className="flex flex-col gap-0.5">
                    {entries.map(e => (
                      <button
                        key={e.version}
                        type="button"
                        onClick={() => onSelectVersion(e.version)}
                        className={cn(
                          'flex flex-col gap-0.5 rounded-md px-2 py-1.5 text-left transition-colors',
                          e.version === entry.version
                            ? 'bg-accent text-accent-foreground'
                            : 'hover:bg-accent/50 hover:text-foreground',
                        )}
                      >
                        <span className="truncate font-mono text-xs text-foreground">
                          {e.version}
                        </span>
                        <span className="text-[11px] text-muted-foreground tabular-nums">
                          {e.date}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-4 max-h-[50vh] overflow-hidden">
          <div className={cn('max-h-[60vh] overflow-y-auto', MARKDOWN_BODY_CLASSES)}>
            {body
              ? <StaticRender content={body} />
              : (
                <div className="flex h-32 items-center justify-center">
                  <DelayedSpinner active />
                </div>
              )}
          </div>

          {/* <DialogFooter variant="bare">
            <Button
              type="button"
              size="sm"
              onClick={() => onOpenChange(false)}
            >
              {t('whatsNew.dismiss')}
            </Button>
          </DialogFooter> */}
        </div>
      </DialogContent>
    </Dialog>
  )
}
