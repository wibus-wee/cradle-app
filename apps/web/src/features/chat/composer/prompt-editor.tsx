import { baseKeymap } from 'prosemirror-commands'
import { history, redo, undo } from 'prosemirror-history'
import { keymap } from 'prosemirror-keymap'
import type { Node as ProseMirrorNode, NodeSpec } from 'prosemirror-model'
import { Fragment, Schema } from 'prosemirror-model'
import type { Command, Transaction } from 'prosemirror-state'
import { EditorState, Plugin, PluginKey, TextSelection } from 'prosemirror-state'
import type { DirectEditorProps, NodeView } from 'prosemirror-view'
import { Decoration, DecorationSet, EditorView } from 'prosemirror-view'
import type { MutableRefObject, Ref } from 'react'
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react'

import { cn } from '~/lib/cn'

import type {
  ChatContextPart,
  ChatFileLineCommentContextPart,
  ChatPluginContextPart,
  ChatSkillContextPart,
} from '../context/chat-context-parts'
import type { MentionItem, PluginMentionItem } from '../mentions/mention-panel'
import type { SkillMentionItem } from '../mentions/skill-mention-panel'
import {
  formatSkillMentionTokenLabel,
  SKILL_MENTION_TOKEN_CLASS,
} from '../mentions/skill-mention-token'
import type { ChatComposerSlashCommand } from '../slash-commands/chat-slash-commands'
import { getActiveSlashCommand } from '../slash-commands/slash-command-input'

const PLACEHOLDER_PLUGIN_KEY = new PluginKey<{ placeholder: string }>('chatPromptPlaceholder')
const TOKEN_LEAF_TEXT = '\uFFFC'
const SIMPLE_SLASH_RE = /^[ \t]*\/[^/\s]*$/

export interface PromptEditorTriggerRange {
  from: number
  to: number
}

export type PromptEditorTrigger
  = | { kind: 'file', query: string, range: PromptEditorTriggerRange }
    | { kind: 'skill', query: string, range: PromptEditorTriggerRange }
    | {
      kind: 'slash'
      query: string
      range: PromptEditorTriggerRange
      selectedCommand: ChatComposerSlashCommand | null
    }
    | null

export interface PromptEditorSnapshot {
  text: string
  contextParts: ChatContextPart[]
  trigger: PromptEditorTrigger
}

export interface PromptEditorController {
  appendText: (text: string) => void
  canNavigateHistory: (direction: 'newer' | 'older') => boolean
  clear: () => void
  focus: () => void
  getContextParts: () => ChatContextPart[]
  getText: () => string
  insertFileMention: (item: MentionItem, range: PromptEditorTriggerRange) => void
  insertPluginMention: (item: PluginMentionItem, range: PromptEditorTriggerRange) => void
  insertSkillMention: (item: SkillMentionItem, range: PromptEditorTriggerRange) => void
  insertText: (text: string) => void
  replaceFileTriggerWithText: (item: MentionItem, range: PromptEditorTriggerRange) => void
  replaceRangeWithText: (range: PromptEditorTriggerRange, text: string) => void
  setPlaceholder: (placeholder: string) => void
  setDraft: (text: string, contextParts: ChatContextPart[]) => void
  setText: (text: string) => void
}

export interface PromptEditorProps {
  ariaControls?: string
  ariaDescribedBy?: string
  ariaExpanded?: boolean
  ariaLabel: string
  ariaActiveDescendant?: string
  className?: string
  disabled?: boolean
  placeholder: string
  selectedSlashCommand: ChatComposerSlashCommand | null
  slashCommands: ChatComposerSlashCommand[]
  testId: string
  onChange: (snapshot: PromptEditorSnapshot) => void
  onDrop?: (event: DragEvent) => boolean
  onFocusChange?: (focused: boolean) => void
  onKeyDown?: (event: KeyboardEvent) => void
  onPaste?: (event: ClipboardEvent) => void
}

const mentionAttrs = {
  name: { default: '' },
  displayName: { default: '' },
  path: { default: '' },
  description: { default: null },
  scope: { default: '' },
}

const fileMentionSpec: NodeSpec = {
  attrs: {
    label: { validate: 'string' },
    path: { validate: 'string' },
    type: { default: 'file' },
  },
  atom: true,
  inline: true,
  group: 'inline',
  draggable: false,
  selectable: false,
  toDOM(node) {
    return [
      'span',
      {
        'class':
          'inline-flex max-w-full items-center rounded-md bg-muted px-1.5 py-0.5 align-baseline text-[0.8125em] leading-none text-foreground ring-1 ring-border/50',
        'data-file-mention-label': node.attrs.label,
        'data-file-mention-path': node.attrs.path,
        'data-file-mention-type': node.attrs.type,
        'contenteditable': 'false',
      },
      node.attrs.label,
    ]
  },
  parseDOM: [
    {
      tag: 'span[data-file-mention-path]',
      getAttrs(element) {
        if (!(element instanceof HTMLElement)) {
          return false
        }
        return {
          label: element.getAttribute('data-file-mention-label') ?? element.textContent ?? '',
          path: element.getAttribute('data-file-mention-path') ?? '',
          type: element.getAttribute('data-file-mention-type') ?? 'file',
        }
      },
    },
  ],
}

