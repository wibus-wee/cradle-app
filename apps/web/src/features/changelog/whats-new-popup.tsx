// Timed corner popup for release announcements (frontmatter `announce: true`)
// and predefined feature tips. A mini version of the What's New dialog:
// seeded mesh-gradient hero on top, description and actions below. The card
// stays until dismissed. One card at a time — announcements win over tips.
import { StaticRender } from '@cradle/streamdown'
import { BulbLine as BulbIcon, CloseLine as XIcon, SparklesLine as SparklesIcon } from '@mingcute/react'
import { MeshGradient } from '@paper-design/shaders-react'
import { useRouter } from '@tanstack/react-router'
import { AnimatePresence, m } from 'motion/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '~/components/ui/button'
import { cn } from '~/lib/cn'
import { nativeIpc } from '~/lib/electron'

import type { ChangelogEntry } from './use-changelog'
import { resolveLocalizedText } from './use-changelog'
import type { FeatureTip } from './use-feature-tips'
import { findPendingTip, useFeatureTips } from './use-feature-tips'
import { releaseLookForVersion } from './whats-new-look'
import {
  usePendingAnnouncement,
  useWhatsNewDialogStore,
  useWhatsNewDismissalStore,
} from './whats-new-store'

const APPEAR_DELAY_MS = 2500

// Same spring family as the sidebar pane drill-in (blur + rise + fade).
const ENTER_SPRING = { type: 'spring', stiffness: 500, damping: 35, mass: 0.8 } as const

// Compact markdown styling for the popup body (links, inline code, emphasis).
// Paragraphs get a 2-character first-line indent (中文排版首行缩进两字符).
const POPUP_MARKDOWN_CLASSES = 'text-[13px] leading-relaxed [&_p]:my-0 [&_p]:text-muted-foreground [&_strong]:font-medium [&_strong]:text-foreground [&_a]:text-info [&_a]:underline [&_a]:underline-offset-2 [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[12px] [&_code]:font-mono [&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-4 [&_li]:my-0.5 [&_li]:text-muted-foreground'

type PopupItem
  = | { kind: 'announcement', key: string, entry: ChangelogEntry }
    | { kind: 'tip', key: string, tip: FeatureTip }

function openExternalLink(url: string): void {
  const openExternal = nativeIpc?.native?.openExternal
  if (openExternal) {
    void openExternal(url)
  }
  else {
    window.open(url, '_blank', 'noopener,noreferrer')
  }
}

