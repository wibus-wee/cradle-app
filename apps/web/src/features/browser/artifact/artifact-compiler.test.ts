import { describe, expect, it } from 'vitest'

import { ArtifactCompileError, compileArtifactSource } from './artifact-compiler'

describe('compileArtifactSource', () => {
  it('compiles a valid Artifact module', () => {
    const compiled = compileArtifactSource(`
import { Artifact, Header, Metrics } from 'cradle/artifact'

export default function Demo() {
  return (
    <Artifact>
      <Header eyebrow="Demo" title="Compiled" summary="ok" />
      <Metrics items={[{ label: 'A', value: '1' }]} />
    </Artifact>
  )
}
`)
    expect(typeof compiled.default).toBe('function')
  })

  it('resolves pre-redesign component names for persisted sources', () => {
    const compiled = compileArtifactSource(`
import { Artifact, MetricGrid, MetricCell, SegmentedBar } from 'cradle/artifact'

export default function Legacy() {
  return (
    <Artifact title="Legacy">
      <MetricGrid items={[{ label: 'A', value: '1', meta: 'x' }]} />
      <MetricCell label="B" value="2" />
      <SegmentedBar segments={[{ label: 'a', value: 1 }, { label: 'b', value: 2 }]} />
    </Artifact>
  )
}
`)
    expect(typeof compiled.default).toBe('function')
  })

  it('rejects disallowed imports', () => {
    expect(() => compileArtifactSource(`
import { Artifact } from 'cradle/artifact'
import fs from 'fs'

export default function Demo() {
  return <Artifact title="x" />
}
`)).toThrow(ArtifactCompileError)
  })
})