const hardBreakSpec: NodeSpec = {
  inline: true,
  group: 'inline',
  selectable: false,
  parseDOM: [{ tag: 'br' }],
  toDOM: () => ['br'],
}

const skillMentionSpec: NodeSpec = {
  attrs: mentionAttrs,
  atom: true,
  inline: true,
  group: 'inline',
  draggable: false,
  selectable: false,
  toDOM(node) {
    const text = node.attrs.displayName || node.attrs.name
    return [
      'span',
      {
        'class': SKILL_MENTION_TOKEN_CLASS,
        'data-skill-mention-name': node.attrs.name,
        'data-skill-mention-display-name': text,
        'data-skill-mention-path': node.attrs.path,
        'data-skill-mention-description': node.attrs.description ?? '',
        'data-skill-mention-scope': node.attrs.scope,
        'contenteditable': 'false',
      },
      formatSkillMentionTokenLabel(String(text)),
    ]
  },
  parseDOM: [
    {
      tag: 'span[data-skill-mention-name][data-skill-mention-path]',
      getAttrs(element) {
        if (!(element instanceof HTMLElement)) {
          return false
        }
        const name = element.getAttribute('data-skill-mention-name') ?? ''
        return {
          name,
          displayName: element.getAttribute('data-skill-mention-display-name') ?? name,
          path: element.getAttribute('data-skill-mention-path') ?? '',
          description: element.getAttribute('data-skill-mention-description') || null,
          scope: element.getAttribute('data-skill-mention-scope') ?? '',
        }
      },
    },
  ],
}

const pluginMentionSpec: NodeSpec = {
  attrs: {
    provider: { default: 'cradle' },
    pluginName: { default: '' },
    displayName: { default: '' },
    description: { default: null },
    iconUrl: { default: null },
    routeSegment: { default: '' },
    capabilities: { default: [] },
    mcpServers: { default: [] },
    nativeMention: { default: null },
  },
  atom: true,
  inline: true,
  group: 'inline',
  draggable: false,
  selectable: false,
  toDOM(node) {
    const text = node.attrs.displayName || node.attrs.pluginName
    return [
      'span',
      {
        ...pluginMentionDomAttrs(node),
        contenteditable: 'false',
      },
      `@${text}`,
    ]
  },
  parseDOM: [
    {
      tag: 'span[data-plugin-mention-name]',
      getAttrs(element) {
        if (!(element instanceof HTMLElement)) {
          return false
        }
        const pluginName = element.getAttribute('data-plugin-mention-name') ?? ''
        return {
          provider:
            element.getAttribute('data-plugin-mention-provider') === 'codex' ? 'codex' : 'cradle',
          pluginName,
          displayName: element.getAttribute('data-plugin-mention-display-name') ?? pluginName,
          description: element.getAttribute('data-plugin-mention-description') || null,
          iconUrl: element.getAttribute('data-plugin-mention-icon-url') || null,
          routeSegment: element.getAttribute('data-plugin-mention-route-segment') ?? '',
          capabilities: readJsonAttribute(element, 'data-plugin-mention-capabilities', []),
          mcpServers: readJsonAttribute(element, 'data-plugin-mention-mcp-servers', []),
          nativeMention: readJsonAttribute(element, 'data-plugin-mention-native-mention', null),
        }
      },
    },
  ],
}

const fileLineCommentSpec: NodeSpec = {
  attrs: {
    workspaceId: { default: '' },
    path: { default: '' },
    lineStart: { default: 1 },
    lineEnd: { default: 1 },
    comment: { default: '' },
  },
  atom: true,
  inline: true,
  group: 'inline',
  draggable: false,
  selectable: false,
  toDOM(node) {
    const lines
      = node.attrs.lineStart === node.attrs.lineEnd
        ? `L${node.attrs.lineStart}`
        : `L${node.attrs.lineStart}-L${node.attrs.lineEnd}`
    return [
      'span',
      {
        'class':
          'inline-flex max-w-full items-center rounded-md bg-[var(--color-accent-scope)]/10 px-1.5 py-0.5 align-baseline text-[0.8125em] font-medium leading-none text-[var(--color-accent-scope)] ring-1 ring-[var(--color-accent-scope)]/15',
        'data-file-line-comment-workspace-id': node.attrs.workspaceId,
        'data-file-line-comment-path': node.attrs.path,
        'data-file-line-comment-start': String(node.attrs.lineStart),
        'data-file-line-comment-end': String(node.attrs.lineEnd),
        'data-file-line-comment-text': node.attrs.comment,
        'contenteditable': 'false',
      },
      `${node.attrs.path}:${lines}`,
    ]
  },
  parseDOM: [
    {
      tag: 'span[data-file-line-comment-path]',
      getAttrs(element) {
        if (!(element instanceof HTMLElement)) {
          return false
        }
        return {
          workspaceId: element.getAttribute('data-file-line-comment-workspace-id') ?? '',
          path: element.getAttribute('data-file-line-comment-path') ?? '',
          lineStart: Number(element.getAttribute('data-file-line-comment-start') ?? 1),
          lineEnd: Number(element.getAttribute('data-file-line-comment-end') ?? 1),
          comment: element.getAttribute('data-file-line-comment-text') ?? '',
        }
      },
    },
  ],
}

