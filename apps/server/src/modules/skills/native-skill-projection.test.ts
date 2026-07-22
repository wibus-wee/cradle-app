import fs from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import type { NativeSkillProjectionSource, NativeSkillProjectionTarget } from './native-skill-projection'
import {
  projectNativeSkill,
  reconcileNativeSkillProjections,
  removeNativeSkillProjection,
  resetNativeSkillProjectionTargets,
  resolveNativeSkillProjectionPath,
} from './native-skill-projection'

let tempDir: string | undefined

async function createTempDir(): Promise<string> {
  tempDir = await mkdtemp(path.join(tmpdir(), 'cradle-native-skill-projection-'))
  return tempDir
}

async function createSkillPackage(root: string, name = 'cradle-plugin-demo'): Promise<string> {
  const skillDir = path.join(root, name)
  fs.mkdirSync(path.join(skillDir, 'references'), { recursive: true })
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), [
    '---',
    `name: ${name}`,
    'description: Demo skill',
    '---',
    '',
    '# Demo',
  ].join('\n'))
  fs.writeFileSync(path.join(skillDir, 'references', 'guide.md'), '# Guide')
  return skillDir
}

function source(
  skillDir: string,
  skillName = 'cradle-plugin-demo',
  sourceKind: NativeSkillProjectionSource['sourceKind'] = 'plugin',
): NativeSkillProjectionSource {
  return {
    sourceKind,
    skillName,
    skillFile: path.join(skillDir, 'SKILL.md'),
  }
}

function target(skillRoot: string, layout: NativeSkillProjectionTarget['layout']): NativeSkillProjectionTarget {
  return {
    id: `${layout}:${skillRoot}`,
    skillRoot,
    layout,
  }
}

