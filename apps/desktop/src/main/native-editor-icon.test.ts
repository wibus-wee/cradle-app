import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { resolveMacApplicationIconPath } from './native-editor-icon'

const temporaryPaths: string[] = []

afterEach(async () => {
  await Promise.all(temporaryPaths.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

async function createApplicationBundle(plist: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'cradle-editor-icon-'))
  temporaryPaths.push(root)
  const applicationPath = join(root, 'Editor.app')
  await mkdir(join(applicationPath, 'Contents', 'Resources'), { recursive: true })
  await writeFile(join(applicationPath, 'Contents', 'Info.plist'), plist)
  return applicationPath
}

describe('resolveMacApplicationIconPath', () => {
  it('resolves the icon declared by CFBundleIconFile', async () => {
    const applicationPath = await createApplicationBundle(`<?xml version="1.0" encoding="UTF-8"?>
<plist><dict><key>CFBundleIconFile</key><string>EditorIcon</string></dict></plist>`)
    const iconPath = join(applicationPath, 'Contents', 'Resources', 'EditorIcon.icns')
    await writeFile(iconPath, 'icon')

    await expect(resolveMacApplicationIconPath(applicationPath)).resolves.toBe(iconPath)
  })

  it('falls back to an icon asset in Resources when the plist has no icon key', async () => {
    const applicationPath = await createApplicationBundle('<plist><dict></dict></plist>')
    const iconPath = join(applicationPath, 'Contents', 'Resources', 'fallback.png')
    await writeFile(iconPath, 'icon')

    await expect(resolveMacApplicationIconPath(applicationPath)).resolves.toBe(iconPath)
  })
})