export const promptEditorSchema = new Schema({
  nodes: {
    doc: { content: 'paragraph+' },
    paragraph: {
      content: 'inline*',
      group: 'block',
      parseDOM: [{ tag: 'p' }],
      toDOM: () => ['p', 0],
    },
    hardBreak: hardBreakSpec,
    text: { group: 'inline' },
    fileMention: fileMentionSpec,
    skillMention: skillMentionSpec,
    pluginMention: pluginMentionSpec,
    fileLineComment: fileLineCommentSpec,
  },
  marks: {},
})

export const PromptEditor = forwardRef(
  (
    {
      ariaActiveDescendant,
      ariaControls,
      ariaDescribedBy,
      ariaExpanded,
      ariaLabel,
      className,
      disabled,
      onChange,
      onDrop,
      onFocusChange,
      onKeyDown,
      onPaste,
      placeholder,
      selectedSlashCommand,
      slashCommands,
      testId,
    }: PromptEditorProps,
    ref: Ref<PromptEditorController>,
  ) => {
    const mountRef = useRef<HTMLDivElement>(null)
    const viewRef = useRef<EditorView | null>(null)
    const lastDocRef = useRef(createPromptDoc(''))
    const initialPlaceholderRef = useRef(placeholder)
    const activePlaceholderRef = useRef(placeholder)
    const propsRef = useRef({
      disabled,
      onChange,
      onDrop,
      onFocusChange,
      onKeyDown,
      onPaste,
      placeholder,
      selectedSlashCommand,
      slashCommands,
    })

    propsRef.current = {
      disabled,
      onChange,
      onDrop,
      onFocusChange,
      onKeyDown,
      onPaste,
      placeholder,
      selectedSlashCommand,
      slashCommands,
    }

    const controller = useMemo<PromptEditorController>(
      () => ({
        appendText(text) {
          const view = viewRef.current
          if (!view || text.trim().length === 0) {
            return
          }
          appendPlainText(view, text)
        },
        clear() {
          const view = viewRef.current
          if (!view) {
            return
          }
          replaceEditorDoc(view, createPromptDoc(''))
        },
        focus() {
          viewRef.current?.focus()
        },
        getContextParts() {
          const view = viewRef.current
          return view ? readContextParts(view.state.doc) : []
        },
        getText() {
          const view = viewRef.current
          return view ? serializePromptDoc(view.state.doc) : ''
        },
        insertFileMention(item, range) {
          const view = viewRef.current
          if (!view) {
            return
          }
          const path
            = item.type === 'directory' && !item.path.endsWith('/') ? `${item.path}/` : item.path
          const label = path
          const node = promptEditorSchema.nodes.fileMention.create({
            label,
            path,
            type: item.type,
          })
          replaceRangeWithInlineNode(view, range, node)
        },
        insertPluginMention(item, range) {
          const view = viewRef.current
          if (!view) {
            return
          }
          const node = promptEditorSchema.nodes.pluginMention.create({
            provider: item.provider ?? 'cradle',
            pluginName: item.pluginName,
            displayName: item.displayName,
            description: item.description,
            iconUrl: item.iconUrl,
            routeSegment: item.routeSegment,
            capabilities: item.capabilities,
            mcpServers: item.mcpServers,
            nativeMention: item.nativeMention ?? null,
          })
          replaceRangeWithInlineNode(view, range, node)
        },
        insertSkillMention(item, range) {
          const view = viewRef.current
          if (!view) {
            return
          }
          const node = promptEditorSchema.nodes.skillMention.create({
            name: item.name,
            displayName: item.name,
            path: item.location,
            description: item.description,
            scope: item.scope,
          })
          replaceRangeWithInlineNode(view, range, node)
        },
        insertText(text) {
          const view = viewRef.current
          if (!view || text.length === 0) {
            return
          }
          const { from, to } = view.state.selection
          const tr = view.state.tr.insertText(text, from, to)
          tr.setSelection(TextSelection.create(tr.doc, from + text.length))
          view.dispatch(tr)
          view.focus()
        },
        canNavigateHistory(direction) {
          const view = viewRef.current
          if (!view || !view.state.selection.empty) {
            return false
          }
          const topLevelIndex = view.state.selection.$from.index(0)
          return direction === 'older'
            ? topLevelIndex === 0
            : topLevelIndex === view.state.doc.childCount - 1
        },
        replaceFileTriggerWithText(item, range) {
          const view = viewRef.current
          if (!view) {
            return
          }
          const path
            = item.type === 'directory' && !item.path.endsWith('/') ? `${item.path}/` : item.path
          replaceRangeWithPlainText(view, range, `@${path}`)
        },
        replaceRangeWithText(range, text) {
          const view = viewRef.current
          if (!view) {
            return
          }
          replaceRangeWithPlainText(view, range, text)
        },
        setPlaceholder(nextPlaceholder) {
          const view = viewRef.current
          if (!view) {
            return
          }
          const currentPlaceholder = PLACEHOLDER_PLUGIN_KEY.getState(view.state)?.placeholder
          if (currentPlaceholder === nextPlaceholder) {
            return
          }
          view.dispatch(
            view.state.tr.setMeta(PLACEHOLDER_PLUGIN_KEY, { placeholder: nextPlaceholder }),
          )
        },
        setDraft(text, contextParts) {
          const view = viewRef.current
          if (!view) {
            return
          }
          setEditorDraft(view, text, contextParts)
        },
        setText(text) {
          const view = viewRef.current
          if (!view) {
            return
          }
          setEditorText(view, text)
        },
      }),
      [],
    )

    useImperativeHandle(ref, () => controller, [controller])

    useEffect(() => {
      const mount = mountRef.current
      if (!mount) {
        return
      }

      let editorView: EditorView | null = null
      let detachDomAdapter: (() => void) | null = null
      const getView = () => editorView
      editorView = new EditorView(
        mount,
        createEditorProps({
          getView,
          initialDoc: lastDocRef.current,
          onStateUpdate: (nextState) => {
            lastDocRef.current = nextState.doc
          },
          placeholder: propsRef.current.placeholder ?? initialPlaceholderRef.current,
          propsRef,
        }),
      )
      detachDomAdapter = attachPromptEditorDomAdapter(editorView, propsRef)
      viewRef.current = editorView
      propsRef.current.onChange(
        readSnapshot(
          editorView.state,
          propsRef.current.slashCommands,
          propsRef.current.selectedSlashCommand,
        ),
      )

      return () => {
        if (editorView) {
          lastDocRef.current = editorView.state.doc
        }
        detachDomAdapter?.()
        editorView?.destroy()
        editorView = null
        detachDomAdapter = null
        viewRef.current = null
      }
    }, [])

    useEffect(() => {
      if (activePlaceholderRef.current === placeholder) {
        return
      }
      activePlaceholderRef.current = placeholder
      controller.setPlaceholder(placeholder)
    }, [controller, placeholder])

    useEffect(() => {
      const view = viewRef.current
      if (!view) {
        return
      }
      view.setProps({
        editable: () => !disabled,
        attributes: {
          ...editorAttributes({
            ariaActiveDescendant,
            ariaControls,
            ariaDescribedBy,
            ariaExpanded,
            ariaLabel,
            testId,
          }),
          class: editorClassName(className),
        },
      })
    }, [
      ariaActiveDescendant,
      ariaControls,
      ariaDescribedBy,
      ariaExpanded,
      ariaLabel,
      className,
      disabled,
      testId,
    ])

    return <div ref={mountRef} />
  },
)

