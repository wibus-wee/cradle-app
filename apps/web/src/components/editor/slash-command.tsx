import type { Editor, Range } from '@tiptap/core'
import { Extension } from '@tiptap/core'
import { PluginKey } from '@tiptap/pm/state'
import { ReactRenderer } from '@tiptap/react'
import type { SuggestionKeyDownProps, SuggestionOptions } from '@tiptap/suggestion'
import Suggestion from '@tiptap/suggestion'

/* ─── Command item type ──────────────────────────────────── */

export interface SlashCommandItem {
  title: string
  description: string
  icon: string
  command: (props: { editor: Editor, range: Range }) => void
}

/* ─── Available commands ─────────────────────────────────── */

const SLASH_COMMANDS: SlashCommandItem[] = [
  {
    title: 'Text',
    description: '普通段落',
    icon: 'T',
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setParagraph().run()
    },
  },
  {
    title: 'Heading 1',
    description: '大标题',
    icon: 'H1',
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setHeading({ level: 1 }).run()
    },
  },
  {
    title: 'Heading 2',
    description: '中标题',
    icon: 'H2',
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setHeading({ level: 2 }).run()
    },
  },
  {
    title: 'Heading 3',
    description: '小标题',
    icon: 'H3',
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setHeading({ level: 3 }).run()
    },
  },
  {
    title: 'Bullet List',
    description: '无序列表',
    icon: '•',
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleBulletList().run()
    },
  },
  {
    title: 'Numbered List',
    description: '有序列表',
    icon: '1.',
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleOrderedList().run()
    },
  },
  {
    title: 'Task List',
    description: '任务列表',
    icon: '☐',
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleTaskList().run()
    },
  },
  {
    title: 'Code Block',
    description: '代码块',
    icon: '<>',
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleCodeBlock().run()
    },
  },
  {
    title: 'Quote',
    description: '引用块',
    icon: '"',
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleBlockquote().run()
    },
  },
  {
    title: 'Divider',
    description: '分隔线',
    icon: '—',
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setHorizontalRule().run()
    },
  },
]

/* ─── Suggestion render ──────────────────────────────────── */

interface SlashListRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean
}

type SuggestionRender = NonNullable<SuggestionOptions<SlashCommandItem, SlashCommandItem>['render']>

const slashCommandSuggestionPluginKey = new PluginKey('slashCommandSuggestion')

const suggestionRender: SuggestionRender = () => {
  let component: ReactRenderer<SlashListRef> | null = null
  let popup: HTMLDivElement | null = null

  return {
    onStart(props) {
      import('./slash-command-list').then(({ SlashCommandList }) => {
        component = new ReactRenderer(SlashCommandList, {
          props: { items: props.items, command: props.command },
          editor: props.editor,
        }) as ReactRenderer<SlashListRef>

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
        popup?.remove()
        component?.destroy()
        popup = null
        component = null
        return true
      }
      return component?.ref?.onKeyDown(props) ?? false
    },

    onExit() {
      popup?.remove()
      component?.destroy()
      popup = null
      component = null
    },
  }
}

/* ─── Extension ──────────────────────────────────────────── */

export const SlashCommand = Extension.create({
  name: 'slashCommand',

  addOptions() {
    return {
      suggestion: {
        char: '/',
        command: ({
          editor,
          range,
          props,
        }: {
          editor: Editor
          range: Range
          props: SlashCommandItem
        }) => {
          props.command({ editor, range })
        },
        items: ({ query }: { query: string }) => {
          return SLASH_COMMANDS.filter(item =>
            item.title.toLowerCase().includes(query.toLowerCase()))
        },
        render: suggestionRender,
      },
    }
  },

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        ...this.options.suggestion,
        pluginKey: slashCommandSuggestionPluginKey,
      }),
    ]
  },
})