describe('native skill projection', () => {
  afterEach(async () => {
    resetNativeSkillProjectionTargets()
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true })
      tempDir = undefined
    }
  })

  it('projects a full skill package into the nested cradle namespace using the skill name', async () => {
    const root = await createTempDir()
    const skillDir = await createSkillPackage(root)
    const skillRoot = path.join(root, 'native-skills')
    const projectionTarget = target(skillRoot, 'nested')

    const projectionPath = projectNativeSkill(projectionTarget, source(skillDir))

    expect(projectionPath).toBe(path.join(skillRoot, 'cradle', 'cradle-plugin-demo'))
    expect(fs.existsSync(path.join(projectionPath, 'SKILL.md'))).toBe(true)
    expect(fs.readFileSync(path.join(projectionPath, 'references', 'guide.md'), 'utf8')).toBe('# Guide')
    expect(fs.lstatSync(projectionPath).isSymbolicLink()).toBe(true)
  })

  it('projects a full skill package into the flat root using the skill name as basename', async () => {
    const root = await createTempDir()
    const skillDir = await createSkillPackage(root)
    const skillRoot = path.join(root, 'native-skills')
    const projectionTarget = target(skillRoot, 'flat')

    const projectionPath = projectNativeSkill(projectionTarget, source(skillDir))

    // basename === skill name so Claude /skill invoke ids match Cradle inventory
    expect(projectionPath).toBe(path.join(skillRoot, 'cradle-plugin-demo'))
    expect(fs.existsSync(path.join(projectionPath, 'SKILL.md'))).toBe(true)
    expect(fs.readFileSync(path.join(projectionPath, 'references', 'guide.md'), 'utf8')).toBe('# Guide')
  })

  it('projects builtin skills under their true names without stacking cradle-', async () => {
    const root = await createTempDir()
    const skillDir = await createSkillPackage(root, 'cradle-cli')
    const skillRoot = path.join(root, 'native-skills')
    const projectionTarget = target(skillRoot, 'flat')

    const projectionPath = projectNativeSkill(
      projectionTarget,
      source(skillDir, 'cradle-cli', 'builtin'),
    )

    expect(projectionPath).toBe(path.join(skillRoot, 'cradle-cli'))
  })

  it('does not overwrite an existing non-symlink target path', async () => {
    const root = await createTempDir()
    const skillDir = await createSkillPackage(root)
    const skillRoot = path.join(root, 'native-skills')
    const projectionTarget = target(skillRoot, 'nested')
    const projectionPath = resolveNativeSkillProjectionPath(projectionTarget, source(skillDir))
    fs.mkdirSync(projectionPath, { recursive: true })
    fs.writeFileSync(path.join(projectionPath, 'sentinel.txt'), 'keep')

    expect(() => projectNativeSkill(projectionTarget, source(skillDir))).toThrow(
      `Native skill projection conflict at ${projectionPath}`,
    )
    expect(fs.readFileSync(path.join(projectionPath, 'sentinel.txt'), 'utf8')).toBe('keep')
  })

  it('removes stale Cradle projection symlinks during reconciliation', async () => {
    const root = await createTempDir()
    const firstSkillDir = await createSkillPackage(root, 'cradle-plugin-first')
    const secondSkillDir = await createSkillPackage(root, 'cradle-plugin-second')
    const projectionTarget = target(path.join(root, 'native-skills'), 'nested')
    const firstSource = source(firstSkillDir, 'cradle-plugin-first')
    const secondSource = source(secondSkillDir, 'cradle-plugin-second')

    reconcileNativeSkillProjections([firstSource, secondSource], [projectionTarget])
    expect(fs.existsSync(resolveNativeSkillProjectionPath(projectionTarget, firstSource))).toBe(true)
    expect(fs.existsSync(resolveNativeSkillProjectionPath(projectionTarget, secondSource))).toBe(true)

    const result = reconcileNativeSkillProjections([secondSource], [projectionTarget])

    expect(result.errors).toEqual([])
    expect(fs.existsSync(resolveNativeSkillProjectionPath(projectionTarget, firstSource))).toBe(false)
    expect(fs.existsSync(resolveNativeSkillProjectionPath(projectionTarget, secondSource))).toBe(true)
  })

  it('filters projected and stale paths by target source kind ownership', async () => {
    const root = await createTempDir()
    const pluginSkillDir = await createSkillPackage(root, 'cradle-plugin-demo')
    const builtinSkillDir = await createSkillPackage(root, 'builtin-demo')
    const projectionTarget: NativeSkillProjectionTarget = {
      ...target(path.join(root, 'native-skills'), 'nested'),
      sourceKinds: ['plugin'],
    }
    const pluginSource = source(pluginSkillDir, 'cradle-plugin-demo', 'plugin')
    const builtinSource = source(builtinSkillDir, 'builtin-demo', 'builtin')

    const result = reconcileNativeSkillProjections([pluginSource, builtinSource], [projectionTarget])

    expect(result.errors).toEqual([])
    expect(resolveNativeSkillProjectionPath(projectionTarget, builtinSource)).toBe(
      path.join(root, 'native-skills', 'cradle', 'builtin-demo'),
    )
    expect(fs.existsSync(resolveNativeSkillProjectionPath(projectionTarget, pluginSource))).toBe(true)
    expect(fs.existsSync(resolveNativeSkillProjectionPath(projectionTarget, builtinSource))).toBe(false)
  })

  it('removes a stale projection when the desired source package becomes invalid', async () => {
    const root = await createTempDir()
    const skillDir = await createSkillPackage(root)
    const projectionTarget = target(path.join(root, 'native-skills'), 'nested')
    const projectionSource = source(skillDir)
    const projectionPath = projectNativeSkill(projectionTarget, projectionSource)

    fs.rmSync(path.join(skillDir, 'SKILL.md'))
    const result = reconcileNativeSkillProjections([projectionSource], [projectionTarget])

    expect(result.errors[0]?.error).toContain('Skill package is missing SKILL.md')
    expect(fs.existsSync(projectionPath)).toBe(false)
  })

  it('cleans up legacy nested cradle/ directory when target uses flat layout', async () => {
    const root = await createTempDir()
    const skillDir = await createSkillPackage(root)
    const skillRoot = path.join(root, 'native-skills')
    const nestedTarget = target(skillRoot, 'nested')
    const flatTarget = target(skillRoot, 'flat')
    const projSource = source(skillDir)

    // Simulate old nested layout: cradle/cradle-plugin-demo symlink
    projectNativeSkill(nestedTarget, projSource)
    const nestedPath = path.join(skillRoot, 'cradle', 'cradle-plugin-demo')
    expect(fs.lstatSync(nestedPath).isSymbolicLink()).toBe(true)

    // Reconcile with flat layout — should migrate
    const result = reconcileNativeSkillProjections([projSource], [flatTarget])

    // Old nested symlink removed, legacy cradle/ directory gone
    expect(fs.existsSync(nestedPath)).toBe(false)
    expect(fs.existsSync(path.join(skillRoot, 'cradle'))).toBe(false)
    // New flat symlink created with true skill name
    expect(fs.existsSync(path.join(skillRoot, 'cradle-plugin-demo'))).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('migrates legacy cradle- double-prefix flat paths to true skill names', async () => {
    const root = await createTempDir()
    const skillDir = await createSkillPackage(root, 'cradle-cli')
    const skillRoot = path.join(root, 'native-skills')
    const flatTarget = target(skillRoot, 'flat')
    const builtinSource = source(skillDir, 'cradle-cli', 'builtin')

    // Simulate legacy flat path cradle-cradle-cli
    const legacyPath = path.join(skillRoot, 'cradle-cradle-cli')
    fs.mkdirSync(skillRoot, { recursive: true })
    fs.symlinkSync(skillDir, legacyPath, 'dir')

    const result = reconcileNativeSkillProjections([builtinSource], [flatTarget])

    expect(result.errors).toEqual([])
    expect(fs.existsSync(legacyPath)).toBe(false)
    expect(fs.existsSync(path.join(skillRoot, 'cradle-cli'))).toBe(true)
  })

  it('removes an exact projection without touching non-symlink conflicts', async () => {
    const root = await createTempDir()
    const skillDir = await createSkillPackage(root)
    const projectionTarget = target(path.join(root, 'native-skills'), 'flat')
    const projectionSource = source(skillDir)
    const projectionPath = projectNativeSkill(projectionTarget, projectionSource)

    removeNativeSkillProjection(projectionTarget, projectionSource)

    expect(fs.existsSync(projectionPath)).toBe(false)
  })
})
