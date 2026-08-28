import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  parsePluginGuideSections,
  pluginGuideSectionId,
  renderPluginGuideIndex,
  resolvePluginDeveloperGuidePath,
  selectPluginGuideSection,
} from './plugin-docs'

const guide = `# Guide

Intro.

## 1. Architecture Overview

Architecture body.

## 2. Getting Started

Getting started body.

\`\`\`md
## Example-owned heading
\`\`\`

## npm release

Release body.
`

describe('Plugin developer guide command', () => {
  const tempDirs: string[] = []

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('creates stable topic ids and preserves complete H2 sections', () => {
    const sections = parsePluginGuideSections(guide)

    expect(sections.map(section => section.id)).toEqual([
      'architecture-overview',
      'getting-started',
      'npm-release',
    ])
    expect(sections[0]?.markdown).toBe('## 1. Architecture Overview\n\nArchitecture body.')
    expect(sections[1]?.markdown).toContain('## Example-owned heading')
    expect(pluginGuideSectionId('2. Getting Started — Create a Plugin')).toBe('getting-started-create-a-plugin')
  })

  it('accepts exact and unambiguous topic prefixes', () => {
    const sections = parsePluginGuideSections(guide)

    expect(selectPluginGuideSection(sections, 'npm-release').title).toBe('npm release')
    expect(selectPluginGuideSection(sections, 'arch').id).toBe('architecture-overview')
    expect(() => selectPluginGuideSection(sections, 'missing')).toThrow('Unknown Plugin guide topic')
  })

  it('renders an Agent-readable topic index', () => {
    expect(renderPluginGuideIndex(parsePluginGuideSections(guide))).toContain(
      'getting-started\tGetting Started',
    )
  })

  it('resolves an explicitly configured canonical guide', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cradle-plugin-docs-'))
    tempDirs.push(dir)
    const path = join(dir, 'DEVELOPERS.md')
    writeFileSync(path, guide)

    expect(resolvePluginDeveloperGuidePath({ configuredPath: path })).toBe(path)
  })

  it('resolves the guide beside a packaged Desktop CLI', () => {
    const resourcesDir = mkdtempSync(join(tmpdir(), 'cradle-plugin-docs-packaged-'))
    tempDirs.push(resourcesDir)
    const cliDir = join(resourcesDir, 'cli')
    const guideDir = join(resourcesDir, 'plugin-sdk')
    const guidePath = join(guideDir, 'DEVELOPERS.md')
    mkdirSync(cliDir, { recursive: true })
    mkdirSync(guideDir, { recursive: true })
    writeFileSync(guidePath, guide)

    expect(resolvePluginDeveloperGuidePath({
      executablePath: join(cliDir, 'index.cjs'),
      cwd: resourcesDir,
    })).toBe(guidePath)
  })
})
