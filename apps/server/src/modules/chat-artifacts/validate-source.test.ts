import { describe, expect, it } from 'vitest'

import { assertValidArtifactSource } from './validate-source'

describe('assertValidArtifactSource', () => {
  it('accepts constrained cradle/artifact JSX', () => {
    expect(() => assertValidArtifactSource(`
import { Artifact, Header } from 'cradle/artifact'

export default function Demo() {
  return (
    <Artifact>
      <Header title="Hello" />
    </Artifact>
  )
}
`)).not.toThrow()
  })

  it('rejects disallowed imports', () => {
    expect(() => assertValidArtifactSource(`
import { Artifact } from 'cradle/artifact'
import { Button } from '~/components/ui/button'

export default function Demo() {
  return <Artifact title="x" />
}
`)).toThrow(/Disallowed import/)
  })

  it('rejects missing default export', () => {
    expect(() => assertValidArtifactSource(`
import { Artifact } from 'cradle/artifact'

export function Demo() {
  return <Artifact title="x" />
}
`)).toThrow(/export default/)
  })
})
