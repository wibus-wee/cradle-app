import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { providerTargetModelCache, providerTargets } from '@cradle/db'
import { describe, expect, it } from 'vitest'

import { createServerApp } from '../src/app'
import { db, shutdownInfra } from '../src/infra'

function createSkillSentinel(rootDir: string): string {
  const skillDir = join(rootDir, '.cradle', 'skills', 'sentinel')
  mkdirSync(skillDir, { recursive: true })
  const filePath = join(skillDir, 'SKILL.md')
  writeFileSync(filePath, '---\nname: sentinel\ndescription: sentinel\n---\n\nbody\n', 'utf8')
  return filePath
}

function restoreEnv(previous: {
  dataDir?: string
  home?: string
  nodeEnv?: string
}): void {
  if (previous.dataDir === undefined) {
    delete process.env.CRADLE_DATA_DIR
  }
  else {
    process.env.CRADLE_DATA_DIR = previous.dataDir
  }
  if (previous.home === undefined) {
    delete process.env.HOME
  }
  else {
    process.env.HOME = previous.home
  }
  if (previous.nodeEnv === undefined) {
    delete process.env.NODE_ENV
  }
  else {
    process.env.NODE_ENV = previous.nodeEnv
  }
}

describe('test-reset capability', () => {
  it('does not delete global skills outside the isolated test data root', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'cradle-data-'))
    const externalHome = mkdtempSync(join(tmpdir(), 'cradle-home-'))
    const sentinel = createSkillSentinel(externalHome)
    const previous = {
      dataDir: process.env.CRADLE_DATA_DIR,
      home: process.env.HOME,
      nodeEnv: process.env.NODE_ENV,
    }
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.HOME = externalHome
    process.env.NODE_ENV = 'test'

    try {
      const app = await createServerApp({ startBackgroundTasks: false })
      const res = await app.handle(new Request('http://localhost/test/reset', { method: 'POST' }))
      expect(res.status).toBe(200)
      expect(existsSync(sentinel)).toBe(true)
    }
    finally {
      shutdownInfra()
      restoreEnv(previous)
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(externalHome, { recursive: true, force: true })
    }
  })

  it('cleans isolated global skills when HOME is inside CRADLE_DATA_DIR', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'cradle-data-'))
    const isolatedHome = join(dataDir, 'home')
    const sentinel = createSkillSentinel(isolatedHome)
    const previous = {
      dataDir: process.env.CRADLE_DATA_DIR,
      home: process.env.HOME,
      nodeEnv: process.env.NODE_ENV,
    }
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.HOME = isolatedHome
    process.env.NODE_ENV = 'test'

    try {
      const app = await createServerApp({ startBackgroundTasks: false })
      const res = await app.handle(new Request('http://localhost/test/reset', { method: 'POST' }))
      expect(res.status).toBe(200)
      expect(existsSync(sentinel)).toBe(false)
    }
    finally {
      shutdownInfra()
      restoreEnv(previous)
      rmSync(dataDir, { recursive: true, force: true })
    }
  })

  it('cleans server-owned preferences inside the isolated test data root', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'cradle-data-'))
    const preferencesDir = join(dataDir, 'preferences')
    const jarvisPrefs = join(preferencesDir, 'jarvis.json')
    const previous = {
      dataDir: process.env.CRADLE_DATA_DIR,
      home: process.env.HOME,
      nodeEnv: process.env.NODE_ENV,
    }
    mkdirSync(preferencesDir, { recursive: true })
    writeFileSync(jarvisPrefs, JSON.stringify({
      profileId: 'profile-from-previous-scenario',
      model: 'mock-model',
      thinkingLevel: 'medium',
    }), 'utf8')
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.HOME = join(dataDir, 'home')
    process.env.NODE_ENV = 'test'

    try {
      const app = await createServerApp({ startBackgroundTasks: false })
      const res = await app.handle(new Request('http://localhost/test/reset', { method: 'POST' }))
      expect(res.status).toBe(200)
      expect(existsSync(jarvisPrefs)).toBe(false)
    }
    finally {
      shutdownInfra()
      restoreEnv(previous)
      rmSync(dataDir, { recursive: true, force: true })
    }
  })

  it('cleans provider model cache rows between scenarios', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'cradle-data-'))
    const previous = {
      dataDir: process.env.CRADLE_DATA_DIR,
      home: process.env.HOME,
      nodeEnv: process.env.NODE_ENV,
    }
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.HOME = join(dataDir, 'home')
    process.env.NODE_ENV = 'test'

    try {
      const app = await createServerApp({ startBackgroundTasks: false })
      const store = db()
      store.insert(providerTargets).values({
        id: 'provider-target-with-model-cache',
        kind: 'manual',
        providerKind: 'openai-compatible',
        displayName: 'Cached Provider',
      }).run()
      store.insert(providerTargetModelCache).values({
        providerTargetId: 'provider-target-with-model-cache',
        modelsJson: '[{"id":"stale-model","label":"Stale Model","providerKind":"openai-compatible","capabilities":{}}]',
      }).run()

      const res = await app.handle(new Request('http://localhost/test/reset', { method: 'POST' }))

      expect(res.status).toBe(200)
      expect(store.select().from(providerTargetModelCache).all()).toHaveLength(0)
    }
    finally {
      shutdownInfra()
      restoreEnv(previous)
      rmSync(dataDir, { recursive: true, force: true })
    }
  })
})
