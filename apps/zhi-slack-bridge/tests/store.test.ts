import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { BridgeStore } from '../src/store.js'

const TEST_DIR = join(tmpdir(), `zhi-bridge-test-${process.pid}`)

describe('bridgeStore', () => {
  beforeEach(() => {
    process.env.ZHI_DATA_DIR = TEST_DIR
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true })
    }
    mkdirSync(TEST_DIR, { recursive: true })
  })

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true })
    }
    delete process.env.ZHI_DATA_DIR
  })

  it('starts with empty state', () => {
    const store = new BridgeStore()
    expect(store.getChannelBinding()).toBeNull()
  })

  it('manages channel binding', () => {
    const store = new BridgeStore()

    store.setChannelBinding('C123', 'U456')
    const binding = store.getChannelBinding()
    expect(binding).not.toBeNull()
    expect(binding!.channelId).toBe('C123')
    expect(binding!.boundBy).toBe('U456')

    store.clearChannelBinding()
    expect(store.getChannelBinding()).toBeNull()
  })

  it('persists across instances', () => {
    const store1 = new BridgeStore()
    store1.setChannelBinding('C999', 'U111')

    const store2 = new BridgeStore()
    expect(store2.getChannelBinding()!.channelId).toBe('C999')
  })
})
