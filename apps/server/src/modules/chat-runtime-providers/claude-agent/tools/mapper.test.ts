import { describe, expect, it } from 'vitest'

import { classifyClaudeCodeToolKind } from './mapper'

describe('classifyClaudeCodeToolKind', () => {
  it('classifies mcp__cradle__write_artifact as artifact', () => {
    expect(classifyClaudeCodeToolKind('mcp__cradle__write_artifact')).toBe('artifact')
  })

  it('classifies bare and alternate write_artifact names as artifact', () => {
    expect(classifyClaudeCodeToolKind('write_artifact')).toBe('artifact')
    expect(classifyClaudeCodeToolKind('cradle/write_artifact')).toBe('artifact')
  })

  it('keeps unrelated MCP tools as mcp', () => {
    expect(classifyClaudeCodeToolKind('mcp__cradle__manage_pull_request')).toBe('mcp')
    expect(classifyClaudeCodeToolKind('mcp__other__tool')).toBe('mcp')
  })

  it('keeps built-in Claude tools on their existing kinds', () => {
    expect(classifyClaudeCodeToolKind('Bash')).toBe('terminal')
    expect(classifyClaudeCodeToolKind('Read')).toBe('file-read')
    expect(classifyClaudeCodeToolKind('Write')).toBe('file-diff')
  })
})
