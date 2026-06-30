import { describe, expect, it } from 'vitest'

import { formatForSlack, markdownToSlackMrkdwn } from '../src/slack-format.js'

describe('markdownToSlackMrkdwn', () => {
  it('converts headers to bold', () => {
    expect(markdownToSlackMrkdwn('# Title')).toBe('*Title*')
    expect(markdownToSlackMrkdwn('## Subtitle')).toBe('*Subtitle*')
    expect(markdownToSlackMrkdwn('### H3')).toBe('*H3*')
  })

  it('converts bold syntax', () => {
    expect(markdownToSlackMrkdwn('**bold text**')).toBe('*bold text*')
    expect(markdownToSlackMrkdwn('__also bold__')).toBe('*also bold*')
  })

  it('converts links', () => {
    expect(markdownToSlackMrkdwn('[Google](https://google.com)')).toBe('<https://google.com|Google>')
  })

  it('converts images to link with emoji', () => {
    expect(markdownToSlackMrkdwn('![screenshot](https://img.png)')).toBe('<https://img.png|📎 screenshot>')
  })

  it('converts strikethrough', () => {
    expect(markdownToSlackMrkdwn('~~deleted~~')).toBe('~deleted~')
  })

  it('preserves code blocks', () => {
    const input = '```\nconst x = 1\n```'
    expect(markdownToSlackMrkdwn(input)).toBe(input)
  })

  it('preserves inline code', () => {
    expect(markdownToSlackMrkdwn('use `npm install`')).toBe('use `npm install`')
  })

  it('handles mixed content', () => {
    const input = '# Review\n\n**Issue**: [link](https://url)\n\n- item 1\n- item 2'
    const expected = '*Review*\n\n*Issue*: <https://url|link>\n\n- item 1\n- item 2'
    expect(markdownToSlackMrkdwn(input)).toBe(expected)
  })

  it('does not pretend mrkdwn supports full markdown tables', () => {
    const input = [
      '| 文件 | 变更 |',
      '|------|------|',
      '| packages/db/src/schema/chat.ts | 新增 ptyStartedAt nullable 列 |',
      '| packages/db/drizzle/0007_condemned_blur.sql | ALTER TABLE 迁移 |',
      '| apps/server/src/modules/pty/service.ts | Claude CLI 自动 resume 逻辑 |',
    ].join('\n')

    expect(markdownToSlackMrkdwn(input)).toBe(input)
  })
})

describe('formatForSlack', () => {
  it('returns inline for short messages', () => {
    const result = formatForSlack('Hello world')
    expect(result.type).toBe('inline')
    if (result.type === 'inline') {
      expect(result.text).toBe('Hello world')
    }
  })

  it('returns split for long messages', () => {
    const longMessage = 'A'.repeat(4000)
    const result = formatForSlack(longMessage)
    expect(result.type).toBe('split')
    if (result.type === 'split') {
      expect(result.summary.length).toBeLessThan(3100)
      expect(result.full).toBe(longMessage)
      expect(result.summary).toContain('truncated')
      expect(result.continuation.length).toBeGreaterThan(0)
      expect(result.summary).toContain('continues in thread below')
      expect(result.continuation.join('')).toBe(longMessage.slice(result.summary.length - '\n\n_…message truncated. Full content continues in thread below._'.length))
    }
  })

  it('preserves markdown as-is', () => {
    const result = formatForSlack('**bold**')
    expect(result.type).toBe('inline')
    if (result.type === 'inline') {
      expect(result.text).toBe('**bold**')
    }
  })

  it('preserves markdown tables for markdown blocks', () => {
    const table = [
      '| 文件 | 变更 |',
      '|------|------|',
      '| a.ts | 新增字段 |',
    ].join('\n')

    const result = formatForSlack(table)
    expect(result.type).toBe('inline')
    if (result.type === 'inline') {
      expect(result.text).toBe(table)
    }
  })
})
