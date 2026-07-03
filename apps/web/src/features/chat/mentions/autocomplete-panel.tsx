import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'

import { Button } from '~/components/ui/button'
import { DelayedSpinner } from '~/components/ui/spinner'
import { cn } from '~/lib/cn'
import type { FuzzyRankField } from '~/lib/fuzzy-rank'
import { rankFuzzyItems } from '~/lib/fuzzy-rank'

export interface AutocompletePanelItem {
  id: string
  searchText: string
}

interface AutocompletePanelProps<TItem extends AutocompletePanelItem> {
  items: TItem[]
  query: string
  searchItems?: (query: string, signal?: AbortSignal) => Promise<TItem[]>
  onSelect: (item: TItem) => void
  onTabComplete?: (item: TItem) => void
  onClose: () => void
  visible: boolean
  maxResults?: number
  emptyLogLabel: string
  sectionLabel?: (item: TItem, previousItem: TItem | null) => string | null
  rankFields?: (item: TItem) => FuzzyRankField[]
  renderItem: (input: {
    item: TItem
    positions: Set<number>
    active: boolean
    index: number
    previousItem: TItem | null
  }) => React.ReactNode
}

export function HighlightedAutocompleteText({ text, positions }: { text: string, positions: Set<number> }) {
  if (positions.size === 0) {
    return <span>{text}</span>
  }

  const parts: React.ReactNode[] = []
  let offset = 0
  while (offset < text.length) {
    if (positions.has(offset)) {
      let end = offset
      while (end < text.length && positions.has(end)) {
        end++
      }
      parts.push(
        <span key={`hl-${offset}`} className="font-bold text-primary">
          {text.slice(offset, end)}
        </span>,
      )
      offset = end
    }
    else {
      let end = offset
      while (end < text.length && !positions.has(end)) {
        end++
      }
      parts.push(<span key={`t-${offset}`}>{text.slice(offset, end)}</span>)
      offset = end
    }
  }
  return <>{parts}</>
}

