import {
  CodeLine as CodeIcon,
  Heading1Line as Heading1Icon,
  Heading2Line as Heading2Icon,
  Heading3Line as Heading3Icon,
  ListOrderedLine as ListOrderedIcon,
  PlaylistLine as ListIcon,
  QuoteLeftLine as QuoteIcon,
  SubtractLine as MinusIcon,
  TextLine as TextIcon,
  ToDoLine as ListTodoIcon,
} from '@mingcute/react'
import { useEffect, useImperativeHandle, useRef, useState } from 'react'

import { cn } from '~/lib/cn'

import type { SlashCommandItem } from './slash-command'

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  'T': TextIcon,
  'H1': Heading1Icon,
  'H2': Heading2Icon,
  'H3': Heading3Icon,
  '•': ListIcon,
  '1.': ListOrderedIcon,
  '☐': ListTodoIcon,
  '<>': CodeIcon,
  '"': QuoteIcon,
  '—': MinusIcon,
}

interface SlashCommandListRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean
}

interface SlashCommandListProps {
  items: SlashCommandItem[]
  command: (item: SlashCommandItem) => void
}

export function SlashCommandList({ items, command, ref }: SlashCommandListProps & { ref?: React.Ref<SlashCommandListRef> }) {
    const [selectedIndex, setSelectedIndex] = useState(0)
    const selectedRef = useRef(0)
    const listRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
      setSelectedIndex(0)
      selectedRef.current = 0
    }, [items])

    useEffect(() => {
      selectedRef.current = selectedIndex
      // Scroll selected item into view
      const list = listRef.current
      if (list) {
        const selected = list.children[selectedIndex] as HTMLElement | undefined
        selected?.scrollIntoView({ block: 'nearest' })
      }
    }, [selectedIndex])

    const selectItem = (index: number) => {
        const item = items[index]
        if (item) {
          command(item)
        }
      }

    useImperativeHandle(ref, () => ({
      onKeyDown: ({ event }) => {
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
    }))

    if (items.length === 0) {
      return null
    }

  return (
    <div className="w-56 overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-md">
      <div ref={listRef} className="max-h-64 overflow-y-auto p-1">
        {items.map((item, index) => {
          const Icon = ICON_MAP[item.icon]
          return (
            <button
              type="button"
              key={item.title}
              onClick={() => selectItem(index)}
              className={cn(
                'flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors',
                index === selectedIndex
                  ? 'bg-accent text-accent-foreground'
                  : 'hover:bg-accent/50',
              )}
            >
              {Icon
                ? <Icon className="size-4 shrink-0 text-muted-foreground/60" />
                : (
                  <span className="size-4 shrink-0 flex items-center justify-center text-[11px] font-mono text-muted-foreground">
                    {item.icon}
                  </span>
                )}
              <div className="flex-1 min-w-0">
                <span className="block text-foreground text-[13px]">{item.title}</span>
                <span className="block text-[11px] text-muted-foreground">{item.description}</span>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

SlashCommandList.displayName = 'SlashCommandList'