function createEditorProps({
  getView,
  initialDoc,
  onStateUpdate,
  placeholder,
  propsRef,
}: {
  getView: () => EditorView | null
  initialDoc: ProseMirrorNode
  onStateUpdate: (state: EditorState) => void
  placeholder: string
  propsRef: MutableRefObject<{
    disabled?: boolean
    onChange: (snapshot: PromptEditorSnapshot) => void
    onDrop?: (event: DragEvent) => boolean
    onFocusChange?: (focused: boolean) => void
    onKeyDown?: (event: KeyboardEvent) => void
    onPaste?: (event: ClipboardEvent) => void
    placeholder: string
    selectedSlashCommand: ChatComposerSlashCommand | null
    slashCommands: ChatComposerSlashCommand[]
  }>
}): DirectEditorProps {
  return {
    state: EditorState.create({
      schema: promptEditorSchema,
      doc: initialDoc,
      plugins: [
        history(),
        keymap({
          'Mod-z': undo,
          'Mod-y': redo,
          'Mod-Shift-z': redo,
        }),
        keymap({
          'Shift-Enter': insertHardBreak,
        }),
        keymap(baseKeymap),
        placeholderPlugin(placeholder),
      ],
    }),
    editable: () => !propsRef.current.disabled,
    attributes: {
      'aria-multiline': 'true',
      'class': editorClassName(),
      'role': 'textbox',
    },
    dispatchTransaction(transaction: Transaction) {
      const view = getView()
      if (!view) {
        return
      }
      const nextState = view.state.apply(transaction)
      view.updateState(nextState)
      onStateUpdate(nextState)
      if (transaction.docChanged || transaction.selectionSet) {
        propsRef.current.onChange(
          readSnapshot(
            nextState,
            propsRef.current.slashCommands,
            propsRef.current.selectedSlashCommand,
          ),
        )
      }
    },
    handleDOMEvents: {
      blur() {
        propsRef.current.onFocusChange?.(false)
        return false
      },
      focus() {
        propsRef.current.onFocusChange?.(true)
        return false
      },
      keydown(_view, event) {
        propsRef.current.onKeyDown?.(event)
        return event.defaultPrevented
      },
    },
    handlePaste(_view, event) {
      propsRef.current.onPaste?.(event)
      return event.defaultPrevented
    },
    handleDrop(view, event) {
      return propsRef.current.onDrop?.(event) ?? false
    },
    nodeViews: {
      fileMention: createMentionNodeView,
      skillMention: createMentionNodeView,
      pluginMention: createMentionNodeView,
    },
  }
}

