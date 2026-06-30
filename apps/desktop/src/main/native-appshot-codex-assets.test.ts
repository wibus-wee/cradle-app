/*
 * Verifies read-only Codex Appshot temp asset projection.
 */
import { mkdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  observeCodexAppshotAssets,
  readCodexAppshotAsset,
  readCodexAppshotAssetFromPath,
} from './native-appshot-codex-assets'

const onePixelPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/l3f+7wAAAABJRU5ErkJggg==',
  'base64',
)

let tempRoot: string | null = null

async function createTempRoot(): Promise<string> {
  tempRoot = join(tmpdir(), `cradle-codex-appshot-assets-${process.pid}-${Date.now()}`)
  await mkdir(tempRoot, { recursive: true })
  return tempRoot
}

describe('native-appshot-codex-assets', () => {
  afterEach(async () => {
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true })
      tempRoot = null
    }
  })

  it('reads only supported image assets inside the Codex temp root', async () => {
    const root = await createTempRoot()
    const imagePath = resolve(root, 'capture.png')
    const outsidePath = join(tmpdir(), `cradle-codex-outside-${process.pid}-${Date.now()}.png`)
    await writeFile(imagePath, onePixelPng)
    await writeFile(outsidePath, onePixelPng)
    const realImagePath = await realpath(imagePath)

    const asset = await readCodexAppshotAsset(`file://${imagePath}`, root)
    expect(asset).toMatchObject({
      path: realImagePath,
      relativePath: 'capture.png',
      mimeType: 'image/png',
      size: onePixelPng.byteLength,
    })
    expect(asset?.dataURL.startsWith('data:image/png;base64,')).toBe(true)
    expect(asset?.sha256).toHaveLength(64)
    await expect(readCodexAppshotAssetFromPath(outsidePath, root)).resolves.toBeNull()

    await rm(outsidePath, { force: true })
  })

  it('observes new Codex temp assets without reporting the baseline inventory', async () => {
    const root = await createTempRoot()
    const realRoot = await realpath(root)
    await writeFile(resolve(root, 'existing.png'), onePixelPng)

    const observed = observeCodexAppshotAssets({
      durationMs: 80,
      pollIntervalMs: 20,
    }, root)

    await new Promise(resolveTimer => setTimeout(resolveTimer, 25))
    await writeFile(resolve(root, 'new.png'), onePixelPng)

    await expect(observed).resolves.toMatchObject({
      rootPath: realRoot,
      assets: [
        {
          relativePath: 'new.png',
          mimeType: 'image/png',
        },
      ],
    })
  })
})
