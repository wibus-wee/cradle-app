import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const repositoryRoot = resolve(import.meta.dirname, '../../../../../../..')

async function workflow(name: string): Promise<string> {
  return await readFile(resolve(repositoryRoot, '.github/workflows', name), 'utf8')
}

describe('m0 evidence workflows', () => {
  it('runs Linux development and packaged modes independently and always retains hidden evidence', async () => {
    const contents = await workflow('ci.yml')
    const developmentIndex = contents.indexOf('name: Run development custom-scheme gate')
    const packagedIndex = contents.indexOf('name: Run packaged custom-scheme gate')
    const uploadIndex = contents.indexOf('name: Upload M0 evidence')

    expect(developmentIndex).toBeGreaterThan(-1)
    expect(packagedIndex).toBeGreaterThan(developmentIndex)
    expect(uploadIndex).toBeGreaterThan(packagedIndex)
    expect(contents.slice(developmentIndex, packagedIndex)).toContain('m0:custom-scheme:dev')
    expect(contents.slice(developmentIndex, packagedIndex)).not.toContain('continue-on-error')
    expect(contents.slice(packagedIndex, uploadIndex)).toContain('if: always()')
    expect(contents.slice(packagedIndex, uploadIndex)).toContain('m0:custom-scheme:packaged')
    expect(contents.slice(uploadIndex, contents.indexOf('\n  #', uploadIndex))).toContain('if: always()')
    expect(contents.slice(uploadIndex, contents.indexOf('\n  #', uploadIndex))).toContain('if-no-files-found: error')
    expect(contents.slice(uploadIndex, contents.indexOf('\n  #', uploadIndex))).toContain('include-hidden-files: true')
  })

  it.each([
    'verify-windows-desktop-package.yml',
    'release-desktop.yml',
  ])('%s retains hidden M0 evidence on success and failure', async (name) => {
    const contents = await workflow(name)
    const uploadName = name === 'release-desktop.yml'
      ? '- name: Upload Windows M0 evidence'
      : '- name: Upload Windows package artifacts'
    const uploadIndex = contents.indexOf(uploadName)
    const nextStepIndex = contents.indexOf('\n      - name:', uploadIndex + uploadName.length)
    const uploadStep = contents.slice(uploadIndex, nextStepIndex === -1 ? undefined : nextStepIndex)
    expect(uploadIndex).toBeGreaterThan(-1)
    expect(uploadStep).toContain('if: always()')
    expect(uploadStep).toContain('include-hidden-files: true')
    expect(uploadStep).toContain('apps/desktop/.m0-results/**')
    if (name === 'release-desktop.yml') { expect(uploadStep).toContain('if-no-files-found: error') }
  })
})
