import { describe, expect, it } from 'vitest'

import { readArtifactToolRecord } from './artifact-tool-payload'

describe('readArtifactToolRecord', () => {
  it('reads metadata from nested structured content', () => {
    expect(readArtifactToolRecord({
      server: 'cradle',
      structuredContent: {
        artifactId: 'artifact-1',
        sessionId: 'session-1',
        title: 'Overview',
        revision: 2,
      },
    })).toEqual({
      artifactId: 'artifact-1',
      sessionId: 'session-1',
      title: 'Overview',
      source: undefined,
      revision: 2,
    })
  })

  it('reads source from write_artifact input without an artifact id', () => {
    expect(readArtifactToolRecord({
      title: 'Overview',
      source: 'export default function Overview() {}',
    })).toMatchObject({
      title: 'Overview',
      source: 'export default function Overview() {}',
    })
  })

  it('reads metadata encoded in MCP text content', () => {
    expect(readArtifactToolRecord({
      content: [{
        type: 'text',
        text: JSON.stringify({ artifactId: 'artifact-1', revision: 1 }),
      }],
    })).toMatchObject({ artifactId: 'artifact-1', revision: 1 })
  })
})
