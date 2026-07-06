import {
  Box3Line as BoxesIcon,
  FileLine as FileIcon,
  Flag2Line as FlagIcon,
  GitPullRequestLine as GitPullRequestIcon,
  Message1Line as MessageSquareIcon,
  RobotLine as BotIcon,
} from '@mingcute/react'
import type { Editor, Range } from '@tiptap/core'
import { mergeAttributes, Node } from '@tiptap/core'
import { PluginKey } from '@tiptap/pm/state'
import type { ReactNodeViewProps } from '@tiptap/react'
import { NodeViewWrapper, ReactNodeViewRenderer, ReactRenderer } from '@tiptap/react'
import type { SuggestionKeyDownProps, SuggestionOptions } from '@tiptap/suggestion'
import Suggestion from '@tiptap/suggestion'
import { useState } from 'react'
import type { MarkdownNodeSpec } from 'tiptap-markdown'

import { cn } from '~/lib/cn'

import type { SmartMentionAttrs, SmartMentionItem } from './smart-mention-utils'
import {
  getSmartMentionHref,
  getSmartMentionMarkdownLabel,
  parseSmartMentionHref,
  parseSmartMentionKind,
} from './smart-mention-utils'

export interface SmartMentionOptions {
  getItems: (query: string) => SmartMentionItem[] | Promise<SmartMentionItem[]>
  onOpen?: (attrs: SmartMentionAttrs) => void
  suggestion: Partial<SuggestionOptions<SmartMentionItem, SmartMentionItem>>
}

const EMPTY_ITEMS: SmartMentionItem[] = []

const KIND_LABEL: Record<SmartMentionAttrs['kind'], string> = {
  issue: 'Issue',
  session: 'Session',
  workspace: 'Workspace',
  agent: 'Agent',
  milestone: 'Milestone',
  file: 'File',
}

const KIND_ICON: Record<SmartMentionAttrs['kind'], typeof GitPullRequestIcon> = {
  issue: GitPullRequestIcon,
  session: MessageSquareIcon,
  workspace: BoxesIcon,
  agent: BotIcon,
  milestone: FlagIcon,
  file: FileIcon,
}

function getAttrsFromElement(element: HTMLElement): SmartMentionAttrs | null {
  const hrefAttrs = parseSmartMentionHref(element.getAttribute('href'))
  if (hrefAttrs) {
    return hrefAttrs
  }

  const kind = parseSmartMentionKind(element.getAttribute('data-smart-mention-kind'))
  const id = element.getAttribute('data-smart-mention-id')
  if (!kind || !id) {
    return null
  }

  return {
    kind,
    id,
    label: element.getAttribute('data-smart-mention-label') ?? element.textContent ?? id,
    title: element.getAttribute('data-smart-mention-title'),
    detail: element.getAttribute('data-smart-mention-detail'),
    workspaceId: element.getAttribute('data-smart-mention-workspace-id'),
  }
}

function attrsToHtml(attrs: SmartMentionAttrs) {
  return {
    'href': getSmartMentionHref(attrs),
    'data-smart-mention-kind': attrs.kind,
    'data-smart-mention-id': attrs.id,
    'data-smart-mention-label': attrs.label,
    'data-smart-mention-title': attrs.title ?? null,
    'data-smart-mention-detail': attrs.detail ?? null,
    'data-smart-mention-workspace-id': attrs.workspaceId ?? null,
  }
}

function SmartMentionNodeView(props: ReactNodeViewProps) {
  const attrs = props.node.attrs as SmartMentionAttrs
  const options = props.extension.options as SmartMentionOptions
  const [previewOpen, setPreviewOpen] = useState(false)
  const Icon = KIND_ICON[attrs.kind]

  return (
    <NodeViewWrapper
      as="span"
      className="relative inline-flex align-baseline"
      onMouseEnter={() => setPreviewOpen(true)}
      onMouseLeave={() => setPreviewOpen(false)}
    >
      <button
        type="button"
        className={cn(
          'inline-flex h-6 max-w-80 items-center gap-1 rounded-md border border-border bg-fill px-1.5 text-[12px] font-medium leading-none text-foreground align-baseline transition-colors',
          'hover:border-ring hover:bg-accent hover:text-accent-foreground',
        )}
        contentEditable={false}
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          options.onOpen?.(attrs)
        }}
      >
        <Icon className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="truncate">{attrs.label}</span>
      </button>
      {previewOpen && (
        <span className="pointer-events-none absolute left-0 top-full z-50 mt-1 w-64 rounded-md border border-border bg-popover p-2 text-popover-foreground shadow-md">
          <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-normal text-muted-foreground">
            <Icon className="size-3" aria-hidden="true" />
            {KIND_LABEL[attrs.kind]}
          </span>
          <span className="mt-1 block truncate text-[13px] font-medium">{attrs.title || attrs.label}</span>
          {attrs.detail && (
            <span className="mt-0.5 block line-clamp-3 text-[12px] leading-5 text-muted-foreground">{attrs.detail}</span>
          )}
        </span>
      )}
    </NodeViewWrapper>
  )
}

