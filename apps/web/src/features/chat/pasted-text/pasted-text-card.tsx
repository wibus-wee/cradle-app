import {
  ArrowLeftLine as RestoreIcon,
  CheckLine as CheckIcon,
  ClipboardLine as ClipboardIcon,
  CloseLine as XIcon,
  CopyLine as CopyIcon,
} from '@mingcute/react'
import { AnimatePresence, m } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '~/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '~/components/ui/popover'
import { cn } from '~/lib/cn'

import type { ComposerPastedText } from './pasted-text'
import { readPastedTextTitle } from './pasted-text'

function useCopyToClipboard() {
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current)
      }
    }
  }, [])

  const copy = async (text: string) => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
    }
    timerRef.current = window.setTimeout(() => {
      setCopied(false)
      timerRef.current = null
    }, 1500)
  }

  return { copied, copy }
}

const iconTransition = { type: 'spring' as const, duration: 0.3, bounce: 0 }
const iconVariants = {
  initial: { opacity: 0, scale: 0.25, filter: 'blur(4px)' },
  animate: { opacity: 1, scale: 1, filter: 'blur(0px)' },
  exit: { opacity: 0, scale: 0.25, filter: 'blur(4px)' },
}

function PastedTextMeta({ pastedText }: { pastedText: ComposerPastedText }) {
  const { t } = useTranslation('chat')
  return (
    <span className="flex items-center gap-1 text-[11px] text-muted-foreground/70 tabular-nums">
      <span>{t('pastedText.lines', { count: pastedText.lineCount })}</span>
      <span aria-hidden="true" className="text-muted-foreground/30">·</span>
      <span>{t('pastedText.chars', { count: pastedText.charCount })}</span>
    </span>
  )
}

function PastedTextSummary({ pastedText }: { pastedText: ComposerPastedText }) {
  const { t } = useTranslation('chat')
  const title = readPastedTextTitle(pastedText.text) ?? t('pastedText.label')

  return (
    <span className="flex min-w-0 flex-1 items-center gap-2">
      <ClipboardIcon className="size-3.5 shrink-0 text-muted-foreground/60" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium leading-tight text-foreground/90">{title}</span>
        <span className="mt-0.5 block">
          <PastedTextMeta pastedText={pastedText} />
        </span>
      </span>
    </span>
  )
}

function PastedTextPreviewHeader({ pastedText }: { pastedText: ComposerPastedText }) {
  const { t } = useTranslation('chat')
  const title = readPastedTextTitle(pastedText.text) ?? t('pastedText.label')

  return (
    <div className="flex items-center gap-1.5 px-0.5">
      <ClipboardIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">{title}</span>
      <PastedTextMeta pastedText={pastedText} />
    </div>
  )
}

function PastedTextPreviewBody({ pastedText }: { pastedText: ComposerPastedText }) {
  const { t } = useTranslation('chat')
  const lineCount = pastedText.lineCount

  return (
    <div
      className={cn(
        'max-h-56 overflow-auto rounded-lg bg-muted/30 ring-1 ring-inset ring-border/30',
        '[mask-image:linear-gradient(to_bottom,black_0,black_calc(100%-28px),transparent_100%)]',
      )}
    >
      <div className="flex min-w-max">
        {lineCount > 0 && (
          <div
            aria-hidden="true"
            className="sticky left-0 z-10 select-none border-r border-border/30 bg-muted/60 px-2.5 py-3 text-right font-mono text-[10.5px] leading-5 text-muted-foreground/40 tabular-nums"
          >
            {Array.from({ length: lineCount }, (_, index) => (
              <div key={index}>{index + 1}</div>
            ))}
          </div>
        )}
        <pre
          aria-label={t('pastedText.preview')}
          className="min-w-0 flex-1 whitespace-pre-wrap break-words px-3 py-3 font-mono text-[11px] leading-5 text-foreground"
        >
          {pastedText.text}
        </pre>
      </div>
    </div>
  )
}