export function AutocompletePanel<TItem extends AutocompletePanelItem>({
  items,
  query,
  searchItems,
  onSelect,
  onTabComplete,
  onClose,
  visible,
  maxResults = 30,
  emptyLogLabel,
  sectionLabel,
  rankFields,
  renderItem,
}: AutocompletePanelProps<TItem>) {
  const [selection, setSelection] = useState({ activeIndex: 0, query, visible })
  const [remoteItems, setRemoteItems] = useState<TItem[]>([])
  const [remoteLoading, setRemoteLoading] = useState(false)
  const listRef = useRef<HTMLMenuElement>(null)
  const requestSeqRef = useRef(0)
  const abortControllerRef = useRef<AbortController | null>(null)
  const effectiveItems = searchItems ? remoteItems : items

  const results = useMemo(() => {
    if (!query) {
      return effectiveItems.slice(0, maxResults).map(item => ({ item, positions: new Set<number>() }))
    }
    return rankFuzzyItems(effectiveItems, query, {
      fields: item => rankFields?.(item) ?? [{ value: item.searchText, role: 'primary' }],
      searchText: item => item.searchText,
      limit: maxResults,
    })
  }, [effectiveItems, maxResults, query, rankFields])

  const effectiveActiveIndex
    = results.length === 0
      ? 0
      : Math.min(selection.query === query && selection.visible === visible ? selection.activeIndex : 0, results.length - 1)

  useEffect(() => {
    if (!visible || !searchItems) {
      abortControllerRef.current?.abort()
      abortControllerRef.current = null
      setRemoteItems(current => current.length === 0 ? current : [])
      setRemoteLoading(false)
      return
    }

    const requestSeq = requestSeqRef.current + 1
    requestSeqRef.current = requestSeq
    abortControllerRef.current?.abort()
    const abortController = new AbortController()
    abortControllerRef.current = abortController
    setRemoteLoading(true)
    const timeoutId = window.setTimeout(() => {
      void (async () => {
        try {
          const nextItems = await searchItems(query, abortController.signal)
          if (requestSeqRef.current === requestSeq) {
            setRemoteItems(nextItems)
          }
        }
        catch (error) {
          if (requestSeqRef.current === requestSeq && !abortController.signal.aborted) {
            console.error(`[AutocompletePanel] failed to search ${emptyLogLabel}:`, error)
            setRemoteItems([])
          }
        }
        finally {
          if (requestSeqRef.current === requestSeq) {
            setRemoteLoading(false)
          }
        }
      })()
    }, 80)

    return () => {
      window.clearTimeout(timeoutId)
      abortController.abort()
    }
  }, [emptyLogLabel, query, searchItems, visible])

  useEffect(() => {
    const list = listRef.current
    if (!list) {
      return
    }
    const active = list.children[effectiveActiveIndex] as HTMLElement | undefined
    active?.scrollIntoView({ block: 'nearest' })
  }, [effectiveActiveIndex])

  const handleDocumentKeyDown = useEffectEvent((e: KeyboardEvent) => {
    if (!visible) {
      return
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelection({
        activeIndex: (effectiveActiveIndex + 1) % Math.max(results.length, 1),
        query,
        visible,
      })
    }
    else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelection({
        activeIndex: (effectiveActiveIndex - 1 + results.length) % Math.max(results.length, 1),
        query,
        visible,
      })
    }
    else if (
      ((e.key === 'Tab' && !e.shiftKey) || e.key === 'Enter')
      && results[effectiveActiveIndex]
    ) {
      e.preventDefault()
      setSelection({ activeIndex: 0, query, visible })
      if (onTabComplete) {
        onTabComplete(results[effectiveActiveIndex].item)
      }
      else {
        onSelect(results[effectiveActiveIndex].item)
      }
    }
    else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  })

  useEffect(() => {
    document.addEventListener('keydown', handleDocumentKeyDown, true)
    return () => document.removeEventListener('keydown', handleDocumentKeyDown, true)
  }, [])

  const handleOptionClick = (item: TItem) => {
    onSelect(item)
  }

  if (!visible || (results.length === 0 && !remoteLoading)) {
    return null
  }

  return (
    <div className="absolute bottom-full left-0 right-0 z-10 mb-1.5 max-h-64 overflow-hidden rounded-xl border border-border bg-popover/95 shadow-xs backdrop-blur-md">
      <menu
        ref={listRef}
        className="m-0 max-h-64 list-none overflow-y-auto p-1"
      >
        {remoteLoading && results.length === 0 && (
          <div className="flex h-9 items-center justify-center">
            <DelayedSpinner active delayMs={180} className="size-3.5 text-muted-foreground" />
          </div>
        )}
        {results.map(({ item, positions }, idx) => {
          const previousItem = results[idx - 1]?.item ?? null
          const header = sectionLabel?.(item, previousItem)
          return (
            <li key={item.id}>
              {header && (
                <div className="px-2.5 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground first:pt-1">
                  {header}
                </div>
              )}
              <Button
                type="button"
                data-active={idx === effectiveActiveIndex}
                variant="ghost"
                className={cn(
                  'h-auto w-full justify-start gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-xs whitespace-normal',
                  idx === effectiveActiveIndex
                    ? 'bg-accent text-accent-foreground'
                    : 'text-foreground/80 hover:bg-accent/40',
                )}
                onMouseEnter={() => setSelection({ activeIndex: idx, query, visible })}
                onMouseDown={event => event.preventDefault()}
                onClick={() => handleOptionClick(item)}
              >
                {renderItem({
                  item,
                  positions,
                  active: idx === effectiveActiveIndex,
                  index: idx,
                  previousItem,
                })}
              </Button>
            </li>
          )
        })}
      </menu>
    </div>
  )
}
