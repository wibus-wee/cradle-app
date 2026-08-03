import type { ComponentPropsWithoutRef, ComponentType } from 'react'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { MarkdownComponents } from 'react-markdown'
import { describe, expect, it } from 'vitest'

import { StaticRender } from '../static-render'
import { remarkCommitGroup } from './remark-commit-group'

const DIRECTIVE
  = '::commit-group{message="fix: resolve blob URLs" files="apps/web/a.tsx,apps/web/b.tsx" body="Chromium cannot render cradle-blob URLs."}'

const RETINA_DIRECTIVE
  = '::commit-group{message="feat(desktop): ship Cradle menubar tray template icons" files="apps/desktop/resources/tray/trayTemplate.png,apps/desktop/resources/tray/wendy.h@example.net,apps/desktop/scripts/generate-tray-icon.mjs" body="Generate and package Template PNGs for the macOS menu bar."}'

type CommitGroupComponents = MarkdownComponents & {
  'commit-group': ComponentType<ComponentPropsWithoutRef<'div'> & {
    message?: string
    files?: string
    body?: string
  }>
}

function render(content: string) {
  const seen: Array<Record<string, string | undefined>> = []
  const components = {
    'commit-group': ({ message, files, body }) => {
      seen.push({ message, files, body })
      return createElement('div', { 'data-commit-group': '' }, message)
    },
  } satisfies CommitGroupComponents

  const markup = renderToStaticMarkup(createElement(StaticRender, {
    content,
    remarkPlugins: [remarkCommitGroup],
    components,
  }))
  return { markup, seen }
}

describe('remarkCommitGroup', () => {
  it('tokenizes complete directives into commit-group elements', () => {
    const { markup, seen } = render(`Proposed commits.\n${DIRECTIVE}\nMore text.`)
    expect(markup).toContain('data-commit-group')
    expect(markup).toContain('fix: resolve blob URLs')
    expect(markup).toContain('Proposed commits.')
    expect(markup).toContain('More text.')
    expect(seen).toEqual([{
      message: 'fix: resolve blob URLs',
      files: 'apps/web/a.tsx,apps/web/b.tsx',
      body: 'Chromium cannot render cradle-blob URLs.',
    }])
  })

  it('keeps @2x filenames opaque against GFM email autolink', () => {
    const { markup, seen } = render(RETINA_DIRECTIVE)
    expect(markup).toContain('data-commit-group')
    expect(markup).not.toContain('::commit-group')
    expect(markup).not.toContain('mailto:')
    expect(seen[0]?.files).toBe(
      'apps/desktop/resources/tray/trayTemplate.png,apps/desktop/resources/tray/wendy.h@example.net,apps/desktop/scripts/generate-tray-icon.mjs',
    )
  })

  it('leaves incomplete or malformed directives as literal text', () => {
    const streaming = render('::commit-group{message="Still streaming')
    expect(streaming.markup).not.toContain('data-commit-group')
    expect(streaming.markup).toContain('::commit-group{message=')

    const unclosed = render('::commit-group{message="unclosed}')
    expect(unclosed.markup).not.toContain('data-commit-group')
    expect(unclosed.markup).toContain('::commit-group{message=')

    // Outside a complete directive, GFM email autolink still works.
    const email = render('email wendy.h@example.net please')
    expect(email.markup).toContain('mailto:')
    expect(email.seen).toEqual([])
  })

  it('coexists with code-comment dialect and preserves normal GFM', async () => {
    const { remarkCodeComment } = await import('./remark-code-comment')
    const seen: string[] = []
    const markup = renderToStaticMarkup(createElement(StaticRender, {
      content: [
        'Notes',
        '::commit-group{message="m" files="path/wendy.h@example.net" body="b"}',
        '::code-comment{title="t" body="body" file="f.ts" start="1" end="2" priority="P1"}',
        'email contact@example.com done',
      ].join('\n'),
      remarkPlugins: [remarkCodeComment, remarkCommitGroup],
      components: {
        'commit-group': ({ message, files }: { message?: string, files?: string }) => {
          seen.push(`cg:${message}:${files}`)
          return createElement('div', { 'data-commit-group': '' }, message)
        },
        'code-comment': ({ title }: { title?: string }) => {
          seen.push(`cc:${title}`)
          return createElement('div', { 'data-code-comment': '' }, title)
        },
      },
    }))
    expect(seen).toEqual([
      'cg:m:path/wendy.h@example.net',
      'cc:t',
    ])
    expect(markup).toContain('mailto:contact@example.com')
    expect(markup).toContain('Notes')
  })
})
