// Tests Chronicle daemon launch argument construction.

import { describe, expect, it } from 'vitest'

import { createDaemonArgs } from '../src/modules/chronicle/daemon-manager'

describe('chronicle daemon manager', () => {
  it('passes an explicit negative audio flag when microphone capture is disabled', () => {
    const args = createDaemonArgs({
      storageRoot: '/tmp/cradle-chronicle',
      audioCaptureEnabled: false,
      audioSource: 'microphone',
      audioSegmentMs: 5_000,
      audioSegmentIntervalMs: 60_000,
      audioRmsThreshold: 0.02,
    })

    expect(args).toContain('--no-audio-capture')
    expect(args).not.toContain('--audio-capture')
  })

  it('passes microphone segment options only when audio capture is enabled', () => {
    const args = createDaemonArgs({
      storageRoot: '/tmp/cradle-chronicle',
      audioCaptureEnabled: true,
      audioSource: 'microphone',
      audioSegmentMs: 1_500,
      audioSegmentIntervalMs: 10_000,
      audioRmsThreshold: 0.03,
    })

    expect(args).toEqual([
      '--daemon',
      '--storage-root',
      '/tmp/cradle-chronicle',
      '--audio-capture',
      '--audio-source',
      'microphone',
      '--audio-segment-ms',
      '1500',
      '--audio-segment-interval-ms',
      '10000',
      '--audio-rms-threshold',
      '0.03',
    ])
  })

  it('passes configured privacy rules as repeatable daemon flags', () => {
    const args = createDaemonArgs({
      storageRoot: '/tmp/cradle-chronicle',
      audioCaptureEnabled: false,
      audioSource: 'microphone',
      audioSegmentMs: 5_000,
      audioSegmentIntervalMs: 60_000,
      audioRmsThreshold: 0.02,
      privacySensitiveAppBundleIds: ['com.apple.Terminal', 'com.example.Secret'],
      privacySensitiveTitlePatterns: ['Bank Dashboard'],
      privacySensitiveUrlPatterns: ['admin.example.com'],
    })

    expect(args).toEqual([
      '--daemon',
      '--storage-root',
      '/tmp/cradle-chronicle',
      '--no-audio-capture',
      '--privacy-sensitive-app',
      'com.apple.Terminal',
      '--privacy-sensitive-app',
      'com.example.Secret',
      '--privacy-sensitive-title',
      'Bank Dashboard',
      '--privacy-sensitive-url',
      'admin.example.com',
    ])
  })
})