function normalizeMention(item: SmartMentionItem): SmartMentionAttrs {
  return {
    kind: item.kind,
    id: item.id,
    label: item.label,
    title: item.title ?? null,
    detail: item.detail ?? null,
    workspaceId: item.workspaceId ?? null,
  }
}

interface SmartMentionListRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean
}

type SuggestionRender = NonNullable<SuggestionOptions<SmartMentionItem, SmartMentionItem>['render']>

const smartMentionSuggestionPluginKey = new PluginKey('smartMentionSuggestion')

const suggestionRender: SuggestionRender = () => {
  let component: ReactRenderer<SmartMentionListRef> | null = null
  let popup: HTMLDivElement | null = null
  let active = false

  return {
    onStart(props) {
      active = true
      import('./smart-mention-list').then(({ SmartMentionList }) => {
        if (!active) {
          return
        }

        component = new ReactRenderer(SmartMentionList, {
          props: { items: props.items, command: props.command },
          editor: props.editor,
        }) as ReactRenderer<SmartMentionListRef>

        popup = document.createElement('div')
        popup.style.cssText = 'position:fixed;z-index:50;'
        document.body.appendChild(popup)
        popup.appendChild(component.element)

        const rect = props.clientRect?.()
        if (rect && popup) {
          Object.assign(popup.style, { left: `${rect.left}px`, top: `${rect.bottom + 4}px` })
        }
      })
    },

    onUpdate(props) {
      component?.updateProps({ items: props.items, command: props.command })

      const rect = props.clientRect?.()
      if (rect && popup) {
        Object.assign(popup.style, { left: `${rect.left}px`, top: `${rect.bottom + 4}px` })
      }
    },

    onKeyDown(props: SuggestionKeyDownProps) {
      if (props.event.key === 'Escape') {
        active = false
        popup?.remove()
        component?.destroy()
        popup = null
        component = null
        return true
      }
      return component?.ref?.onKeyDown(props) ?? false
    },

    onExit() {
      active = false
      popup?.remove()
      component?.destroy()
      popup = null
      component = null
    },
  }
}

export const SmartMention = Node.create<SmartMentionOptions>({
  name: 'smartMention',
  priority: 1000,

  group: 'inline',
  inline: true,
  atom: true,
  selectable: false,

  addOptions() {
    return {
      getItems: () => EMPTY_ITEMS,
      onOpen: undefined,
      suggestion: {
        char: '@',
        allowSpaces: true,
        command: () => {},
        items: () => EMPTY_ITEMS,
        render: suggestionRender,
      },
    }
  },

  addAttributes() {
    return {
      kind: {
        default: 'issue',
        parseHTML: element => getAttrsFromElement(element)?.kind ?? 'issue',
      },
      id: {
        default: '',
        parseHTML: element => getAttrsFromElement(element)?.id ?? '',
      },
      label: {
        default: '',
        parseHTML: element => getAttrsFromElement(element)?.label ?? element.textContent ?? '',
      },
      title: {
        default: null,
        parseHTML: element => getAttrsFromElement(element)?.title ?? null,
      },
      detail: {
        default: null,
        parseHTML: element => getAttrsFromElement(element)?.detail ?? null,
      },
      workspaceId: {
        default: null,
        parseHTML: element => getAttrsFromElement(element)?.workspaceId ?? null,
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'a[data-smart-mention-kind]',
      },
      {
        tag: 'span[data-smart-mention-kind]',
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    const attrs = HTMLAttributes as SmartMentionAttrs
    return ['a', mergeAttributes(attrsToHtml(attrs), { class: 'smart-mention' }), getSmartMentionMarkdownLabel(attrs)]
  },

  addNodeView() {
    return ReactNodeViewRenderer(SmartMentionNodeView)
  },

  addStorage() {
    return {
      markdown: {
        serialize(state, node) {
          const attrs = node.attrs as SmartMentionAttrs
          state.write(`[${getSmartMentionMarkdownLabel(attrs)}](${getSmartMentionHref(attrs)})`)
        },
        parse: {
          updateDOM(element) {
            element.querySelectorAll('a[href^="cradle://mention/"]').forEach((anchor) => {
              const attrs = parseSmartMentionHref(anchor.getAttribute('href'))
              if (!attrs || !(anchor instanceof HTMLElement)) {
                return
              }
              Object.entries(attrsToHtml(attrs)).forEach(([key, value]) => {
                if (value) {
                  anchor.setAttribute(key, String(value))
                }
              })
              anchor.textContent = getSmartMentionMarkdownLabel(attrs)
            })
          },
        },
      } satisfies MarkdownNodeSpec,
    }
  },

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        ...this.options.suggestion,
        pluginKey: smartMentionSuggestionPluginKey,
        command: ({
          editor,
          range,
          props,
        }: {
          editor: Editor
          range: Range
          props: SmartMentionItem
        }) => {
          const attrs = normalizeMention(props)
          editor
            .chain()
            .focus()
            .insertContentAt(range, [
              { type: this.name, attrs },
              { type: 'text', text: ' ' },
            ])
            .run()
        },
        items: ({ query }: { query: string }) => this.options.getItems(query),
        render: suggestionRender,
      }),
    ]
  },
})
