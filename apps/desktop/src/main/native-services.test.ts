/*
 * Verifies native service Appshot orchestration helpers.
 */
import { describe, expect, it } from 'vitest'

import type { MacAppshotFrontmostContext } from './mac-bridge-protocol'
import {
  createParityAppshotAnimationTarget,
  readScreenPointAppshotAnimationTarget,
  readScreenPointAppshotDestinationFrame,
} from './native-appshot-target'
import { readEditorLaunchCandidates } from './native-editor-launcher'
import { readTerminalLaunchCandidates } from './native-terminal-launcher'

function frontmostContext(): MacAppshotFrontmostContext {
  return {
    window: {
      windowId: 42,
      appName: 'Safari',
      bundleId: 'com.apple.Safari',
      processId: 123,
      title: 'Example',
      bounds: { x: 10, y: 20, width: 800, height: 600 },
    },
    bundleIdentifier: 'com.apple.Safari',
    animationTarget: {
      codexDisplay: {
        id: 1,
        scaleFactor: 2,
        bounds: { x: 0, y: 0, width: 1440, height: 900 },
        workArea: { x: 0, y: 0, width: 1440, height: 875 },
      },
      destinationBackgroundColor: '#ffffff',
      destinationCornerRadius: 12,
      destinationFrame: { x: 10, y: 20, width: 800, height: 600 },
      destinationPrimaryTextColor: '#000000',
      transitionSnapshotScale: 2,
    },
  }
}

describe('createParityAppshotAnimationTarget', () => {
  it('uses a composer-like destination instead of the frontmost window fallback', () => {
    const context = frontmostContext()
    const target = createParityAppshotAnimationTarget(context)

    expect(target.codexDisplay).toEqual(context.animationTarget.codexDisplay)
    expect(target.destinationFrame).not.toEqual(context.animationTarget.destinationFrame)
    expect(target.destinationFrame).toEqual({
      x: 604,
      y: 699,
      width: 232,
      height: 140,
    })
    expect(target.destinationCornerRadius).toBe(0)
    expect(target.transitionSnapshotScale).toBe(2)
  })
})

describe('readScreenPointAppshotAnimationTarget', () => {
  it('converts renderer viewport pixels into screen points relative to the Electron content bounds', () => {
    const target = {
      coordinateSpace: 'viewportPixels' as const,
      codexDisplay: {
        id: 0,
        scaleFactor: 2,
        bounds: { x: 0, y: 0, width: 3024, height: 1964 },
        workArea: { x: 0, y: 0, width: 3024, height: 1880 },
      },
      destinationBackgroundColor: '#ffffff',
      destinationCornerRadius: 12,
      destinationFrame: { x: 618, y: 144, width: 512, height: 280 },
      destinationPrimaryTextColor: '#111111',
      transitionSnapshotScale: 2,
    }
    const contentBounds = { x: 401, y: 88, width: 1512, height: 894 }
    const display = {
      id: 1,
      scaleFactor: 2,
      bounds: { x: 401, y: 0, width: 1512, height: 982 },
      workArea: { x: 401, y: 44, width: 1512, height: 938 },
    }

    expect(readScreenPointAppshotDestinationFrame(target, contentBounds)).toEqual({
      x: 710,
      y: 160,
      width: 256,
      height: 140,
    })
    expect(readScreenPointAppshotAnimationTarget(target, contentBounds, display)).toEqual({
      ...target,
      coordinateSpace: 'screenPoints',
      codexDisplay: {
        ...target.codexDisplay,
        id: 1,
        scaleFactor: 2,
        bounds: { x: 401, y: 0, width: 1512, height: 982 },
        workArea: { x: 401, y: 44, width: 1512, height: 938 },
      },
      destinationFrame: {
        x: 710,
        y: 160,
        width: 256,
        height: 140,
      },
    })
  })
})

describe('readEditorLaunchCandidates', () => {
  it('prefers macOS app launches before command line editor fallbacks on Darwin', () => {
    const candidates = readEditorLaunchCandidates('darwin')

    expect(candidates.slice(0, 3).map(candidate => candidate.label)).toEqual([
      'Visual Studio Code',
      'Cursor',
      'Windsurf',
    ])
    expect(candidates.some(candidate => candidate.executable === 'code')).toBe(true)
  })

  it('uses command line editor candidates on non-macOS platforms', () => {
    const candidates = readEditorLaunchCandidates('linux')

    expect(candidates[0]?.label).toBe('code')
    expect(candidates.every(candidate => candidate.executable !== '/usr/bin/open')).toBe(true)
  })
})

describe('readTerminalLaunchCandidates', () => {
  it('uses Terminal.app as the macOS default external terminal launch', () => {
    const candidates = readTerminalLaunchCandidates('darwin')

    expect(candidates[0]).toMatchObject({
      label: 'Terminal',
      executable: '/usr/bin/open',
    })
  })

  it('prefers Windows Terminal before shell fallbacks on Windows', () => {
    const candidates = readTerminalLaunchCandidates('win32')

    expect(candidates.map(candidate => candidate.label).slice(0, 3)).toEqual([
      'Windows Terminal',
      'PowerShell',
      'Command Prompt',
    ])
  })
})
