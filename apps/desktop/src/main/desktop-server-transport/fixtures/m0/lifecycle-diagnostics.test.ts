import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createM0LifecycleRecorder } from './lifecycle-diagnostics'

describe('m0 Main lifecycle diagnostics', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'cradle-m0-lifecycle-'))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('writes ordered self-contained checkpoints and preserves non-trigger strings', async () => {
    const path = join(root, '.m0-results', 'packaged-win32-x64.lifecycle.jsonl')
    const recorder = createM0LifecycleRecorder(path, {
      mode: 'packaged',
      resultPath: '/tmp/result.json',
      artifactPath: 'C:\\release\\cradle-m0-gate.exe',
    })
    recorder.record('main.module-evaluated')
    recorder.record('main.settled', { exitCode: 1, summary: 'Bearer', relative: '/route?keep=yes' })

    const records = (await readFile(path, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
    expect(records).toHaveLength(2)
    expect(records[0]).toMatchObject({
      schemaVersion: 1,
      kind: 'm0-main-lifecycle',
      sequence: 1,
      checkpoint: 'main.module-evaluated',
      mode: 'packaged',
      resultPath: '/tmp/result.json',
      artifactPath: 'C:\\release\\cradle-m0-gate.exe',
    })
    expect(records[1]).toMatchObject({
      sequence: 2,
      checkpoint: 'main.settled',
      details: { exitCode: 1, summary: 'Bearer', relative: '/route?keep=yes' },
    })
  })

  it('terminally redacts every lifecycle string boundary at its first trigger', async () => {
    const path = join(root, '.m0-results', 'terminal-boundaries.lifecycle.jsonl')
    const recorder = createM0LifecycleRecorder(path, {
      mode: 'mode prefix Bearer \\"M_MODE_HEAD \\\\\"M_MODE_INNER\\\" M_MODE_TAIL\\"',
      resultPath: 'result prefix https://result.test/p\'M_RESULT_PATH custom://later.test/x?M_RESULT_QUERY',
      artifactPath: 'artifact prefix authorization=\\"M_ARTIFACT_HEAD M_ARTIFACT_TAIL\\"',
    })
    recorder.record('checkpoint prefix token=M_CHECKPOINT_HEAD\\ M_CHECKPOINT_TAIL', {
      reviewG: 'G prefix https://example.test/path?G_QUERY#G_HASH',
      reviewI: 'I prefix _https://prefixed.test/p?I_QUERY',
      authorization: 'K prefix authorization=\\"K_AUTH_HEAD K_AUTH_TAIL\\" after',
      cookie: 'K prefix cookie=\\\'K_COOKIE_HEAD K_COOKIE_TAIL\\\' after',
      password: 'K prefix password=K_PASS_HEAD\\ K_PASS_TAIL after',
      secret: 'K prefix secret=\\"K_SECRET_HEAD K_SECRET_TAIL\\" after',
      token: 'M prefix token=\\"M_TOKEN_HEAD \\\\\"M_TOKEN_INNER\\\" M_TOKEN_TAIL\\" after',
      bearer: 'M prefix Bearer \\"M_BEARER_HEAD \\\\\"M_BEARER_INNER\\\" M_BEARER_TAIL\\" after',
      url: 'M prefix https://first.test/p\'M_PATH custom+two://second.test/x?M_QUERY#M_HASH',
    })

    const persisted = await readFile(path, 'utf8')
    expect(JSON.parse(persisted)).toMatchObject({
      checkpoint: 'checkpoint prefix [REDACTED]',
      mode: 'mode prefix [REDACTED]',
      resultPath: 'result prefix [REDACTED]',
      artifactPath: 'artifact prefix [REDACTED]',
      details: {
        reviewG: 'G prefix [REDACTED]',
        reviewI: 'I prefix _[REDACTED]',
        authorization: 'K prefix [REDACTED]',
        cookie: 'K prefix [REDACTED]',
        password: 'K prefix [REDACTED]',
        secret: 'K prefix [REDACTED]',
        token: 'M prefix [REDACTED]',
        bearer: 'M prefix [REDACTED]',
        url: 'M prefix [REDACTED]',
      },
    })
    for (const marker of [
      'M_MODE_TAIL',
      'M_RESULT_PATH',
      'M_ARTIFACT_TAIL',
      'M_CHECKPOINT_TAIL',
      'G_QUERY',
      'I_QUERY',
      'K_AUTH_TAIL',
      'K_COOKIE_TAIL',
      'K_PASS_TAIL',
      'K_SECRET_TAIL',
      'M_TOKEN_TAIL',
      'M_BEARER_TAIL',
      'M_PATH',
      'M_QUERY',
    ]) {
      expect(persisted).not.toContain(marker)
    }
  })

  it('terminally redacts every lifecycle boundary after length-changing ordinary text', async () => {
    const prefix = 'ordinary İ prefix; '
    const triggers = {
      bearer: 'Bearer LIFECYCLE_BEARER_LEAK',
      authorization: 'authorization=LIFECYCLE_AUTHORIZATION_LEAK',
      cookie: 'cookie=LIFECYCLE_COOKIE_LEAK',
      password: 'password=LIFECYCLE_PASSWORD_LEAK',
      secret: 'secret=LIFECYCLE_SECRET_LEAK',
      token: 'token=LIFECYCLE_TOKEN_LEAK',
    }

    for (const [name, trigger] of Object.entries(triggers)) {
      const path = join(root, '.m0-results', `length-changing-prefix-${name}.lifecycle.jsonl`)
      const attack = `${prefix}${trigger}`
      const recorder = createM0LifecycleRecorder(path, {
        mode: attack,
        resultPath: attack,
        artifactPath: attack,
      })
      recorder.record(attack, { attack })

      const persisted = await readFile(path, 'utf8')
      expect(JSON.parse(persisted)).toMatchObject({
        checkpoint: `${prefix}[REDACTED]`,
        mode: `${prefix}[REDACTED]`,
        resultPath: `${prefix}[REDACTED]`,
        artifactPath: `${prefix}[REDACTED]`,
        details: { attack: `${prefix}[REDACTED]` },
      })
      expect(persisted).not.toContain('_LEAK')
    }
  })
})
