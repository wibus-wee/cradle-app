import { describe, expect, it } from 'vitest'

import { ArtifactCompileError, compileArtifactSource } from './artifact-compiler'

describe('compileArtifactSource', () => {
  it('compiles a valid Artifact module', () => {
    const compiled = compileArtifactSource(`
import { Artifact, Header, MetricGrid } from 'cradle/artifact'

export default function Demo() {
  return (
    <Artifact>
      <Header eyebrow="Demo" title="Compiled" summary="ok" />
      <MetricGrid items={[{ label: 'A', value: '1' }]} />
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
