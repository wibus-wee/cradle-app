import {
  BoldLine as BoldIcon,
  CodeLine as CodeIcon,
  ItalicLine as ItalicIcon,
  LayoutGridLine as CardIcon,
  LinkLine as LinkIcon,
  MenuLine as CompactIcon,
  StrikethroughLine as StrikethroughIcon,
} from '@mingcute/react'
import type { Editor } from '@tiptap/core'
import { BubbleMenu } from '@tiptap/react/menus'
import { useRef, useState } from 'react'

import { cn } from '~/lib/cn'

interface EditorBubbleMenuProps {
  editor: Editor
}

export function EditorBubbleMenu({ editor }: EditorBubbleMenuProps) {
  const [linkInput, setLinkInput] = useState(false)
  const [linkUrl, setLinkUrl] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const handleLinkClick = () => {
    if (editor.isActive('link')) {
      editor.chain().focus().unsetLink().run()
    }
    else {
      setLinkInput(true)
      setLinkUrl('')
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }

  const applyLink = () => {
    if (linkUrl.trim()) {
      editor.chain().focus().setLink({ href: linkUrl.trim() }).run()
    }
    setLinkInput(false)
    setLinkUrl('')
  }

  return (
    <BubbleMenu
      editor={editor}
      options={{
        placement: 'top',
        offset: 8,
      }}
      className="flex items-center gap-0.5 rounded-lg border border-border bg-popover px-1 py-0.5 shadow-md text-foreground"
    >
      {linkInput
        ? (
          <div className="flex items-center gap-1">
            <input
              ref={inputRef}
              value={linkUrl}
              aria-label="Link URL"
              onChange={e => setLinkUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  applyLink()
                }
                if (e.key === 'Escape') {
                  setLinkInput(false)
                }
              }}
              placeholder="https://"
              className="h-6 w-40 rounded bg-transparent px-1.5 text-[12px] text-foreground outline-none placeholder:text-muted-foreground/40"
            />
            <ToolbarButton active={false} onClick={applyLink} aria-label="Apply link">
              <LinkIcon className="size-3.5" aria-hidden="true" />
            </ToolbarButton>
          </div>
        )
        : (
          <>
            <ToolbarButton
              active={editor.isActive('bold')}
              onClick={() => editor.chain().focus().toggleBold().run()}
              aria-label="Bold"
            >
              <BoldIcon className="size-3.5" aria-hidden="true" />
            </ToolbarButton>
            <ToolbarButton
              active={editor.isActive('italic')}
              onClick={() => editor.chain().focus().toggleItalic().run()}
              aria-label="Italic"
            >
              <ItalicIcon className="size-3.5" aria-hidden="true" />
            </ToolbarButton>
            <ToolbarButton
              active={editor.isActive('strike')}
              onClick={() => editor.chain().focus().toggleStrike().run()}
              aria-label="Strikethrough"
            >
              <StrikethroughIcon className="size-3.5" aria-hidden="true" />
            </ToolbarButton>
            <ToolbarButton
              active={editor.isActive('code')}
              onClick={() => editor.chain().focus().toggleCode().run()}
              aria-label="Code"
            >
              <CodeIcon className="size-3.5" aria-hidden="true" />
            </ToolbarButton>

            <div className="mx-0.5 h-4 w-px bg-border" />

            <ToolbarButton
              active={editor.isActive('link')}
              onClick={handleLinkClick}
              aria-label="Link"
            >
              <LinkIcon className="size-3.5" aria-hidden="true" />
            </ToolbarButton>

            {editor.isActive('link') && (
              <>
                <div className="mx-0.5 h-4 w-px bg-border" />
                <ToolbarButton
                  active={false}
                  onClick={() => editor.chain().focus().setLinkCard({ display: 'card' }).run()}
                  aria-label="Convert to card"
                  title="Card"
                >
                  <CardIcon className="size-3.5" aria-hidden="true" />
                </ToolbarButton>
                <ToolbarButton
                  active={false}
                  onClick={() => editor.chain().focus().setLinkCard({ display: 'compact' }).run()}
                  aria-label="Convert to small card"
                  title="Small card"
                >
                  <CompactIcon className="size-3.5" aria-hidden="true" />
                </ToolbarButton>
              </>
            )}
          </>
        )}
    </BubbleMenu>
  )
}

function ToolbarButton({
  active,
  children,
  ...props
}: {
  active: boolean
  children: React.ReactNode
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cn(
        'rounded-md p-1.5 transition-colors',
        active
          ? 'bg-accent text-accent-foreground'
          : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
      )}
      {...props}
    >
      {children}
    </button>
  )
}
