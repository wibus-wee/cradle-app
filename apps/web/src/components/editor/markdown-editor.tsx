import { PicLine as PicIcon } from '@mingcute/react'
import type { Editor } from '@tiptap/core'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import TaskItem from '@tiptap/extension-task-item'
import TaskList from '@tiptap/extension-task-list'
import Typography from '@tiptap/extension-typography'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Markdown } from 'tiptap-markdown'

import { toastManager } from '~/components/ui/toast'
import { withAssetDisplaySize } from '~/features/assets/asset-url'
import { getI18n } from '~/i18n/instance'
import { cn } from '~/lib/cn'

import { AssetImage } from './asset-image-extension'
import { EditorBubbleMenu } from './editor-bubble-menu'
import { HeadingWithId } from './heading-with-id'
import { LinkCardExtension } from './link-card-extension'
import { ShikiCodeBlock } from './shiki-code-block'
import { SlashCommand } from './slash-command'
import { SmartMention } from './smart-mention'
import type { SmartMentionAttrs, SmartMentionItem } from './smart-mention-utils'

function getMarkdownContent(storage: unknown): string {
  const s = storage as { markdown: { getMarkdown: () => string } }
  return s.markdown.getMarkdown()
}

const EDITOR_IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp'
const EDITOR_IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])

function collectEditorImageFiles(files: FileList | File[] | null | undefined): File[] {
  if (!files) {
    return []
  }
  return Array.from(files).filter(file => EDITOR_IMAGE_MIME_TYPES.has(file.type))
}

interface MarkdownEditorProps {
  content: string | null
  documentId?: string
  onChange?: (markdown: string) => void
  onSave?: (markdown: string) => void | Promise<void>
  saveOnBlur?: boolean
  readonly?: boolean
  placeholder?: string
  className?: string
  smartMentions?: {
    getItems: (query: string) => SmartMentionItem[] | Promise<SmartMentionItem[]>
    onOpen?: (attrs: SmartMentionAttrs) => void
  }
  assetImages?: {
    upload: (file: File) => Promise<{
      id: string
      filename: string
      markdownUrl: string
      width?: number | null
      height?: number | null
    }>
  }
}

