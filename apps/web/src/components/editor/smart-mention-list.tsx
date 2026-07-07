import {
  Box3Line as BoxesIcon,
  FileLine as FileIcon,
  Flag2Line as FlagIcon,
  GitPullRequestLine as GitPullRequestIcon,
  Message1Line as MessageSquareIcon,
  RobotLine as BotIcon,
} from '@mingcute/react'
import { useEffect, useImperativeHandle, useRef, useState } from 'react'

import { cn } from '~/lib/cn'

import type { SmartMentionItem, SmartMentionKind } from './smart-mention-utils'

interface SmartMentionListRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean
}

interface SmartMentionListProps {
  items: SmartMentionItem[]
  command: (item: SmartMentionItem) => void
}

interface IndexedSmartMentionItem {
  item: SmartMentionItem
  index: number
}

interface GroupedSmartMentionItems {
  groups: Array<{ kind: SmartMentionKind, items: IndexedSmartMentionItem[] }>
  orderedItems: SmartMentionItem[]
}

const KIND_ORDER: SmartMentionKind[] = ['issue', 'session', 'workspace', 'agent', 'milestone', 'file']

const KIND_LABEL: Record<SmartMentionKind, string> = {
  issue: 'Issue',
  session: 'Session',
  workspace: 'Workspace',
  agent: 'Agent',
  milestone: 'Milestone',
  file: 'File',
}

const KIND_ICON: Record<SmartMentionKind, typeof GitPullRequestIcon> = {
  issue: GitPullRequestIcon,
  session: MessageSquareIcon,
  workspace: BoxesIcon,
  agent: BotIcon,
  milestone: FlagIcon,
  file: FileIcon,
}

function groupedItems(items: SmartMentionItem[]) {
  return KIND_ORDER
    .map(kind => ({
      kind,
      items: items.filter(item => item.kind === kind),
    }))
    .filter(group => group.items.length > 0)
}

function groupedItemsWithIndex(items: SmartMentionItem[]): GroupedSmartMentionItems {
  const indexedGroups: Array<{ kind: SmartMentionKind, items: IndexedSmartMentionItem[] }> = []
  const orderedItems: SmartMentionItem[] = []
  let index = 0

  for (const group of groupedItems(items)) {
    const indexedItems = group.items.map((item) => {
      const indexedItem = { item, index }
      orderedItems.push(item)
      index += 1
      return indexedItem
    })
    indexedGroups.push({ kind: group.kind, items: indexedItems })
  }

  return { groups: indexedGroups, orderedItems }
}

export function SmartMentionList({ items, command, ref }: SmartMentionListProps & { ref?: React.Ref<SmartMentionListRef> }) {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const selectedRef = useRef(0)
  const listRef = useRef<HTMLDivElement>(null)
  const { groups, orderedItems } = groupedItemsWithIndex(items)

  useEffect(() => {
    setSelectedIndex(0)
    selectedRef.current = 0
  }, [items])

  useEffect(() => {
    selectedRef.current = selectedIndex
    const selected = listRef.current?.querySelector<HTMLElement>(`[data-mention-index="${selectedIndex}"]`)
    selected?.scrollIntoView?.({ block: 'nearest' })
  }, [selectedIndex])

  const selectItem = (index: number) => {
      const item = orderedItems[index]
      if (item) {
        command(item)
      }
    }

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (items.length === 0) {
        return false
      }
      if (event.key === 'ArrowUp') {
        setSelectedIndex(prev => (prev + items.length - 1) % items.length)
        return true
      }
      if (event.key === 'ArrowDown') {
        setSelectedIndex(prev => (prev + 1) % items.length)
        return true
      }
      if (event.key === 'Enter') {
        selectItem(selectedRef.current)
        return true
      }
      return false
    },
  }), [items.length, selectItem])

  if (items.length === 0) {
    return null
  }

  return (
    <div className="w-80 overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-md">
      <div ref={listRef} className="max-h-80 overflow-y-auto p-1">
        {groups.map(group => (
          <div key={group.kind} className="py-1 first:pt-0 last:pb-0">
            <div className="px-2 pb-1 text-[10px] font-medium uppercase tracking-normal text-muted-foreground">
              {KIND_LABEL[group.kind]}
            </div>
            {group.items.map(({ item, index }) => {
              const Icon = KIND_ICON[item.kind]

              return (
                <button
                  type="button"
                  key={`${item.kind}:${item.id}`}
                  data-mention-index={index}
                  onClick={() => selectItem(index)}
                  className={cn(
                    'flex min-h-11 w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors',
                    index === selectedIndex
                      ? 'bg-accent text-accent-foreground'
                      : 'hover:bg-accent/50',
                  )}
                >
                  <Icon className="size-4 shrink-0 text-muted-foreground/70" aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-foreground">{item.label}</span>
                    {(item.title || item.detail) && (
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {item.title || item.detail}
                      </span>
                    )}
                  </span>
                </button>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}

SmartMentionList.displayName = 'SmartMentionList'