function attachPromptEditorDomAdapter(
  view: EditorView,
  propsRef: MutableRefObject<{
    disabled?: boolean
    onChange: (snapshot: PromptEditorSnapshot) => void
    onDrop?: (event: DragEvent) => boolean
    onFocusChange?: (focused: boolean) => void
    onKeyDown?: (event: KeyboardEvent) => void
    onPaste?: (event: ClipboardEvent) => void
    placeholder: string
    selectedSlashCommand: ChatComposerSlashCommand | null
    slashCommands: ChatComposerSlashCommand[]
  }>,
) {
  const dom = view.dom as HTMLElement & { value?: string }
  const valueDescriptor = Object.getOwnPropertyDescriptor(dom, 'value')
  let pendingDomValue: string | null = null

  Object.defineProperty(dom, 'value', {
    configurable: true,
    enumerable: valueDescriptor?.enumerable ?? false,
    get() {
      return pendingDomValue ?? serializePromptDoc(view.state.doc)
    },
    set(nextValue) {
      pendingDomValue = String(nextValue ?? '')
    },
  })

  const handleTextChange = (event: Event) => {
    if (event.target !== dom || pendingDomValue === null) {
      return
    }
    const nextValue = pendingDomValue
    pendingDomValue = null
    if (nextValue === serializePromptDoc(view.state.doc)) {
      return
    }
    setEditorText(view, nextValue)
  }

  const handlePasteCapture = (event: Event) => {
    const clipboardEvent = event as ClipboardEvent
    propsRef.current.onPaste?.(clipboardEvent)

    const clipboardData = clipboardEvent.clipboardData as
      | (DataTransfer & { getData?: unknown })
      | null
    if (
      clipboardEvent.defaultPrevented
      || !clipboardData
      || typeof clipboardData.getData !== 'function'
    ) {
      clipboardEvent.preventDefault()
      clipboardEvent.stopImmediatePropagation()
    }
  }

  dom.addEventListener('change', handleTextChange)
  dom.addEventListener('input', handleTextChange)
  dom.addEventListener('paste', handlePasteCapture, true)

  return () => {
    dom.removeEventListener('change', handleTextChange)
    dom.removeEventListener('input', handleTextChange)
    dom.removeEventListener('paste', handlePasteCapture, true)
    if (valueDescriptor) {
      Object.defineProperty(dom, 'value', valueDescriptor)
      return
    }
    delete dom.value
  }
}

function editorAttributes({
  ariaActiveDescendant,
  ariaControls,
  ariaDescribedBy,
  ariaExpanded,
  ariaLabel,
  testId,
}: {
  ariaActiveDescendant?: string
  ariaControls?: string
  ariaDescribedBy?: string
  ariaExpanded?: boolean
  ariaLabel: string
  testId: string
}): Record<string, string> {
  return {
    'aria-label': ariaLabel,
    'aria-multiline': 'true',
    'data-testid': testId,
    'role': 'textbox',
    ...(ariaActiveDescendant ? { 'aria-activedescendant': ariaActiveDescendant } : {}),
    ...(ariaControls ? { 'aria-controls': ariaControls } : {}),
    ...(ariaDescribedBy ? { 'aria-describedby': ariaDescribedBy } : {}),
    ...(ariaExpanded !== undefined ? { 'aria-expanded': ariaExpanded ? 'true' : 'false' } : {}),
  }
}

function editorClassName(className?: string) {
  return cn(
    'ProseMirror relative block w-full min-h-16 max-h-60 overflow-y-auto whitespace-pre-wrap break-words rounded-t-xl bg-transparent px-4 pt-3.5 pb-2 text-sm text-foreground outline-none transition-[color] duration-150',
    'focus-visible:outline-none [&_p]:m-0 [&_p+_p]:mt-1.5 [&_.is-empty:first-child::before]:pointer-events-none [&_.is-empty:first-child::before]:float-left [&_.is-empty:first-child::before]:h-0 [&_.is-empty:first-child::before]:text-muted-foreground/40 [&_.is-empty:first-child::before]:content-[attr(data-placeholder)]',
    className,
  )
}

function createPromptDoc(text: string, contextParts: ChatContextPart[] = []): ProseMirrorNode {
  const paragraphType = promptEditorSchema.nodes.paragraph
  const orderedContextParts = contextParts
    .map((part, index) => ({
      index,
      part,
      position: normalizeContextPartPosition(part, text.length),
    }))
    .sort((left, right) => left.position - right.position || left.index - right.index)

  let contextPartIndex = 0
  let paragraphStart = 0
  const paragraphs = text.split('\n').map((line) => {
    const paragraphEnd = paragraphStart + line.length
    const content: ProseMirrorNode[] = []
    let textCursor = paragraphStart

    while (
      contextPartIndex < orderedContextParts.length
      && orderedContextParts[contextPartIndex].position <= paragraphEnd
    ) {
      const item = orderedContextParts[contextPartIndex]
      appendTextNode(content, text.slice(textCursor, item.position))
      content.push(createContextPartMentionNode(item.part))
      textCursor = item.position
      contextPartIndex += 1
    }

    appendTextNode(content, text.slice(textCursor, paragraphEnd))
    paragraphStart = paragraphEnd + 1
    return content.length === 0
      ? paragraphType.create()
      : paragraphType.create(null, Fragment.fromArray(content))
  })
  return promptEditorSchema.nodes.doc.create(null, Fragment.fromArray(paragraphs))
}

