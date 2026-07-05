// Input: window keydown events, ipc-devtool stores (selection / paused / clear), filtered traces
// Output: useIpcKeyboard hook wiring arrow-key row navigation plus pause/clear/search shortcuts
// Position: Called once from IpcDevtoolPage — owns the devtool window's global keybindings

import { useEffect } from 'react'

import { useIpcDevtoolStore, useIpcFilteredTraces } from './use-ipc-events'

const SEARCH_INPUT_ATTR = 'data-ipc-devtool-search'
const ROW_ID_ATTR = 'data-ipc-trace-id'

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) { return false }
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable
}

function focusSearch(): void {
  const el = document.querySelector<HTMLInputElement>(`input[${SEARCH_INPUT_ATTR}]`)
  el?.focus()
  el?.select()
}

function scrollRowIntoView(traceId: string): void {
  requestAnimationFrame(() => {
    const row = document.querySelector<HTMLElement>(`[${ROW_ID_ATTR}="${CSS.escape(traceId)}"]`)
    row?.scrollIntoView({ block: 'nearest' })
  })
}

const NAV_KEYS = new Set(['ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'])
const PAGE_STEP = 10

export function useIpcKeyboard(enabled = true): void {
  const traces = useIpcFilteredTraces()
  const selectedTraceId = useIpcDevtoolStore(s => s.selectedTraceId)
  const selectTrace = useIpcDevtoolStore(s => s.selectTrace)
  const paused = useIpcDevtoolStore(s => s.paused)
  const setPaused = useIpcDevtoolStore(s => s.setPaused)
  const clear = useIpcDevtoolStore(s => s.clear)
  const cycleDetailTab = useIpcDevtoolStore(s => s.cycleDetailTab)

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
        if (selectedTraceId !== null) {
          selectTrace(null)
        }
        return
      }

      if (event.key === ' ' && !editable && !mod) {
        event.preventDefault()
        setPaused(!paused)
        return
      }

      if (!editable && !mod && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
        if (selectedTraceId === null) { return }
        event.preventDefault()
        cycleDetailTab(event.key === 'ArrowRight' ? 1 : -1)
        return
      }

      if (!editable && NAV_KEYS.has(event.key)) {
        if (traces.length === 0) { return }
        event.preventDefault()

        const currentIndex = selectedTraceId
          ? traces.findIndex(t => t.traceId === selectedTraceId)
          : -1

        let nextIndex: number

        if (currentIndex < 0) {
          nextIndex = event.key === 'End' ? traces.length - 1 : 0
        }
        else {
          switch (event.key) {
            case 'ArrowUp':
              nextIndex = Math.max(0, currentIndex - 1)
              break
            case 'ArrowDown':
              nextIndex = Math.min(traces.length - 1, currentIndex + 1)
              break
            case 'PageUp':
              nextIndex = Math.max(0, currentIndex - PAGE_STEP)
              break
            case 'PageDown':
              nextIndex = Math.min(traces.length - 1, currentIndex + PAGE_STEP)
              break
            case 'Home':
              nextIndex = 0
              break
            case 'End':
              nextIndex = traces.length - 1
              break
            default:
              nextIndex = currentIndex
          }
        }

        const next = traces[nextIndex]
        if (next && next.traceId !== selectedTraceId) {
          selectTrace(next.traceId)
        }
        if (next) {
          scrollRowIntoView(next.traceId)
        }
      }
    }

    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
    }
  }, [enabled, traces, selectedTraceId, selectTrace, paused, setPaused, clear, cycleDetailTab])
}
