/* Verifies Mac Bridge process management and binary resolution behavior. */
import { chmodSync, mkdirSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { MacBridgeManager, resolveMacBridgeBinaryPath } from './mac-bridge-manager'

function createFakeBridgeScript(): string {
  const root = join(tmpdir(), `cradle-mac-bridge-test-${process.pid}-${Date.now()}`)
  mkdirSync(root, { recursive: true })
  const scriptPath = join(root, 'fake-bridge.mjs')
  writeFileSync(scriptPath, `#!/usr/bin/env node
import readline from 'node:readline'

const rl = readline.createInterface({ input: process.stdin })
rl.on('line', (line) => {
  const request = JSON.parse(line)
  if (request.method === 'bridge.status') {
    process.stdout.write(JSON.stringify({
      id: request.id,
      result: {
        name: 'cradle-mac-bridge',
        version: 'test',
        pid: process.pid,
        platform: 'darwin'
      }
    }) + '\\n')
    return
  }
  if (request.method === 'mac.input.configure') {
    process.stdout.write(JSON.stringify({
      id: request.id,
      result: {
        trigger: request.params.trigger,
        enabled: request.params.enabled
      }
    }) + '\\n')
    process.stdout.write(JSON.stringify({
      method: 'event.mac.hotkeyTriggered',
      params: {
        trigger: request.params.trigger,
        capturedAt: '2026-05-22T15:56:22Z',
        targetWindow: {
          windowId: 42,
          processId: 123,
          bundleId: 'com.apple.Safari'
        },
        bundleIdentifier: 'com.apple.Safari',
        context: {
          window: {
            windowId: 42,
            appName: 'Safari',
            bundleId: 'com.apple.Safari',
            processId: 123,
            title: 'Example',
            bounds: {
              x: 10,
              y: 20,
              width: 800,
              height: 600
            }
          },
          bundleIdentifier: 'com.apple.Safari',
          animationTarget: {
            codexDisplay: {
              id: 1,
              scaleFactor: 2,
              bounds: { x: 0, y: 0, width: 1440, height: 900 },
              workArea: { x: 0, y: 0, width: 1440, height: 875 }
            },
            destinationBackgroundColor: '#ffffff',
            destinationCornerRadius: 12,
            destinationFrame: { x: 10, y: 20, width: 800, height: 600 },
            destinationPrimaryTextColor: '#000000'
          }
        }
      }
    }) + '\\n')
    return
  }
  if (request.method === 'mac.input.syntheticBothCommand') {
    process.stdout.write(JSON.stringify({
      id: request.id,
      result: {
        trigger: 'bothCommand',
        holdMilliseconds: request.params.holdMilliseconds ?? 120,
        postedEventCount: 4,
        postedAt: '2026-05-22T15:56:22Z'
      }
    }) + '\\n')
    return
  }
  if (request.method === 'mac.input.syntheticBareModifier') {
    process.stdout.write(JSON.stringify({
      id: request.id,
      result: {
        trigger: request.params.modifier,
        modifier: request.params.modifier,
        holdMilliseconds: request.params.holdMilliseconds ?? 120,
        postedEventCount: 4,
        postedAt: '2026-05-22T15:56:22Z'
      }
    }) + '\\n')
    return
  }
  if (request.method === 'mac.permissions.request') {
    process.stdout.write(JSON.stringify({
      id: request.id,
      result: {
        requested: request.params.permissions ?? ['accessibility', 'inputMonitoring', 'screenRecording'],
        status: {
          accessibility: 'denied',
          inputMonitoring: 'denied',
          screenRecording: 'granted'
        }
      }
    }) + '\\n')
    return
  }
  if (request.method === 'mac.permissions.openSettings') {
    process.stdout.write(JSON.stringify({
      id: request.id,
      result: {
        target: request.params.target ?? 'privacy',
        url: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
        opened: true
      }
    }) + '\\n')
    return
  }
  if (request.method === 'mac.appshot.captureFrontmostWindow') {
    const targetWindow = request.params.targetWindow ?? {}
    process.stdout.write(JSON.stringify({
      id: request.id,
      result: {
        filePath: request.params.outputDir + '/appshot-1.png',
        metadataPath: request.params.outputDir + '/appshot-1.json',
        capturedAt: '2026-05-22T15:56:23Z',
        captureBackend: 'screen-capture-kit',
        captureImageSize: {
          pixelWidth: 1600,
          pixelHeight: 1200
        },
        window: {
          windowId: targetWindow.windowId ?? 42,
          appName: 'Safari',
          bundleId: targetWindow.bundleId ?? 'com.apple.Safari',
          processId: targetWindow.processId ?? 123,
          title: 'Example',
          bounds: {
            x: 10,
            y: 20,
            width: 800,
            height: 600
          }
        },
        appshot: {
          strategy: 'cradle-native',
          animationDuration: 0.88,
          transitionSnapshotPath: request.params.outputDir + '/appshot-1-transition.png',
          transitionSnapshotHeight: 360,
          transitionSnapshotImageSize: {
            pixelWidth: 464,
            pixelHeight: 720
          },
          transitionSpringDampingFraction: 0.82,
          transitionSpringResponse: 0.52
        }
      }
    }) + '\\n')
    return
  }
  if (request.method === 'mac.appshot.frontmostContext') {
    process.stdout.write(JSON.stringify({
      id: request.id,
      result: {
        window: {
          windowId: 42,
          appName: 'Safari',
          bundleId: 'com.apple.Safari',
          processId: 123,
          title: 'Example',
          bounds: {
            x: 10,
            y: 20,
            width: 800,
            height: 600
          }
        },
        bundleIdentifier: 'com.apple.Safari',
        animationTarget: {
          codexDisplay: {
            id: 1,
            scaleFactor: 2,
            bounds: { x: 0, y: 0, width: 1440, height: 900 },
            workArea: { x: 0, y: 0, width: 1440, height: 875 }
          },
          destinationBackgroundColor: '#ffffff',
          destinationCornerRadius: 12,
          destinationFrame: { x: 10, y: 20, width: 800, height: 600 },
          destinationPrimaryTextColor: '#000000'
        }
      }
    }) + '\\n')
    return
  }
  if (request.method === 'mac.recording.startDisplay') {
    process.stdout.write(JSON.stringify({
      id: request.id,
      result: {
        recordingId: request.params.recordingId ?? 'recording-1',
        outputPath: request.params.outputPath,
        backend: 'core-graphics-window-list-polling',
        displayId: 1,
        width: 1512,
        height: 982,
        frameRate: request.params.frameRate ?? 30,
        fallbackFrom: 'screen-capture-kit-display',
        fallbackError: {
          code: 'screen-recording-display-unavailable',
          message: 'ScreenCaptureKit did not return any displays.'
        },
        startedAt: '2026-05-22T15:56:24Z'
      }
    }) + '\\n')
    return
  }
  if (request.method === 'mac.recording.finishDisplay') {
    process.stdout.write(JSON.stringify({
      id: request.id,
      result: {
        recordingId: request.params.recordingId,
        outputPath: '/tmp/cradle-appshot-test/recording.mov',
        backend: 'core-graphics-window-list-polling',
        displayId: 1,
        width: 1512,
        height: 982,
        frameRate: 30,
        frameCount: 270,
        durationSeconds: 9,
        fallbackFrom: 'screen-capture-kit-display',
        fallbackError: {
          code: 'screen-recording-display-unavailable',
          message: 'ScreenCaptureKit did not return any displays.'
        },
        finishedAt: '2026-05-22T15:56:33Z'
      }
    }) + '\\n')
    return
  }
  if (request.method === 'mac.recording.startWindow') {
    process.stdout.write(JSON.stringify({
      id: request.id,
      result: {
        recordingId: request.params.recordingId ?? 'recording-1',
        outputPath: request.params.outputPath,
        backend: 'screen-capture-kit-window',
        displayId: null,
        width: 1512,
        height: 982,
        frameRate: request.params.frameRate ?? 30,
        windowId: 9001,
        processId: request.params.processId ?? null,
        bundleIdentifier: request.params.bundleIdentifier ?? null,
        displayBounds: request.params.displayBounds ?? null,
        discoveryTimeoutSeconds: request.params.discoveryTimeoutSeconds ?? 2,
        discoveryPollIntervalSeconds: request.params.discoveryPollIntervalSeconds ?? 0.04,
        startedAt: '2026-05-22T15:56:24Z'
      }
    }) + '\\n')
    return
  }
  if (request.method === 'mac.recording.finishWindow') {
    process.stdout.write(JSON.stringify({
      id: request.id,
      result: {
        recordingId: request.params.recordingId,
        outputPath: '/tmp/cradle-appshot-test/window-recording.mov',
        backend: 'screen-capture-kit-window',
        displayId: null,
        width: 1512,
        height: 982,
        frameRate: 30,
        windowId: 9001,
        processId: 777,
        bundleIdentifier: 'com.openai.sky.CUAService',
        frameCount: 90,
        durationSeconds: 3,
        finishedAt: '2026-05-22T15:56:27Z'
      }
    }) + '\\n')
    return
  }
  if (request.method === 'mac.appshot.probeTransitionVisibility') {
    process.stdout.write(JSON.stringify({
      id: request.id,
      result: {
        panelWindowNumber: 101,
        sampleCount: 1,
        sampleIntervalSeconds: request.params.sampleIntervalSeconds ?? 0.12,
        animationDuration: request.params.animationDuration ?? 0.88,
        samples: [{
          index: 0,
          capturedAt: '2026-05-22T15:56:34Z',
          imagePath: null,
          imageStatus: 'timeout',
          panelFoundInCoreGraphicsWindowList: true
        }]
      }
    }) + '\\n')
    return
  }
  if (request.method === 'mac.appshot.probeTransitionPresentation') {
    process.stdout.write(JSON.stringify({
      id: request.id,
      result: {
        panelWindowNumber: 102,
        sampleCount: 2,
        sampleIntervalSeconds: request.params.sampleIntervalSeconds ?? 0.06,
        animationDuration: request.params.animationDuration ?? 0.88,
        samples: [{
          index: 0,
          capturedAt: '2026-05-22T15:56:35Z',
          imagePath: request.params.outputDir + '/sample-000.png',
          imageStatus: 'written',
          snapshotFrame: { x: 10, y: 20, width: 800, height: 600 },
          snapshotImageOpacity: 0
        }, {
          index: 1,
          capturedAt: '2026-05-22T15:56:35Z',
          imagePath: request.params.outputDir + '/sample-001.png',
          imageStatus: 'written',
          snapshotFrame: { x: 100, y: 100, width: 420, height: 320 },
          snapshotImageOpacity: 1
        }]
      }
    }) + '\\n')
    return
  }
  process.stdout.write(JSON.stringify({
    id: request.id,
    error: {
      code: 'unknown-method',
      message: request.method
    }
  }) + '\\n')
})
`, 'utf8')
  chmodSync(scriptPath, 0o755)
  return scriptPath
}

describe('resolveMacBridgeBinaryPath', () => {
  it('returns null on non-macOS platforms without explicit binary', () => {
    expect(resolveMacBridgeBinaryPath({
      platform: 'linux',
      env: {},
    })).toBeNull()
  })

  it('prefers explicit env override', () => {
    expect(resolveMacBridgeBinaryPath({
      platform: 'darwin',
      env: { CRADLE_MAC_BRIDGE_BIN: '/tmp/custom-mac-bridge' },
    })).toBe('/tmp/custom-mac-bridge')
  })

  it('resolves packaged resources when available', () => {
    const root = join(tmpdir(), `cradle-mac-bridge-resource-${process.pid}-${Date.now()}`)
    const binaryPath = join(root, 'mac-bridge', 'cradle-mac-bridge')
    mkdirSync(join(root, 'mac-bridge'), { recursive: true })
    writeFileSync(binaryPath, '')

    expect(resolveMacBridgeBinaryPath({
      platform: 'darwin',
      resourcesPath: root,
      env: {},
    })).toBe(binaryPath)
  })
})

describe('macBridgeManager', () => {
  let manager: MacBridgeManager | null = null

  afterEach(async () => {
    await manager?.stop()
    manager = null
  })

  it('reports unavailable instead of throwing when binary is missing', async () => {
    manager = new MacBridgeManager({
      binaryPath: '/tmp/not-a-real-cradle-mac-bridge',
      platform: 'darwin',
      env: {},
    })

    await expect(manager.start()).resolves.toMatchObject({
      available: false,
      running: false,
      lastError: 'cradle-mac-bridge binary is not available',
    })
  })

  it('round-trips requests and hotkey events over NDJSON', async () => {
    const events: unknown[] = []
    manager = new MacBridgeManager({
      binaryPath: process.execPath,
      args: [createFakeBridgeScript()],
      platform: 'darwin',
      env: {},
    })
    manager.on('hotkeyTriggered', event => events.push(event))

    await expect(manager.readBridgeStatus()).resolves.toMatchObject({
      name: 'cradle-mac-bridge',
      version: 'test',
      platform: 'darwin',
    })
    await expect(manager.configureInput({ trigger: 'DoubleOption', enabled: true })).resolves.toEqual({
      trigger: 'DoubleOption',
      enabled: true,
    })
    await expect(manager.synthesizeBothCommandHotkey({ holdMilliseconds: 140 })).resolves.toEqual({
      trigger: 'bothCommand',
      holdMilliseconds: 140,
      postedEventCount: 4,
      postedAt: '2026-05-22T15:56:22Z',
    })
    await expect(manager.synthesizeBareModifierHotkey({
      modifier: 'DoubleOption',
      holdMilliseconds: 140,
    })).resolves.toEqual({
      trigger: 'DoubleOption',
      modifier: 'DoubleOption',
      holdMilliseconds: 140,
      postedEventCount: 4,
      postedAt: '2026-05-22T15:56:22Z',
    })
    await expect(manager.requestPermissions({
      permissions: ['accessibility', 'inputMonitoring'],
    })).resolves.toEqual({
      requested: ['accessibility', 'inputMonitoring'],
      status: {
        accessibility: 'denied',
        inputMonitoring: 'denied',
        screenRecording: 'granted',
      },
    })
    await expect(manager.openPermissionSettings({
      target: 'accessibility',
    })).resolves.toEqual({
      target: 'accessibility',
      url: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
      opened: true,
    })
    await expect(manager.captureAppshotFrontmostWindow({
      outputDir: '/tmp/cradle-appshot-test',
      targetWindow: {
        windowId: 42,
        processId: 123,
        bundleId: 'com.apple.Safari',
      },
      soundEnabled: false,
    })).resolves.toMatchObject({
      filePath: '/tmp/cradle-appshot-test/appshot-1.png',
      captureBackend: 'screen-capture-kit',
      captureImageSize: {
        pixelWidth: 1600,
        pixelHeight: 1200,
      },
      window: {
        windowId: 42,
        processId: 123,
        bundleId: 'com.apple.Safari',
      },
      appshot: {
        strategy: 'cradle-native',
        animationDuration: 0.88,
      },
    })
    await expect(manager.readAppshotFrontmostContext()).resolves.toMatchObject({
      bundleIdentifier: 'com.apple.Safari',
      window: {
        windowId: 42,
      },
      animationTarget: {
        destinationFrame: { x: 10, y: 20, width: 800, height: 600 },
      },
    })
    await expect(manager.startDisplayRecording({
      recordingId: 'recording-1',
      outputPath: '/tmp/cradle-appshot-test/recording.mov',
      frameRate: 30,
    })).resolves.toMatchObject({
      recordingId: 'recording-1',
      outputPath: '/tmp/cradle-appshot-test/recording.mov',
      backend: 'core-graphics-window-list-polling',
      fallbackFrom: 'screen-capture-kit-display',
      width: 1512,
      height: 982,
    })
    await expect(manager.finishDisplayRecording({
      recordingId: 'recording-1',
    })).resolves.toMatchObject({
      recordingId: 'recording-1',
      backend: 'core-graphics-window-list-polling',
      frameCount: 270,
      durationSeconds: 9,
    })
    await expect(manager.startWindowRecording({
      recordingId: 'window-recording-1',
      outputPath: '/tmp/cradle-appshot-test/window-recording.mov',
      frameRate: 30,
      processId: 777,
      bundleIdentifier: 'com.openai.sky.CUAService',
      displayBounds: { x: 0, y: 0, width: 1440, height: 900 },
      discoveryTimeoutSeconds: 2,
      discoveryPollIntervalSeconds: 0.04,
    })).resolves.toMatchObject({
      recordingId: 'window-recording-1',
      outputPath: '/tmp/cradle-appshot-test/window-recording.mov',
      backend: 'screen-capture-kit-window',
      processId: 777,
      bundleIdentifier: 'com.openai.sky.CUAService',
    })
    await expect(manager.finishWindowRecording({
      recordingId: 'window-recording-1',
    })).resolves.toMatchObject({
      recordingId: 'window-recording-1',
      backend: 'screen-capture-kit-window',
      frameCount: 90,
      durationSeconds: 3,
    })
    await expect(manager.probeAppshotTransitionVisibility({
      outputDir: '/tmp/cradle-appshot-test/visibility',
      screenshotPath: '/tmp/cradle-appshot-test/appshot-1.png',
      sampleCount: 1,
      sampleIntervalSeconds: 0.12,
    })).resolves.toMatchObject({
      panelWindowNumber: 101,
      samples: [{
        index: 0,
        imageStatus: 'timeout',
        panelFoundInCoreGraphicsWindowList: true,
      }],
    })
    await expect(manager.probeAppshotTransitionPresentation({
      outputDir: '/tmp/cradle-appshot-test/presentation',
      screenshotPath: '/tmp/cradle-appshot-test/appshot-1.png',
      sampleCount: 2,
      sampleIntervalSeconds: 0.06,
    })).resolves.toMatchObject({
      panelWindowNumber: 102,
      sampleCount: 2,
      samples: [{
        index: 0,
        imageStatus: 'written',
        snapshotImageOpacity: 0,
      }, {
        index: 1,
        imageStatus: 'written',
        snapshotImageOpacity: 1,
      }],
    })
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(events).toEqual([{
      trigger: 'DoubleOption',
      capturedAt: '2026-05-22T15:56:22Z',
      targetWindow: {
        windowId: 42,
        processId: 123,
        bundleId: 'com.apple.Safari',
      },
      bundleIdentifier: 'com.apple.Safari',
      context: expect.objectContaining({
        bundleIdentifier: 'com.apple.Safari',
        window: expect.objectContaining({
          windowId: 42,
          processId: 123,
          bundleId: 'com.apple.Safari',
        }),
      }),
    }])
  })

  it('restarts the bridge when the binary changes while a dev process is running', async () => {
    const scriptPath = createFakeBridgeScript()
    manager = new MacBridgeManager({
      binaryPath: scriptPath,
      platform: 'darwin',
      env: process.env,
    })

    const firstStatus = await manager.readBridgeStatus()
    const firstPid = firstStatus.pid
    const nextTimestamp = new Date(Date.now() + 5_000)
    utimesSync(scriptPath, nextTimestamp, nextTimestamp)

    const secondStatus = await manager.readBridgeStatus()

    expect(secondStatus.pid).not.toBe(firstPid)
    expect(manager.getStatus()).toMatchObject({
      running: true,
      pid: secondStatus.pid,
      binaryPath: scriptPath,
    })
  })
})