function appendTextNode(content: ProseMirrorNode[], text: string) {
  if (text.length === 0) {
    return
  }
  content.push(promptEditorSchema.text(text))
}

function normalizeContextPartPosition(part: ChatContextPart, textLength: number): number {
  if (typeof part.position !== 'number' || !Number.isFinite(part.position)) {
    return textLength
  }
  return Math.max(0, Math.min(textLength, part.position))
}

function createContextPartMentionNode(part: ChatContextPart): ProseMirrorNode {
  if (part.type === 'data-cradle-plugin') {
    return promptEditorSchema.nodes.pluginMention.create({
      provider: part.provider ?? 'cradle',
      pluginName: part.pluginName,
      displayName: part.displayName,
      description: part.description,
      iconUrl: part.iconUrl ?? null,
      routeSegment: part.routeSegment,
      capabilities: part.capabilities,
      mcpServers: part.mcpServers,
      nativeMention: part.nativeMention ?? null,
    })
  }

  if (part.type === 'data-cradle-file-line-comment') {
    return promptEditorSchema.nodes.fileLineComment.create(part)
  }

  return promptEditorSchema.nodes.skillMention.create({
    name: part.name,
    displayName: part.name,
    path: part.path,
    description: part.description,
    scope: part.scope,
  })
}

function replaceEditorDoc(view: EditorView, doc: ProseMirrorNode) {
  const tr = view.state.tr.replaceWith(0, view.state.doc.content.size, doc.content.content)
  tr.setSelection(TextSelection.atEnd(tr.doc))
  view.dispatch(tr)
}

function setEditorDraft(view: EditorView, text: string, contextParts: ChatContextPart[]) {
  replaceEditorDoc(view, createPromptDoc(text, contextParts))
  view.focus()
}

function setEditorText(view: EditorView, text: string) {
  replaceEditorDoc(view, createPromptDoc(text))
  view.focus()
}

function appendPlainText(view: EditorView, text: string) {
  const insertion = text.trim()
  if (insertion.length === 0) {
    return
  }

  const endSelection = TextSelection.atEnd(view.state.doc)
  let tr = view.state.tr.setSelection(endSelection)
  const endPosition = tr.selection.from
  const textBefore = tr.doc.textBetween(
    Math.max(0, endPosition - 1),
    endPosition,
    '\n',
    TOKEN_LEAF_TEXT,
  )
  const prefix = textBefore.length > 0 && !/\s/.test(textBefore) ? ' ' : ''
  tr = tr.insertText(`${prefix}${insertion}`, endPosition)
  tr = tr.setSelection(TextSelection.create(tr.doc, endPosition + prefix.length + insertion.length))
  view.dispatch(tr)
  view.focus()
}

function replaceRangeWithInlineNode(
  view: EditorView,
  range: PromptEditorTriggerRange,
  node: ProseMirrorNode,
) {
  let tr = view.state.tr.replaceRangeWith(range.from, range.to, node)
  const afterNode = tr.mapping.map(range.from) + node.nodeSize
  const $after = tr.doc.resolve(afterNode)
  let needsSpace = true
  if ($after.parentOffset < $after.parent.content.size) {
    const next = $after.parent.childAfter($after.parentOffset).node
    const firstChar = next?.isText ? next.text?.[0] : undefined
    needsSpace = !firstChar || !/\s/.test(firstChar)
  }
  if (needsSpace) {
    tr = tr.insertText(' ', afterNode)
  }
  const selectionPos = afterNode + (needsSpace ? 1 : 0)
  tr = tr.setSelection(TextSelection.create(tr.doc, selectionPos))
  view.dispatch(tr)
  view.focus()
}

function createMentionNodeView(node: ProseMirrorNode): NodeView {
  const dom = document.createElement('span')
  const attrs
    = node.type.name === 'skillMention'
      ? skillMentionDomAttrs(node)
      : node.type.name === 'pluginMention'
        ? pluginMentionDomAttrs(node)
        : fileMentionDomAttrs(node)
  for (const [name, value] of Object.entries(attrs)) {
    dom.setAttribute(name, value)
  }
  if (
    node.type.name === 'pluginMention'
    && typeof node.attrs.iconUrl === 'string'
    && node.attrs.iconUrl.length > 0
  ) {
    const image = document.createElement('img')
    image.src = node.attrs.iconUrl
    image.alt = ''
    image.setAttribute('aria-hidden', 'true')
    image.className
      = 'size-3 shrink-0 rounded-sm object-cover ring-1 ring-black/10 dark:ring-white/10'
    dom.appendChild(image)
    dom.appendChild(
      document.createTextNode(`@${String(node.attrs.displayName || node.attrs.pluginName)}`),
    )
  }
 else {
    dom.textContent
      = node.type.name === 'skillMention'
        ? formatSkillMentionTokenLabel(String(node.attrs.displayName || node.attrs.name))
        : node.type.name === 'pluginMention'
          ? `@${String(node.attrs.displayName || node.attrs.pluginName)}`
          : String(node.attrs.label)
  }
  dom.contentEditable = 'false'

  return {
    dom,
    ignoreMutation: () => true,
    stopEvent: () => false,
  }
}

