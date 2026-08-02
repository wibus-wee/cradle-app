import type { Root } from 'mdast'
import type { ComponentPropsWithoutRef, ComponentType } from 'react'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { MarkdownComponents } from 'react-markdown'
import { describe, expect, it } from 'vitest'

import { StaticRender } from '../static-render'
import { remarkCommitGroup } from './remark-commit-group'

function run(tree: Root) {
  remarkCommitGroup()(tree)
  return tree.children
}

function rootWithParagraph(text: string): Root {
  return {
    type: 'root',
    children: [{ type: 'paragraph', children: [{ type: 'text', value: text }] }],
  }
}

const DIRECTIVE
  = '::commit-group{message="fix: resolve blob URLs" files="apps/web/a.tsx,apps/web/b.tsx" body="Chromium cannot render cradle-blob URLs."}'

type CommitGroupComponents = MarkdownComponents & {
  'commit-group': ComponentType<ComponentPropsWithoutRef<'div'>>
}

const COMPONENTS = {
  'commit-group': ({ message }: ComponentPropsWithoutRef<'div'>) =>
    createElement('div', { 'data-commit-group': '' }, message),
} satisfies CommitGroupComponents

describe('remarkCommitGroup', () => {
  it('lifts complete directives while preserving surrounding prose', () => {
    const children = run(rootWithParagraph(`Proposed commits.\n${DIRECTIVE}\nMore text.`))
    expect(children.map(child => child.type)).toEqual(['paragraph', 'commit-group', 'paragraph'])
    expect(children[1]).toMatchObject({
      data: {
        hName: 'commit-group',
        hProperties: {
          message: 'fix: resolve blob URLs',
          files: 'apps/web/a.tsx,apps/web/b.tsx',
          body: 'Chromium cannot render cradle-blob URLs.',
        },
      },
    })
  })

  it('leaves incomplete or malformed directives as literal text', () => {
    expect(run(rootWithParagraph('::commit-group{message="Still streaming'))[0]?.type).toBe('paragraph')
    expect(run(rootWithParagraph('::commit-group{message="unclosed}'))[0]?.type).toBe('paragraph')
  })

  it('renders the transformed element through Streamdown after sanitization', () => {
    const markup = renderToStaticMarkup(createElement(StaticRender, {
      content: DIRECTIVE,
      remarkPlugins: [remarkCommitGroup],
      components: COMPONENTS,
    }))

    expect(markup).toContain('data-commit-group')
    expect(markup).toContain('fix: resolve blob URLs')
  })
})
