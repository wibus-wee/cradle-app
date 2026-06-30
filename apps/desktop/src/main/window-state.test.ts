import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  readStoredWindowSize,
  resolveVisibleWindowBounds,
  resolveWindowBoundsNearPoint,
  resolveWindowSize,
  writeStoredWindowSize,
} from './window-state'

const policy = {
  defaultWidth: 1280,
  defaultHeight: 820,
  minWidth: 800,
  minHeight: 600,
}

const tempRoots: string[] = []

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('resolveVisibleWindowBounds', () => {
  it('keeps a stored window on the display where it is visible', () => {
    const bounds = resolveVisibleWindowBounds(
      { x: 2020, y: 160, width: 1100, height: 760 },
      [
        { x: 0, y: 0, width: 1440, height: 900 },
        { x: 1440, y: 0, width: 2560, height: 1440 },
      ],
      policy,
      { x: 0, y: 0, width: 1440, height: 900 },
    )

    expect(bounds).toEqual({ x: 2020, y: 160, width: 1100, height: 760 })
  })

  it('shrinks oversized stored windows to the selected display work area', () => {
    const bounds = resolveVisibleWindowBounds(
      { x: 100, y: 80, width: 1800, height: 1200 },
      [{ x: 0, y: 0, width: 1440, height: 900 }],
      policy,
      { x: 0, y: 0, width: 1440, height: 900 },
    )

    expect(bounds).toEqual({ x: 0, y: 0, width: 1440, height: 900 })
  })

  it('falls back to the primary display when the previous display is gone', () => {
    const bounds = resolveVisibleWindowBounds(
      { x: 4400, y: 120, width: 1100, height: 760 },
      [{ x: 0, y: 0, width: 1440, height: 900 }],
      policy,
      { x: 0, y: 0, width: 1440, height: 900 },
    )

    expect(bounds).toEqual({ x: 170, y: 70, width: 1100, height: 760 })
  })

  it('uses centered defaults when no stored bounds exist', () => {
    const bounds = resolveVisibleWindowBounds(
      {},
      [{ x: 0, y: 0, width: 1440, height: 900 }],
      policy,
      { x: 0, y: 0, width: 1440, height: 900 },
    )

    expect(bounds).toEqual({ x: 80, y: 40, width: 1280, height: 820 })
  })
})

describe('tear-off window size state', () => {
  it('resolves stored dimensions without position state', () => {
    const size = resolveWindowSize(
      { width: 900, height: 700 },
      {
        defaultWidth: 720,
        defaultHeight: 640,
        minWidth: 520,
        minHeight: 420,
      },
      { width: 800, height: 600 },
    )

    expect(size).toEqual({ width: 800, height: 600 })
  })

  it('writes only width and height', () => {
    const root = mkdtempSync(join(tmpdir(), 'cradle-window-state-'))
    tempRoots.push(root)
    const filePath = join(root, 'tearoff-window-size.json')

    writeStoredWindowSize(filePath, { width: 777.7, height: 555.2 })

    expect(JSON.parse(readFileSync(filePath, 'utf8'))).toEqual({ width: 778, height: 555 })
    expect(readStoredWindowSize(filePath)).toEqual({ width: 778, height: 555 })
  })
})

describe('resolveWindowBoundsNearPoint', () => {
  it('places the window near the release point instead of centering it', () => {
    const bounds = resolveWindowBoundsNearPoint(
      { width: 720, height: 640 },
      { x: 1000, y: 200 },
      { x: 0, y: 0, width: 1440, height: 900 },
    )

    expect(bounds).toEqual({ x: 640, y: 160, width: 720, height: 640 })
  })

  it('clamps the window inside the selected display work area', () => {
    const bounds = resolveWindowBoundsNearPoint(
      { width: 720, height: 640 },
      { x: 1420, y: 880 },
      { x: 0, y: 0, width: 1440, height: 900 },
    )

    expect(bounds).toEqual({ x: 720, y: 260, width: 720, height: 640 })
  })
})