function CopyButton({ text }: { text: string }) {
  const { t } = useTranslation('chat')
  const { copied, copy } = useCopyToClipboard()

  return (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      onClick={() => void copy(text)}
      aria-label={t('pastedText.copy')}
      className="gap-1.5 text-muted-foreground hover:text-foreground"
    >
      <AnimatePresence initial={false} mode="popLayout">
        {copied
          ? (
              <m.span key="check" {...iconVariants} transition={iconTransition}>
                <CheckIcon className="size-3.5 text-emerald-500" aria-hidden="true" />
              </m.span>
            )
          : (
              <m.span key="copy" {...iconVariants} transition={iconTransition}>
                <CopyIcon className="size-3.5" aria-hidden="true" />
              </m.span>
            )}
      </AnimatePresence>
      <span>{copied ? t('pastedText.copied') : t('pastedText.copy')}</span>
    </Button>
  )
}

function PastedTextPreviewPopover({
  pastedText,
  open,
  onOpenChange,
  triggerClassName,
}: {
  pastedText: ComposerPastedText
  open: boolean
  onOpenChange: (open: boolean) => void
  triggerClassName?: string
}) {
  const { t } = useTranslation('chat')

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger
        render={(
          <Button
            type="button"
            variant="ghost"
            aria-label={open ? t('pastedText.collapse') : t('pastedText.preview')}
            aria-pressed={open}
            className={cn(
              'h-auto min-w-0 flex-1 gap-2 rounded-lg px-1 py-1 hover:bg-black/[0.04] dark:hover:bg-white/[0.04]',
              triggerClassName,
            )}
          >
            <PastedTextSummary pastedText={pastedText} />
          </Button>
        )}
      />
      <PopoverContent
        side="top"
        align="start"
        sideOffset={8}
        collisionPadding={8}
        className="max-h-[60vh] w-80 gap-2 p-3"
      >
        <PastedTextPreviewHeader pastedText={pastedText} />
        <PastedTextPreviewBody pastedText={pastedText} />
        <div className="flex items-center justify-end">
          <CopyButton text={pastedText.text} />
        </div>
      </PopoverContent>
    </Popover>
  )
}

const cardEntrance = {
  initial: { opacity: 0, scale: 0.97, y: 4, filter: 'blur(2px)' },
  animate: { opacity: 1, scale: 1, y: 0, filter: 'blur(0px)' },
  exit: {
    opacity: 0,
    scale: 0.97,
    y: -4,
    filter: 'blur(2px)',
    transition: { duration: 0.15, ease: 'easeIn' as const },
  },
  transition: { type: 'spring' as const, stiffness: 600, damping: 40 },
}

export function ComposerPastedTextCard({
  pastedText,
  onRemove,
  onRestore,
}: {
  pastedText: ComposerPastedText
  onRemove: () => void
  onRestore: () => void
}) {
  const { t } = useTranslation('chat')
  const [open, setOpen] = useState(false)

  return (
    <m.div
      layout
      {...cardEntrance}
      className="flex max-w-72 items-center gap-0 rounded-xl bg-muted/60 py-1 pl-2 pr-1 dark:bg-muted/40 ring-1 ring-inset ring-border/30"
      data-testid="composer-pasted-text-card"
    >
      <PastedTextPreviewPopover
        pastedText={pastedText}
        open={open}
        onOpenChange={setOpen}
      />

      <div className="flex items-center">
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={onRestore}
          aria-label={t('pastedText.restore')}
          className="text-muted-foreground hover:text-foreground"
        >
          <RestoreIcon className="size-3.5" aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={onRemove}
          aria-label={t('pastedText.remove')}
          className="text-muted-foreground hover:text-destructive"
        >
          <XIcon className="size-3.5" aria-hidden="true" />
        </Button>
      </div>
    </m.div>
  )
}

export function HistoryPastedTextCard({ pastedText }: { pastedText: ComposerPastedText }) {
  const [open, setOpen] = useState(false)

  return (
    <m.div
      layout
      {...cardEntrance}
      className="mt-2 flex max-w-72 items-center gap-0 rounded-xl bg-muted/60 py-1 pl-2 pr-1 dark:bg-muted/40 ring-1 ring-inset ring-border/30"
      data-testid="history-pasted-text-card"
    >
      <PastedTextPreviewPopover
        pastedText={pastedText}
        open={open}
        onOpenChange={setOpen}
      />
    </m.div>
  )
}