function fileMentionDomAttrs(node: ProseMirrorNode): Record<string, string> {
  return {
    'class':
      'inline-flex max-w-full items-center rounded-md bg-muted px-1.5 py-0.5 align-baseline text-[0.8125em] leading-none text-foreground ring-1 ring-border/50',
    'data-file-mention-label': String(node.attrs.label),
    'data-file-mention-path': String(node.attrs.path),
    'data-file-mention-type': String(node.attrs.type),
  }
}

function skillMentionDomAttrs(node: ProseMirrorNode): Record<string, string> {
  const text = String(node.attrs.displayName || node.attrs.name)
  return {
    'class': SKILL_MENTION_TOKEN_CLASS,
    'data-skill-mention-name': String(node.attrs.name),
    'data-skill-mention-display-name': text,
    'data-skill-mention-path': String(node.attrs.path),
    'data-skill-mention-description':
      typeof node.attrs.description === 'string' ? node.attrs.description : '',
    'data-skill-mention-scope': String(node.attrs.scope),
  }
}

function pluginMentionDomAttrs(node: ProseMirrorNode): Record<string, string> {
  const text = String(node.attrs.displayName || node.attrs.pluginName)
  return {
    'class':
      'inline-flex max-w-full items-center gap-1 rounded-md bg-primary/10 px-1.5 py-0.5 align-baseline text-[0.8125em] font-medium leading-none text-primary ring-1 ring-primary/15',
    'data-plugin-mention-provider': String(node.attrs.provider === 'codex' ? 'codex' : 'cradle'),
    'data-plugin-mention-name': String(node.attrs.pluginName),
    'data-plugin-mention-display-name': text,
    'data-plugin-mention-description':
      typeof node.attrs.description === 'string' ? node.attrs.description : '',
    'data-plugin-mention-icon-url':
      typeof node.attrs.iconUrl === 'string' ? node.attrs.iconUrl : '',
    'data-plugin-mention-route-segment': String(node.attrs.routeSegment),
    'data-plugin-mention-capabilities': JSON.stringify(node.attrs.capabilities ?? []),
    'data-plugin-mention-mcp-servers': JSON.stringify(node.attrs.mcpServers ?? []),
    'data-plugin-mention-native-mention': JSON.stringify(node.attrs.nativeMention ?? null),
  }
}

function readJsonAttribute<T>(element: HTMLElement, name: string, fallback: T): T {
  const raw = element.getAttribute(name)
  if (!raw) {
    return fallback
  }
  try {
    return JSON.parse(raw) as T
  }
 catch {
    return fallback
  }
}

function readSnapshot(
  state: EditorState,
  slashCommands: ChatComposerSlashCommand[],
  selectedSlashCommand: ChatComposerSlashCommand | null,
): PromptEditorSnapshot {
  const text = serializePromptDoc(state.doc)
  return {
    text,
    contextParts: readContextParts(state.doc),
    trigger: readActiveTrigger(state, text, slashCommands, selectedSlashCommand),
  }
}

export function serializePromptDoc(doc: ProseMirrorNode): string {
  const paragraphs: string[] = []
  doc.forEach((paragraph) => {
    let text = ''
    paragraph.forEach((node) => {
      if (node.isText) {
        text += node.text ?? ''
      }
 else if (node.type.name === 'fileMention') {
        text += `@${node.attrs.path}`
      }
 else if (node.type.name === 'skillMention') {
        text += ''
      }
 else if (node.type.name === 'pluginMention') {
        text += ''
      }
 else if (node.type.name === 'fileLineComment') {
        text += ''
      }
 else if (node.type.name === 'hardBreak') {
        text += '\n'
      }
    })
    paragraphs.push(text)
  })
  return paragraphs.join('\n')
}

export function readContextParts(doc: ProseMirrorNode): ChatContextPart[] {
  const parts: ChatContextPart[] = []
  let textOffset = 0

  doc.forEach((paragraph, paragraphOffset) => {
    if (paragraphOffset > 0) {
      textOffset += 1
    }

    paragraph.forEach((node) => {
      if (node.isText) {
        textOffset += node.text?.length ?? 0
        return
      }
      if (node.type.name === 'fileMention') {
        textOffset += `@${node.attrs.path}`.length
        return
      }
      if (node.type.name === 'hardBreak') {
        textOffset += 1
        return
      }
      if (node.type.name === 'pluginMention') {
        const part: ChatPluginContextPart = {
          type: 'data-cradle-plugin',
          provider: node.attrs.provider === 'codex' ? 'codex' : 'cradle',
          pluginName: String(node.attrs.pluginName),
          displayName: String(node.attrs.displayName || node.attrs.pluginName),
          description: typeof node.attrs.description === 'string' ? node.attrs.description : null,
          iconUrl: typeof node.attrs.iconUrl === 'string' ? node.attrs.iconUrl : null,
          routeSegment: String(node.attrs.routeSegment),
          capabilities: Array.isArray(node.attrs.capabilities) ? node.attrs.capabilities : [],
          mcpServers: Array.isArray(node.attrs.mcpServers) ? node.attrs.mcpServers : [],
          nativeMention: isPluginNativeMention(node.attrs.nativeMention)
            ? node.attrs.nativeMention
            : null,
          position: textOffset,
        }
        parts.push(part)
        return
      }
      if (node.type.name === 'fileLineComment') {
        const part: ChatFileLineCommentContextPart = {
          type: 'data-cradle-file-line-comment',
          workspaceId: String(node.attrs.workspaceId),
          path: String(node.attrs.path),
          lineStart: Number(node.attrs.lineStart),
          lineEnd: Number(node.attrs.lineEnd),
          comment: String(node.attrs.comment),
          position: textOffset,
        }
        parts.push(part)
        return
      }
      if (node.type.name !== 'skillMention') {
        return
      }
      const part: ChatSkillContextPart = {
        type: 'data-cradle-skill',
        name: String(node.attrs.name),
        path: String(node.attrs.path),
        scope: node.attrs.scope,
        description: typeof node.attrs.description === 'string' ? node.attrs.description : null,
        position: textOffset,
      }
      parts.push(part)
    })
  })
  return parts
}

