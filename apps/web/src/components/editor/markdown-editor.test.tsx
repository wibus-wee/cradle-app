import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Editor } from '@tiptap/core'
import Link from '@tiptap/extension-link'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from 'tiptap-markdown'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { MarkdownEditor } from './markdown-editor'
import { SmartMention } from './smart-mention'

afterEach(() => {
  cleanup()
})

describe('markdown editor', () => {
  it('mounts slash commands and Smart Mention suggestions with distinct plugin keys', () => {
    expect(() => {
      render(
        <MarkdownEditor
          content=""
          readonly
          smartMentions={{ getItems: vi.fn(() => []) }}
        />,
      )
    }).not.toThrow()
  })

  it('restores cradle mention links as Smart Mention nodes and serializes readable Markdown', () => {
    const editor = new Editor({
      extensions: [
        StarterKit.configure({
          link: false,
        }),
        Markdown.configure({
          html: true,
        }),
        Link.configure({
          openOnClick: false,
        }),
        SmartMention.configure({
          getItems: () => [],
        }),
      ],
      content: 'See [[CRA-007] Smart mentions](cradle://mention/issue/issue-1?label=CRA-007&title=Smart+mentions&detail=Todo+%C2%B7+high&workspaceId=workspace-1).',
    })

    try {
      const doc = editor.getJSON()
      const paragraph = doc.content?.[0]
      const mention = paragraph?.content?.find(node => node.type === 'smartMention')

      expect(mention).toMatchObject({
        type: 'smartMention',
        attrs: {
          kind: 'issue',
          id: 'issue-1',
          label: 'CRA-007',
          title: 'Smart mentions',
          detail: 'Todo · high',
          workspaceId: 'workspace-1',
        },
      })

      const storage = editor.storage as unknown as { markdown: { getMarkdown: () => string } }
      const markdown = storage.markdown.getMarkdown()

      expect(markdown).toContain('[[CRA-007] Smart mentions](cradle://mention/issue/issue-1?label=CRA-007&title=Smart+mentions&detail=Todo+%C2%B7+high&workspaceId=workspace-1)')
    }
    finally {
      editor.destroy()
    }
  })

  it('renders restored Smart Mention nodes as interactive chips with hover previews', async () => {
    const handleOpen = vi.fn()

    render(
      <MarkdownEditor
        content="See [[CRA-007] Smart mentions](cradle://mention/issue/issue-1?label=CRA-007&title=Smart+mentions&detail=Todo+%C2%B7+high&workspaceId=workspace-1)."
        readonly
        smartMentions={{
          getItems: () => [],
          onOpen: handleOpen,
        }}
      />,
    )

    const mention = await screen.findByRole('button', { name: 'CRA-007' })

    fireEvent.mouseEnter(mention)
    expect(await screen.findByText('Issue')).not.toBeNull()
    expect(screen.getByText('Smart mentions')).not.toBeNull()
    expect(screen.getByText('Todo · high')).not.toBeNull()

    fireEvent.click(mention)
    expect(handleOpen).toHaveBeenCalledWith({
      kind: 'issue',
      id: 'issue-1',
      label: 'CRA-007',
      title: 'Smart mentions',
      detail: 'Todo · high',
      workspaceId: 'workspace-1',
    })
  })
})
