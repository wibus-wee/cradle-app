/* Verifies optional Mac screenshot sink behavior stays decoupled from capture. */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { MacCaptureFrontmostWindowResult } from './mac-bridge-protocol'
import { macScreenshotSinkInternals, runMacScreenshotSink } from './mac-screenshot-sinks'

const electronMocks = vi.hoisted(() => {
  const image = {
    isEmpty: vi.fn(() => false),
  }
  return {
    clipboard: {
      writeImage: vi.fn(),
    },
    nativeImage: {
      createFromPath: vi.fn(() => image),
    },
    shell: {
      openExternal: vi.fn(() => Promise.resolve()),
    },
    image,
  }
})

vi.mock('electron', () => electronMocks)

function capture(filePath = '/tmp/Cradle Capture 1.png'): MacCaptureFrontmostWindowResult {
  return {
    filePath,
    metadataPath: '/tmp/Cradle Capture 1.json',
    capturedAt: '2026-05-22T15:56:22Z',
    window: {
      windowId: 12,
      appName: 'TextEdit',
      bundleId: 'com.apple.TextEdit',
      processId: 123,
      title: 'Notes',
      bounds: { x: 0, y: 0, width: 100, height: 100 },
    },
  }
}

describe('runMacScreenshotSink', () => {
  beforeEach(() => {
    electronMocks.clipboard.writeImage.mockClear()
    electronMocks.nativeImage.createFromPath.mockClear()
    electronMocks.shell.openExternal.mockClear()
    electronMocks.image.isEmpty.mockReturnValue(false)
  })

  it('keeps file sink as a no-op success', async () => {
    await expect(runMacScreenshotSink({ sink: 'file', capture: capture() })).resolves.toEqual({
      sink: 'file',
      ok: true,
      message: null,
    })
    expect(electronMocks.shell.openExternal).not.toHaveBeenCalled()
  })

  it('copies a non-empty image to the clipboard', async () => {
    const result = await runMacScreenshotSink({ sink: 'clipboard', capture: capture() })

    expect(result).toEqual({ sink: 'clipboard', ok: true, message: null })
    expect(electronMocks.nativeImage.createFromPath).toHaveBeenCalledWith('/tmp/Cradle Capture 1.png')
    expect(electronMocks.clipboard.writeImage).toHaveBeenCalledWith(electronMocks.image)
  })

  it('opens CleanShot annotate URL without requiring CleanShot for capture', async () => {
    const result = await runMacScreenshotSink({ sink: 'cleanshot', capture: capture() })

    expect(result).toEqual({ sink: 'cleanshot', ok: true, message: null })
    expect(electronMocks.shell.openExternal).toHaveBeenCalledWith(
      'cleanshot://open-annotate?filepath=%2Ftmp%2FCradle+Capture+1.png',
    )
  })

  it('reports CleanShot handoff failures as sink failures', async () => {
    electronMocks.shell.openExternal.mockRejectedValueOnce(new Error('scheme unavailable'))

    await expect(runMacScreenshotSink({ sink: 'cleanshot', capture: capture() })).resolves.toEqual({
      sink: 'cleanshot',
      ok: false,
      message: 'scheme unavailable',
    })
  })
})

describe('macScreenshotSinkInternals.cleanShotAnnotateUrl', () => {
  it('encodes file paths through URLSearchParams', () => {
    expect(macScreenshotSinkInternals.cleanShotAnnotateUrl('/tmp/a b.png')).toBe(
      'cleanshot://open-annotate?filepath=%2Ftmp%2Fa+b.png',
    )
  })
})
