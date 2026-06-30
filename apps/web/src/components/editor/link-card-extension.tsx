import {
  ExternalLinkLine as ExternalLinkIcon,
  LayoutGridLine as CardIcon,
  LinkLine as LinkIcon,
  MenuLine as CompactIcon,
} from '@mingcute/react'
import type { Editor } from '@tiptap/core'
import { mergeAttributes, Node } from '@tiptap/core'
import { NodeSelection } from '@tiptap/pm/state'
import type { ReactNodeViewProps } from '@tiptap/react'
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import type { MarkdownNodeSpec } from 'tiptap-markdown'

import { cn } from '~/lib/cn'

import type { LinkCardDisplay } from './link-card'
import { LinkCard } from './link-card'
import { LINK_CARD_TITLE_PREFIX, linkCardTitle, parseLinkCardTitle } from './link-card-format'

export interface LinkCardOptions {
  /**
   * Markdown link title prefix used to persist the display mode. Plain links
   * carry no title; cards use `cradle:card` / `cradle:compact`.
   */
  titlePrefix: string
}

export { LINK_CARD_TITLE_PREFIX, linkCardTitle, parseLinkCardTitle } from './link-card-format'

export const LinkCardExtension = Node.create<LinkCardOptions>({
  name: 'linkCard',

  priority: 1000,

  group: 'block',

  atom: true,

  defining: true,

  selectable: true,

  draggable: false,

  addOptions() {
    return {
      titlePrefix: LINK_CARD_TITLE_PREFIX,
    }
  },

  addAttributes() {
    return {
      href: {
        default: '',
        parseHTML: element => element.getAttribute('href') ?? '',
      },
      display: {
        default: 'card' satisfies LinkCardDisplay,
        parseHTML: element =>
          (element.getAttribute('data-link-card') === 'compact' ? 'compact' : 'card') as LinkCardDisplay,
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'a[data-link-card]',
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    const attrs = HTMLAttributes as { href: string, display: LinkCardDisplay }
    return [
      'a',
      mergeAttributes(
        {
          'href': attrs.href,
          'data-link-card': attrs.display,
          'class': 'link-card',
        },
        HTMLAttributes,
      ),
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(LinkCardNodeView)
  },

  addStorage() {
    return {
      markdown: {
        serialize(state, node) {
          const { href, display } = node.attrs as { href: string, display: LinkCardDisplay }
          const label = state.esc(href)
          const url = state.esc(href)
          state.write(`[${label}](${url} "${linkCardTitle(display)}")`)
          state.closeBlock(node)
        },
        parse: {
          updateDOM(element) {
            // Tag titled `cradle:*` links as cards so ProseMirror's DOM parser
            // matches the block-node rule. Only promote links that are the sole
            // child of their paragraph — inline titled links stay inline.
            element.querySelectorAll('a[title]').forEach((anchor) => {
              const display = parseLinkCardTitle(anchor.getAttribute('title'))
              if (!display) {
                return
              }
              const parent = anchor.parentElement
              if (!parent || parent.tagName !== 'P' || parent.childElementCount !== 1) {
                return
              }
              anchor.setAttribute('data-link-card', display)
              anchor.removeAttribute('title')
            })
          },
        },
      } satisfies MarkdownNodeSpec,
    }
  },

  addCommands() {
    return {
      setLinkCard:
        (attrs: { display: LinkCardDisplay }) =>
        ({ editor, state, chain }) => {
          const href = editor.getAttributes('link').href
          if (typeof href !== 'string' || !href) {
            return false
          }
          const $pos = state.selection.$from
          const paraStart = $pos.before($pos.depth)
          const paraEnd = paraStart + $pos.parent.nodeSize
          return chain()
            .insertContentAt({ from: paraStart, to: paraEnd }, {
              type: this.name,
              attrs: { href, display: attrs.display },
            })
            .run()
        },
      unsetLinkCard:
        () =>
        ({ state, chain }) => {
          const selection = state.selection
          if (!(selection instanceof NodeSelection)) {
            return false
          }
          const node = selection.node
          if (node.type.name !== this.name) {
            return false
          }
          const href = (node.attrs as { href: string }).href
          return chain()
            .insertContentAt(
              { from: selection.from, to: selection.to },
              {
                type: 'paragraph',
                content: [
                  {
                    type: 'text',
                    text: href,
                    marks: [{ type: 'link', attrs: { href } }],
                  },
                ],
              },
            )
            .setMeta('preventAutolink', true)
            .run()
        },
      setLinkCardDisplay:
        (attrs: { display: LinkCardDisplay }) =>
        ({ state, chain }) => {
          const selection = state.selection
          if (!(selection instanceof NodeSelection) || selection.node.type.name !== this.name) {
            return false
          }
          return chain().updateAttributes(this.name, { display: attrs.display }).run()
        },
    }
  },
})

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    linkCard: {
      /** Convert the inline link at the cursor into a block link card. */
      setLinkCard: (attrs: { display: LinkCardDisplay }) => ReturnType
      /** Convert the selected link card back into an inline link. */
      unsetLinkCard: () => ReturnType
      /** Switch the selected link card between card and compact display. */
      setLinkCardDisplay: (attrs: { display: LinkCardDisplay }) => ReturnType
    }
  }
}

function LinkCardNodeView(props: ReactNodeViewProps) {
  const { href, display } = props.node.attrs as { href: string, display: LinkCardDisplay }
  const editor = props.editor as Editor

  return (
    <NodeViewWrapper className="link-card-wrapper">
      <LinkCard
        href={href}
        display={display}
        toolbar={(
          <>
            <ToolbarButton
              label="Plain link"
              onClick={() => editor.chain().focus().unsetLinkCard().run()}
            >
              <LinkIcon className="size-3.5" aria-hidden="true" />
            </ToolbarButton>
            <ToolbarButton
              label="Card"
              active={display === 'card'}
              onClick={() => editor.chain().focus().setLinkCardDisplay({ display: 'card' }).run()}
            >
              <CardIcon className="size-3.5" aria-hidden="true" />
            </ToolbarButton>
            <ToolbarButton
              label="Small card"
              active={display === 'compact'}
              onClick={() => editor.chain().focus().setLinkCardDisplay({ display: 'compact' }).run()}
            >
              <CompactIcon className="size-3.5" aria-hidden="true" />
            </ToolbarButton>
            <div className="mx-0.5 h-4 w-px bg-border" />
            <ToolbarButton
              label="Open link"
              onClick={() => {
                if (href) {
                  window.open(href, '_blank', 'noopener,noreferrer')
                }
              }}
            >
              <ExternalLinkIcon className="size-3.5" aria-hidden="true" />
            </ToolbarButton>
          </>
        )}
      />
    </NodeViewWrapper>
  )
}

function ToolbarButton({
  label,
  active = false,
  onClick,
  children,
}: {
  label: string
  active?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      contentEditable={false}
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onClick()
      }}
      className={cn(
        'flex size-6 items-center justify-center rounded text-muted-foreground transition-colors',
        active ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50 hover:text-foreground',
      )}
    >
      {children}
    </button>
  )
}
