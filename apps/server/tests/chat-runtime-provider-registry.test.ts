import fs, { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { resolveRuntimeSkillPaths } from '../src/modules/chat-runtime/chat-runtime-provider-registry'

const tempDirs: string[] = []

function createWorkspaceWithSkill(): string {
  const workspacePath = mkdtempSync(join(tmpdir(), 'cradle-runtime-skills-'))
  tempDirs.push(workspacePath)
  const skillPath = join(workspacePath, '.cradle', 'skills', 'review')
  mkdirSync(skillPath, { recursive: true })
  writeFileSync(join(skillPath, 'SKILL.md'), '# Review\n')
  return workspacePath
}

afterEach(() => {
  vi.restoreAllMocks()
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('resolveRuntimeSkillPaths', () => {
  it('caches workspace skill path discovery for concurrent chat turn startup', () => {
    const workspacePath = createWorkspaceWithSkill()
    const readdirSpy = vi.spyOn(fs, 'readdirSync')

    const first = resolveRuntimeSkillPaths(workspacePath)
    const second = resolveRuntimeSkillPaths(workspacePath)
    const third = resolveRuntimeSkillPaths(workspacePath)

    expect(first).toEqual(expect.arrayContaining([join(workspacePath, '.cradle', 'skills', 'review')]))
    expect(second).toEqual(first)
    expect(third).toEqual(first)
    expect(readdirSpy.mock.calls.length).toBeLessThanOrEqual(2)
  })
})
