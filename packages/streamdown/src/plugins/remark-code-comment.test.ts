import type { ComponentPropsWithoutRef, ComponentType } from 'react'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { MarkdownComponents } from 'react-markdown'
import { describe, expect, it } from 'vitest'

import { StaticRender } from '../static-render'
import { remarkCodeComment } from './remark-code-comment'

const DIRECTIVE
  = '::code-comment{title="Fix the test" body="It times out." file="/repo/a.test.ts" start="12" end="14" priority="P1"}'

type CodeCommentComponents = MarkdownComponents & {
  'code-comment': ComponentType<ComponentPropsWithoutRef<'div'> & {
    title?: string
    body?: string
    file?: string
    start?: string
    end?: string
    priority?: string
  }>
}

function render(content: string) {
  const seen: Array<Record<string, string | undefined>> = []
  const components = {
    'code-comment': (props) => {
      seen.push({
        title: props.title,
        body: props.body,
        file: props.file,
        start: props.start,
        end: props.end,
        priority: props.priority,
      })
      return createElement('div', { 'data-code-comment': '' }, props.title)
    },
  } satisfies CodeCommentComponents

  const markup = renderToStaticMarkup(createElement(StaticRender, {
    content,
    remarkPlugins: [remarkCodeComment],
    components,
  }))
  return { markup, seen }
}

describe('remarkCodeComment', () => {
  it('tokenizes complete directives into code-comment elements', () => {
    const { markup, seen } = render(`Found an issue.\n${DIRECTIVE}\nMore text.`)
    expect(markup).toContain('data-code-comment')
    expect(markup).toContain('Fix the test')
    expect(markup).toContain('Found an issue.')
    expect(markup).toContain('More text.')
    // hast/property-information treats HTML `start` as a number (ol.start).
    expect(seen).toEqual([{
      title: 'Fix the test',
      body: 'It times out.',
      file: '/repo/a.test.ts',
      start: 12,
      end: '14',
      priority: 'P1',
    }])
  })

  it('leaves incomplete or malformed directives as literal text', () => {
    expect(render('::code-comment{title="Still streaming').markup).not.toContain('data-code-comment')
    expect(render('::code-comment{title="unclosed}').markup).not.toContain('data-code-comment')
  })

  it('keeps attribute interiors opaque (escaped quotes and backticks)', () => {
    const { markup, seen } = render('::code-comment{title="say \\"hi\\"" body="fails in `provider.test.ts`"}')
    expect(markup).toContain('data-code-comment')
    expect(seen).toEqual([{
      title: 'say "hi"',
      body: 'fails in `provider.test.ts`',
      file: undefined,
      start: undefined,
      end: undefined,
      priority: undefined,
    }])
  })
})
