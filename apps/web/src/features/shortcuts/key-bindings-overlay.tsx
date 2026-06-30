import { AnimatePresence, m } from 'motion/react'
import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'

import { Kbd, KbdGroup } from '~/components/ui/kbd'
import { BUILT_IN_SHORTCUT_GROUPS } from '~/features/shortcuts/built-in-shortcuts'
import { useKeyBindingsOverlayStore } from '~/features/shortcuts/key-bindings-overlay-store'

/**
 * `Cmd+/` key-bindings reference.
 *
 * A transient glass layer (transparent backdrop + `backdrop-blur`) built on
 * Motion + React Portal. It is a *reference card*, not documentation: two
 * scannable columns of action → key-cap rows — one per domain group — reusing
 * the shared `BUILT_IN_SHORTCUT_GROUPS` catalog so it can never drift from the
 * Settings page. There is intentionally no header: the content is the chrome.
 *
 * Interaction model (human-journey first):
 *   - discoverability: `⌘/` works everywhere, including inside the composer;
 *     the binding is itself the first row of the reference, so the overlay
 *     teaches its own escape hatch;
 *   - dismissal is symmetric and unsurprising — `Esc`, backdrop click, a
 *     second `⌘/` tap, or releasing a held `⌘/` all close it;
 *   - the layer never blocks the underlying app's shortcuts, it simply sits
 *     on top as a quick lookup.
 */
export function KeyBindingsOverlay() {
  const open = useKeyBindingsOverlayStore(s => s.open)
  const closeOverlay = useKeyBindingsOverlayStore(s => s.closeOverlay)
  const { t } = useTranslation('settings')

  const panelRef = useRef<HTMLDivElement>(null)

  // Move focus into the layer on open so screen readers announce it and Esc
  // has a predictable target; restore focus implicitly on unmount.
  useEffect(() => {
    if (!open) {
      return
    }
    panelRef.current?.focus()
  }, [open])

  // Esc dismisses. Plain Escape has no modifier conflicts in the shortcut
  // registry (`exit-settings` is `⌘Esc`), so a simple capture listener is
  // enough. `Cmd+/` toggling is owned by the host, not here.
  useEffect(() => {
    if (!open) {
      return
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.isComposing) {
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        closeOverlay()
      }
    }
    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
  }, [open, closeOverlay])

  return createPortal(
    <AnimatePresence>
      {open && (
        <m.div
          key="key-bindings-overlay"
          role="presentation"
          className="fixed inset-0 isolate z-50 flex items-center justify-center p-4"
        >
          {/* ── Glass backdrop: transparent + blur ── */}
          <m.div
            aria-hidden="true"
            className="absolute inset-0"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) {
                closeOverlay()
              }
            }}
          />
          {/* ── Reference panel ── */}
          <m.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label={t('shortcut.overlay.title')}
            tabIndex={-1}
            initial={{ opacity: 0, scale: 0.97, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: 4 }}
            transition={{ type: 'spring', stiffness: 500, damping: 38 }}
            className="relative flex max-h-[82vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-white/20 bg-popover/55 text-popover-foreground shadow-[0_24px_80px_-12px_rgba(0,0,0,0.28),inset_0_1px_0_0_rgba(255,255,255,0.12)] ring-1 ring-foreground/5 backdrop-blur-2xl outline-none dark:border-white/10 dark:bg-popover/40 dark:shadow-[0_24px_80px_-12px_rgba(0,0,0,0.6),inset_0_1px_0_0_rgba(255,255,255,0.06)]"
          >
            <div className="grid min-h-0 flex-1 grid-cols-2 divide-x divide-border/30 overflow-y-auto">
              {BUILT_IN_SHORTCUT_GROUPS.map(group => (
                <section
                  key={group.labelKey}
                  aria-label={t(group.labelKey)}
                  className="min-w-0"
                >
                  <div className="sticky top-0 z-[1] bg-popover/40 px-4 pb-1.5 pt-4 backdrop-blur-xl">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {t(group.labelKey)}
                    </p>
                    <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground/70">
                      {t(group.descriptionKey)}
                    </p>
                  </div>
                  <ul role="list" className="px-2 pb-3">
                    {group.items.map(item => (
                      <li
                        key={item.labelKey}
                        title={t(item.descriptionKey)}
                        className="flex items-center justify-between gap-4 rounded-lg px-2 py-1.5 transition-colors hover:bg-foreground/[0.04]"
                      >
                        <span className="truncate text-[13px] text-foreground/90">
                          {t(item.labelKey)}
                        </span>
                        <KbdGroup className="shrink-0">
                          {item.keys.map(key => (
                            <Kbd key={key}>{key}</Kbd>
                          ))}
                        </KbdGroup>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          </m.div>
        </m.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
