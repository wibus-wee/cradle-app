// Input: window keydown events, acp-devtool stores (selection / paused / clear), filtered events
// Output: useAcpKeyboard hook wiring arrow-key row navigation plus pause/clear/search shortcuts
// Position: Called once from IpcDevtoolPage — owns the ACP pane's global keybindings

import { useEffect } from 'react'

import { useAcpDevtoolStore, useAcpFilteredEvents } from './use-acp-events'

const SEARCH_INPUT_ATTR = 'data-acp-devtool-search'
const ROW_ID_ATTR = 'data-acp-event-id'

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false
  }
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable
}

function focusSearch(): void {
  const el = document.querySelector<HTMLInputElement>(`input[${SEARCH_INPUT_ATTR}]`)
  el?.focus()
  el?.select()
}

function scrollRowIntoView(eventId: string): void {
  requestAnimationFrame(() => {
    const row = document.querySelector<HTMLElement>(`[${ROW_ID_ATTR}="${CSS.escape(eventId)}"]`)
    row?.scrollIntoView({ block: 'nearest' })
  })
}

const NAV_KEYS = new Set(['ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'])
const PAGE_STEP = 10

export function useAcpKeyboard(enabled = true): void {
  const events = useAcpFilteredEvents()
  const selectedEventId = useAcpDevtoolStore(s => s.selectedEventId)
  const selectEvent = useAcpDevtoolStore(s => s.selectEvent)
  const paused = useAcpDevtoolStore(s => s.paused)
  const setPaused = useAcpDevtoolStore(s => s.setPaused)
  const clear = useAcpDevtoolStore(s => s.clear)

  useEffect(() => {
    if (!enabled) {
      return
    }

    const onKey = (event: KeyboardEvent): void => {
      const editable = isEditableTarget(event.target)
      const mod = event.metaKey || event.ctrlKey

      if (event.key === '/' && !editable && !mod && !event.shiftKey && !event.altKey) {
        event.preventDefault()
        focusSearch()
        return
      }

      if (mod && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        focusSearch()
        return
      }

      if (mod && (event.key.toLowerCase() === 'k' || event.key.toLowerCase() === 'l')) {
        event.preventDefault()
        clear()
        return
      }

      if (event.key === 'Escape') {
        if (editable && event.target instanceof HTMLElement) {
          event.target.blur()
          return
        }
        if (selectedEventId !== null) {
          selectEvent(null)
        }
        return
      }

      if (event.key === ' ' && !editable && !mod) {
        event.preventDefault()
        setPaused(!paused)
        return
      }

      if (!editable && !mod && NAV_KEYS.has(event.key)) {
        if (events.length === 0) {
          return
        }
        event.preventDefault()

        const currentIndex = selectedEventId
          ? events.findIndex(e => e.id === selectedEventId)
          : -1

        let nextIndex: number

        if (currentIndex < 0) {
          nextIndex = event.key === 'End' ? events.length - 1 : 0
        }
        else {
          switch (event.key) {
            case 'ArrowUp':
              nextIndex = Math.max(0, currentIndex - 1)
              break
            case 'ArrowDown':
              nextIndex = Math.min(events.length - 1, currentIndex + 1)
              break
            case 'PageUp':
              nextIndex = Math.max(0, currentIndex - PAGE_STEP)
              break
            case 'PageDown':
              nextIndex = Math.min(events.length - 1, currentIndex + PAGE_STEP)
              break
            case 'Home':
              nextIndex = 0
              break
            case 'End':
              nextIndex = events.length - 1
              break
            default:
              nextIndex = currentIndex
          }
        }

        const next = events[nextIndex]
        if (next && next.id !== selectedEventId) {
          selectEvent(next.id)
        }
        if (next) {
          scrollRowIntoView(next.id)
        }
      }
    }

    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
    }
  }, [enabled, events, selectedEventId, selectEvent, paused, setPaused, clear])
}
