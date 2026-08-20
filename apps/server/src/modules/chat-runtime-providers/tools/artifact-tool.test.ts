import { describe, expect, it } from 'vitest'

import { isCradleWriteArtifactToolName } from './artifact-tool'

describe('isCradleWriteArtifactToolName', () => {
  it('matches Claude MCP naming', () => {
    expect(isCradleWriteArtifactToolName('mcp__cradle__write_artifact')).toBe(true)
  })

  it('matches Codex server/tool naming', () => {
    expect(isCradleWriteArtifactToolName('cradle/write_artifact')).toBe(true)
  })

  it('matches bare tool name', () => {
    expect(isCradleWriteArtifactToolName('write_artifact')).toBe(true)
  })

  it('rejects unrelated tools', () => {
    expect(isCradleWriteArtifactToolName('mcp__cradle__manage_pull_request')).toBe(false)
    expect(isCradleWriteArtifactToolName('Bash')).toBe(false)
  })
})