export function WhatsNewPopup() {
  const { t } = useTranslation('chrome')
  const router = useRouter()
  const announcement = usePendingAnnouncement()
  const { data: tips } = useFeatureTips()
  const dismissedTips = useWhatsNewDismissalStore(s => s.dismissedTips)
  const dialogOpen = useWhatsNewDialogStore(s => s.open)
  const dismissAnnouncement = useWhatsNewDismissalStore(s => s.dismissAnnouncement)
  const dismissTip = useWhatsNewDismissalStore(s => s.dismissTip)
  const openDialog = useWhatsNewDialogStore(s => s.openDialog)

  // Announcements win; a tip only surfaces when no announcement is pending.
  const item: PopupItem | null = useMemo(() => {
    if (announcement) {
      return { kind: 'announcement', key: `announcement:${announcement.version}`, entry: announcement }
    }
    const tip = findPendingTip(tips, dismissedTips)
    return tip ? { kind: 'tip', key: `tip:${tip.id}`, tip } : null
  }, [announcement, tips, dismissedTips])

  // The hero artwork is seeded by the version (or the tip id), so every card
  // gets its own stable look — same as the dialog hero.
  const look = useMemo(
    () => releaseLookForVersion(item?.kind === 'announcement' ? item.entry.version : (item?.tip.id ?? '')),
    [item],
  )

  const [visible, setVisible] = useState(false)
  const shownForRef = useRef<string | null>(null)

  const dismiss = useCallback(() => {
    if (item?.kind === 'announcement') {
      dismissAnnouncement(item.entry.version)
    }
    else if (item?.kind === 'tip') {
      dismissTip(item.tip.id)
    }
    setVisible(false)
  }, [item, dismissAnnouncement, dismissTip])

  // Show the card once the app has settled (~2.5s), once per item.
  useEffect(() => {
    if (!item || dialogOpen) { return }
    if (shownForRef.current === item.key) { return }
    shownForRef.current = item.key
    const timeoutId = window.setTimeout(setVisible, APPEAR_DELAY_MS, true)
    return () => window.clearTimeout(timeoutId)
  }, [item, dialogOpen])

  // The dialog supersedes the popup — hide the card while it is open.
  useEffect(() => {
    if (dialogOpen) { setVisible(false) }
  }, [dialogOpen])

  const active = visible && item !== null

  // Primary action: announcements open the dialog; tips navigate to their URL.
  const handlePrimary = useCallback(() => {
    if (item?.kind === 'announcement') {
      dismissAnnouncement(item.entry.version)
      openDialog(item.entry.version)
    }
    else if (item?.kind === 'tip') {
      dismissTip(item.tip.id)
      const url = item.tip.url
      if (/^https?:\/\//.test(url)) {
        openExternalLink(url)
      }
      else {
        void router.history.push(url)
      }
    }
    setVisible(false)
  }, [item, dismissAnnouncement, dismissTip, openDialog, router])

  return (
    <AnimatePresence>
      {active && (
        <m.div
          key={item.key}
          className="fixed left-3 bottom-3 z-50 w-80 shadow-lg"
          initial={{ opacity: 0, y: 16, scale: 0.98, filter: 'blur(8px)' }}
          animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
          exit={{ opacity: 0, y: 8, scale: 0.98, filter: 'blur(4px)' }}
          transition={ENTER_SPRING}
          data-testid="whats-new-popup"
          data-popup-kind={item.kind}
        >
          <div className="relative overflow-hidden rounded-xl bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10">
            {/* Seeded mesh-gradient hero — mini version of the dialog header */}
            <div className="relative h-46 overflow-hidden select-none">
              <MeshGradient
                colors={look.colors}
                distortion={look.distortion}
                swirl={look.swirl}
                scale={look.scale}
                rotation={look.rotation}
                offsetX={look.offsetX}
                offsetY={look.offsetY}
                grainOverlay={0.15}
                speed={0.35}
                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
                aria-hidden="true"
              />
              <div
                className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/10 to-transparent"
                aria-hidden="true"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                onClick={dismiss}
                aria-label={t('chromeSheet.action.close')}
                className="absolute top-2 right-2 text-white/80 hover:bg-white/15 hover:text-white"
              >
                <XIcon aria-hidden="true" />
              </Button>
              <div className="absolute inset-x-0 bottom-0 flex flex-col gap-1 p-3.5">
                <span className="flex items-center gap-1.5 text-xs font-medium text-white/70">
                  {item.kind === 'announcement'
                    ? <SparklesIcon className="size-3.5" aria-hidden="true" />
                    : <BulbIcon className="size-3.5" aria-hidden="true" />}
                  {item.kind === 'announcement' ? t('whatsNew.eyebrow') : t('featureTip.eyebrow')}
                  {item.kind === 'announcement' && (
                    <span className="font-mono text-[11px] text-white/50 tabular-nums">
                      {item.entry.version}
                    </span>
                  )}
                </span>
                <span className="text-[15px] leading-snug font-semibold text-balance text-white">
                  {item.kind === 'announcement'
                    ? resolveLocalizedText(item.entry.title, item.entry.version)
                    : resolveLocalizedText(item.tip.title, item.tip.id)}
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-2.5 p-3.5">
              <div className={cn('min-h-12', POPUP_MARKDOWN_CLASSES)}>
                <StaticRender
                  content={item.kind === 'announcement'
                    ? resolveLocalizedText(item.entry.summary)
                    : resolveLocalizedText(item.tip.body)}
                />
              </div>
              <div className="flex justify-end gap-1.5">
                <Button type="button" variant="ghost" size="sm" onClick={dismiss}>
                  {t('whatsNew.later')}
                </Button>
                <Button type="button" size="sm" onClick={handlePrimary}>
                  {item.kind === 'announcement'
                    ? t('whatsNew.seeDetails')
                    : resolveLocalizedText(item.tip.cta, t('featureTip.tryIt'))}
                </Button>
              </div>
            </div>
          </div>
        </m.div>
      )}
    </AnimatePresence>
  )
}
