import type { Root } from 'mdast'
import type { ComponentPropsWithoutRef, ComponentType } from 'react'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { MarkdownComponents } from 'react-markdown'
import { describe, expect, it } from 'vitest'

import { StaticRender } from '../static-render'
import { remarkCodeComment } from './remark-code-comment'

function run(tree: Root) {
  remarkCodeComment()(tree)
  return tree.children
}

function rootWithParagraph(text: string): Root {
  return {
    type: 'root',
    children: [{ type: 'paragraph', children: [{ type: 'text', value: text }] }],
  }
}

const DIRECTIVE
  = '::code-comment{title="Fix the test" body="It times out." file="/repo/a.test.ts" start="12" end="14" priority="P1"}'

type CodeCommentComponents = MarkdownComponents & {
  'code-comment': ComponentType<ComponentPropsWithoutRef<'div'>>
}

const COMPONENTS = {
  'code-comment': ({ title }: ComponentPropsWithoutRef<'div'>) => createElement('div', { 'data-code-comment': '' }, title),
} satisfies CodeCommentComponents

describe('remarkCodeComment', () => {
  it('lifts complete directives while preserving surrounding prose', () => {
    const children = run(rootWithParagraph(`Found an issue.\n${DIRECTIVE}\nMore text.`))
    expect(children.map(child => child.type)).toEqual(['paragraph', 'code-comment', 'paragraph'])
    expect(children[1]).toMatchObject({
      data: {
        hName: 'code-comment',
        hProperties: {
          title: 'Fix the test',
          body: 'It times out.',
          file: '/repo/a.test.ts',
          start: '12',
          end: '14',
          priority: 'P1',
        },
      },
    })
  })

  it('leaves incomplete or malformed directives as literal text', () => {
    expect(run(rootWithParagraph('::code-comment{title="Still streaming'))[0]?.type).toBe('paragraph')
    expect(run(rootWithParagraph('::code-comment{title="unclosed}'))[0]?.type).toBe('paragraph')
  })

  it('restores inline code and escaped quotes in directive attributes', () => {
    const tree: Root = {
      type: 'root',
      children: [{
        type: 'paragraph',
        children: [
          { type: 'text', value: '::code-comment{title="say \\"hi\\"" body="fails in ' },
          { type: 'inlineCode', value: 'provider.test.ts' },
          { type: 'text', value: '"}' },
        ],
      }],
    }

    expect(run(tree)[0]).toMatchObject({
      data: {
        hProperties: {
          title: 'say "hi"',
          body: 'fails in `provider.test.ts`',
        },
      },
    })
  })

  it('renders the transformed element through Streamdown after sanitization', () => {
    const markup = renderToStaticMarkup(createElement(StaticRender, {
      content: DIRECTIVE,
      remarkPlugins: [remarkCodeComment],
      components: COMPONENTS,
    }))

    expect(markup).toContain('data-code-comment')
    expect(markup).toContain('Fix the test')
  })
})
