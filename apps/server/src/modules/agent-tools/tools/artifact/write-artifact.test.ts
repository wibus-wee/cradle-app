import { describe, expect, it, vi } from 'vitest'

import { executeWriteArtifactTool } from './write-artifact'

describe('executeWriteArtifactTool', () => {
  it('fails closed without a bound chat session', async () => {
    vi.stubEnv('CRADLE_CHAT_SESSION_ID', '')
    const result = await executeWriteArtifactTool({
      title: 'Demo',
      source: `import { Artifact } from 'cradle/artifact'\nexport default function A() { return <Artifact title="x" /> }`,
    })
    expect(result.isError).toBe(true)
  })
})