export function MarkdownEditor({
  content,
  documentId,
  onChange,
  onSave,
  saveOnBlur = true,
  readonly = false,
  placeholder,
  className,
  smartMentions,
  assetImages,
}: MarkdownEditorProps) {
  const resolvedPlaceholder = placeholder ?? getI18n().t('common:markdownEditor.placeholder')
  const onSaveRef = useRef(onSave)
  const onChangeRef = useRef(onChange)
  const readonlyRef = useRef(readonly)
  const documentIdRef = useRef(documentId)
  const confirmedContentRef = useRef(content ?? '')
  const saveRequestRef = useRef(0)
  const smartMentionsRef = useRef(smartMentions)
  const assetImagesRef = useRef(assetImages)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const [isUploadingAssetImage, setUploadingAssetImage] = useState(false)

  useEffect(() => {
    onSaveRef.current = onSave
  }, [onSave])

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  useEffect(() => {
    readonlyRef.current = readonly
  }, [readonly])

  useEffect(() => {
    smartMentionsRef.current = smartMentions
  }, [smartMentions])

  useEffect(() => {
    assetImagesRef.current = assetImages
  }, [assetImages])

  const smartMentionsEnabled = !!smartMentions

  const saveCurrentDraft = useCallback((currentEditor: Editor, options: { force?: boolean } = {}) => {
    if (readonlyRef.current || !onSaveRef.current) {
      return
    }

    const md = getMarkdownContent(currentEditor.storage)
    if (!options.force && md === confirmedContentRef.current) {
      return
    }

    const requestId = saveRequestRef.current + 1
    saveRequestRef.current = requestId

    try {
      const result = onSaveRef.current(md)
      void Promise.resolve(result)
        .then(() => {
          if (saveRequestRef.current === requestId) {
            confirmedContentRef.current = md
          }
        })
        .catch(() => {})
    }
    catch {
      // Keep the previous confirmed snapshot so later refreshes do not treat a failed write as saved.
    }
  }, [])

  const insertAssetImages = useCallback(async (currentEditor: Editor, files: File[]) => {
    const uploader = assetImagesRef.current
    if (!uploader || readonlyRef.current || files.length === 0) {
      return
    }

    setUploadingAssetImage(true)
    try {
      for (const file of files) {
        const asset = await uploader.upload(file)
        const markdownUrl = withAssetDisplaySize(asset.markdownUrl, {
          width: asset.width,
          height: asset.height,
        })
        currentEditor
          .chain()
          .focus()
          .setImage({
            src: markdownUrl,
            alt: asset.filename,
            width: asset.width ?? undefined,
            height: asset.height ?? undefined,
          })
          .run()
      }
    }
    catch (error) {
      console.error('[MarkdownEditor] failed to upload image asset:', error)
      toastManager.add({
        type: 'error',
        title: 'Image upload failed',
        description: error instanceof Error ? error.message : 'Could not upload image asset.',
      })
    }
    finally {
      setUploadingAssetImage(false)
    }
  }, [])

  const handleAssetImageFiles = useCallback((currentEditor: Editor, files: FileList | File[] | null | undefined) => {
    if (readonlyRef.current || !assetImagesRef.current) {
      return false
    }

    const imageFiles = collectEditorImageFiles(files)
    if (imageFiles.length === 0) {
      return false
    }

    void insertAssetImages(currentEditor, imageFiles)
    return true
  }, [insertAssetImages])

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        codeBlock: false,
        heading: false,
        link: false,
      }),
      HeadingWithId,
      Markdown.configure({
        html: true,
        transformCopiedText: true,
        transformPastedText: true,
      }),
      Placeholder.configure({
        placeholder: resolvedPlaceholder,
        emptyEditorClass: 'is-editor-empty',
      }),
      Typography,
      TaskList,
      TaskItem.configure({ nested: true }),
      ShikiCodeBlock,
      Link.configure({
        openOnClick: false,
        autolink: true,
      }),
      LinkCardExtension,
      AssetImage.configure({
        resize: {
          enabled: true,
          directions: ['bottom-left', 'bottom-right', 'top-left', 'top-right'],
          minWidth: 96,
          minHeight: 48,
          alwaysPreserveAspectRatio: true,
        },
      }),
      SlashCommand,
      ...(smartMentionsEnabled
        ? [
            SmartMention.configure({
              getItems: (query: string) => smartMentionsRef.current?.getItems(query) ?? [],
              onOpen: (attrs: SmartMentionAttrs) => smartMentionsRef.current?.onOpen?.(attrs),
            }),
          ]
        : []),
    ],
    content: content ?? '',
    editable: !readonly,
    editorProps: {
      attributes: {
        class: 'outline-none min-h-48',
      },
    },
    // Auto-save on blur
    onBlur: ({ editor: e }) => {
      if (saveOnBlur) {
        saveCurrentDraft(e)
      }
    },
    onUpdate: ({ editor: e }) => {
      if (!readonlyRef.current) {
        onChangeRef.current?.(getMarkdownContent(e.storage))
      }
    },
  }, [resolvedPlaceholder, saveCurrentDraft, saveOnBlur, smartMentionsEnabled])

  useEffect(() => {
    editor?.setEditable(!readonly)
  }, [editor, readonly, saveCurrentDraft])

  useEffect(() => {
    if (!editor) {
      return
    }

    const nextContent = content ?? ''
    const currentContent = getMarkdownContent(editor.storage)
    const documentChanged = documentIdRef.current !== documentId
    const hasLocalEdits = currentContent !== confirmedContentRef.current

    if (documentChanged) {
      documentIdRef.current = documentId
      confirmedContentRef.current = nextContent
      if (currentContent !== nextContent) {
        editor.commands.setContent(nextContent)
      }
      return
    }

    if (nextContent === confirmedContentRef.current) {
      return
    }

    if (hasLocalEdits) {
      return
    }

    confirmedContentRef.current = nextContent
    if (currentContent !== nextContent) {
      editor.commands.setContent(nextContent)
    }
  }, [content, documentId, editor])

  // Keyboard shortcut: Cmd+S to save
  useEffect(() => {
    if (!editor || readonly) {
      return
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        (e.metaKey || e.ctrlKey)
        && e.key.toLowerCase() === 's'
        && (editor.isFocused || editor.view.dom.contains(document.activeElement))
      ) {
        e.preventDefault()
        saveCurrentDraft(editor, { force: true })
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [editor, readonly, saveCurrentDraft])

  return (
    <div className={cn('tiptap-editor', className)}>
      {editor && !readonly && <EditorBubbleMenu editor={editor} />}
      {editor && assetImages && !readonly && (
        <div className="mb-1.5 flex justify-end">
          <input
            ref={imageInputRef}
            type="file"
            accept={EDITOR_IMAGE_ACCEPT}
            multiple
            className="hidden"
            onChange={(event) => {
              handleAssetImageFiles(editor, event.currentTarget.files)
              event.currentTarget.value = ''
            }}
          />
          <button
            type="button"
            aria-label="Insert image"
            title="Insert image"
            disabled={isUploadingAssetImage}
            onClick={() => imageInputRef.current?.click()}
            className={cn(
              'flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors',
              'hover:bg-accent/50 hover:text-foreground disabled:pointer-events-none disabled:opacity-50',
            )}
          >
            <PicIcon className="size-3.5" aria-hidden="true" />
          </button>
        </div>
      )}
      <EditorContent
        editor={editor}
        onPaste={(event) => {
          if (editor && handleAssetImageFiles(editor, event.clipboardData.files)) {
            event.preventDefault()
          }
        }}
        onDrop={(event) => {
          if (editor && handleAssetImageFiles(editor, event.dataTransfer.files)) {
            event.preventDefault()
          }
        }}
        className={cn(
          'prose prose-neutral dark:prose-invert max-w-none',
          'prose-headings:font-heading prose-headings:tracking-tight',
          'prose-h1:text-2xl prose-h1:font-semibold prose-h1:mb-4',
          'prose-h2:text-xl prose-h2:font-semibold prose-h2:mb-3 prose-h2:mt-8',
          'prose-h3:text-lg prose-h3:font-medium prose-h3:mb-2 prose-h3:mt-6',
          'prose-p:leading-[1.75] prose-p:text-[15px]',
          'prose-code:text-[13px] prose-code:font-mono',
          'prose-pre:bg-muted prose-pre:rounded-lg prose-pre:border prose-pre:border-border',
          'prose-a:text-foreground prose-a:underline prose-a:underline-offset-4 prose-a:decoration-border hover:prose-a:decoration-foreground',
          'prose-img:rounded-lg prose-img:border prose-img:border-border',
          'prose-li:text-[15px]',
          '[&_.is-editor-empty:first-child::before]:text-muted-foreground/40 [&_.is-editor-empty:first-child::before]:content-[attr(data-placeholder)] [&_.is-editor-empty:first-child::before]:float-left [&_.is-editor-empty:first-child::before]:h-0 [&_.is-editor-empty:first-child::before]:pointer-events-none',
        )}
      />
    </div>
  )
}