function isPluginNativeMention(value: unknown): value is { name: string, path: string } {
  return Boolean(
    value
    && typeof value === 'object'
    && typeof (value as { name?: unknown }).name === 'string'
    && typeof (value as { path?: unknown }).path === 'string',
  )
}

function readActiveTrigger(
  state: EditorState,
  text: string,
  slashCommands: ChatComposerSlashCommand[],
  selectedSlashCommand: ChatComposerSlashCommand | null,
): PromptEditorTrigger {
  const { selection } = state
  if (!selection.empty || !selection.$from.parent.isTextblock) {
    return null
  }

  const $from = selection.$from
  const parentOffset = $from.parentOffset
  const textBefore = $from.parent.textBetween(0, parentOffset, '\n', TOKEN_LEAF_TEXT)

  if (slashCommands.length > 0 && $from.start() === 1 && SIMPLE_SLASH_RE.test(textBefore)) {
    const startInParent = textBefore.lastIndexOf('/')
    const query = textBefore.slice(startInParent + 1)
    return {
      kind: 'slash',
      query,
      range: {
        from: $from.start() + startInParent,
        to: selection.from,
      },
      selectedCommand: getActiveSlashCommand(text, selectedSlashCommand, slashCommands),
    }
  }

  const leafBoundaryIndex = textBefore.lastIndexOf(TOKEN_LEAF_TEXT)
  const triggerText = textBefore.slice(leafBoundaryIndex + 1)
  const triggerOffset = leafBoundaryIndex + 1

  const dollarIndex = triggerText.lastIndexOf('$')
  if (dollarIndex >= 0) {
    const afterDollar = triggerText.slice(dollarIndex + 1)
    if (!afterDollar.includes(' ') && !afterDollar.includes('\t')) {
      return {
        kind: 'skill',
        query: afterDollar,
        range: {
          from: $from.start() + triggerOffset + dollarIndex,
          to: selection.from,
        },
      }
    }
  }

  const atIndex = triggerText.lastIndexOf('@')
  if (atIndex >= 0) {
    const afterAt = triggerText.slice(atIndex + 1)
    if (/^\s/.test(afterAt)) {
      return null
    }
    return {
      kind: 'file',
      query: afterAt,
      range: {
        from: $from.start() + triggerOffset + atIndex,
        to: selection.from,
      },
    }
  }

  return null
}

function replaceRangeWithPlainText(
  view: EditorView,
  range: PromptEditorTriggerRange,
  text: string,
) {
  const tr = view.state.tr.insertText(text, range.from, range.to)
  tr.setSelection(TextSelection.create(tr.doc, range.from + text.length))
  view.dispatch(tr)
  view.focus()
}

const insertHardBreak: Command = (state, dispatch) => {
  const hardBreak = promptEditorSchema.nodes.hardBreak
  if (!hardBreak) {
    return false
  }
  if (dispatch) {
    dispatch(state.tr.replaceSelectionWith(hardBreak.create()).scrollIntoView())
  }
  return true
}

function placeholderPlugin(placeholder: string) {
  return new Plugin<{ placeholder: string }>({
    key: PLACEHOLDER_PLUGIN_KEY,
    state: {
      init: () => ({ placeholder }),
      apply(transaction, value) {
        const nextPlaceholder = transaction.getMeta(PLACEHOLDER_PLUGIN_KEY)?.placeholder
        return typeof nextPlaceholder === 'string' ? { placeholder: nextPlaceholder } : value
      },
    },
    props: {
      decorations(state) {
        const placeholderState = PLACEHOLDER_PLUGIN_KEY.getState(state)
        if (
          state.doc.childCount !== 1
          || !state.doc.firstChild?.isTextblock
          || state.doc.firstChild.content.size !== 0
        ) {
          return null
        }
        return DecorationSet.create(state.doc, [
          Decoration.node(0, state.doc.firstChild.nodeSize, {
            'data-placeholder': placeholderState?.placeholder ?? '',
            'class': 'is-empty',
          }),
        ])
      },
    },
  })
}
