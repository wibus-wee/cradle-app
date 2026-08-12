import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { fileDiagnostic, redactDiagnosticText, serializeDiagnosticError, writeDiagnosticEnvelope } from './diagnostic-envelope.mjs'

describe('m0 diagnostic evidence', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'cradle-m0-diagnostic-'))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('writes a complete envelope atomically and hashes exact artifact bytes', async () => {
    const artifactPath = join(root, 'fixture.exe')
    const envelopePath = join(root, '.m0-results', 'packaged-win32-x64.diagnostic.json')
    await writeDiagnosticEnvelope(artifactPath, { bytes: 'fixture' })

    const artifact = await fileDiagnostic(artifactPath, { hash: true })
    await writeDiagnosticEnvelope(envelopePath, {
      schemaVersion: 1,
      kind: 'm0-runner-diagnostic',
      artifact,
      settlement: null,
    })

    expect(JSON.parse(await readFile(envelopePath, 'utf8'))).toMatchObject({
      schemaVersion: 1,
      kind: 'm0-runner-diagnostic',
      artifact: {
        exists: true,
        kind: 'file',
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
      settlement: null,
    })
  })

  it('terminally redacts at the first syntactic absolute-URL marker', () => {
    const attacks = [
      ['navigation failed at https://example.test/path?alpha=LEAK_QUERY#LEAK_HASH', 'navigation failed at [REDACTED]'],
      ['_https://absolute.test/p?alpha=LEAK_QUERY', '_[REDACTED]'],
      ['word_https://absolute.test/p', 'word_[REDACTED]'],
      ['https://first.test/p\'PATH_LEAK custom+two://second.test/x?QUERY_LEAK#HASH_LEAK', '[REDACTED]'],
      ['before cradle-m0://gate/plugin.js; later https://second.test/p', 'before [REDACTED]'],
      ['fetch custom+scheme://user:pass@[2001:db8::1]:8443/a/b failed', 'fetch [REDACTED]'],
    ]

    for (const [attack, expected] of attacks) {
      expect(redactDiagnosticText(attack)).toBe(expected)
    }
  })

  it('terminally redacts every recognized secret assignment without parsing its value', () => {
    const assignments = ['authorization', 'cookie', 'password', 'secret', 'token']
    const values = [
      'plain LEAK_TAIL',
      '"HEAD \\"INNER\\" LEAK_TAIL"',
      '\\"HEAD \\\\\"INNER\\\" LEAK_TAIL\\"',
      '\\\'HEAD \\\\\'INNER\\\' LEAK_TAIL\\\'',
      'HEAD\\ LEAK_TAIL',
    ]

    for (const name of assignments) {
      for (const secretValue of values) {
        expect(redactDiagnosticText(`safe prefix; ${name}=${secretValue}; public suffix`)).toBe(
          'safe prefix; [REDACTED]',
        )
        expect(redactDiagnosticText(`safe prefix; ${name.toUpperCase()} : ${secretValue}`)).toBe(
          'safe prefix; [REDACTED]',
        )
      }
    }
  })

  it('terminally redacts Bearer values and the earlier Authorization assignment', () => {
    const bearerValues = [
      'plain LEAK_TAIL',
      '"HEAD \\"INNER\\" LEAK_TAIL"',
      '\\"HEAD \\\\\"INNER\\\" LEAK_TAIL\\"',
      '\\\'HEAD \\\\\'INNER\\\' LEAK_TAIL\\\'',
      'HEAD\\ LEAK_TAIL',
    ]
    for (const secretValue of bearerValues) {
      expect(redactDiagnosticText(`safe; Bearer ${secretValue}; suffix`)).toBe('safe; [REDACTED]')
    }
    expect(redactDiagnosticText('safe; Authorization: Bearer \\"HEAD LEAK_TAIL\\"')).toBe(
      'safe; [REDACTED]',
    )
  })

  it('terminally redacts Bearer and every assignment after length-changing ordinary text', () => {
    const prefix = 'ordinary İ prefix; '
    const triggers = [
      'Bearer LEAK_BEARER',
      'authorization=LEAK_AUTHORIZATION',
      'cookie=LEAK_COOKIE',
      'password=LEAK_PASSWORD',
      'secret=LEAK_SECRET',
      'token=LEAK_TOKEN',
    ]

    for (const trigger of triggers) {
      expect(redactDiagnosticText(`${prefix}${trigger}; public suffix`)).toBe(`${prefix}[REDACTED]`)
    }
  })

  it('preserves strings with no terminal-redaction trigger', () => {
    const ordinary = [
      'Error: socket closed; relative /route?keep=this and Windows C:\\temp\\fixture?keep=this',
      'authorization pending; cookie jar unavailable; token bucket empty',
      'Bearer',
      'Bearer   ',
      'not-a-scheme:/path and also :// incomplete',
    ]
    for (const value of ordinary) {
      expect(redactDiagnosticText(value)).toBe(value)
    }
  })

  it('terminally sanitizes every serializeDiagnosticError string branch', () => {
    const error = new Error('message prefix token=HEAD LEAK_MESSAGE')
    error.name = 'name prefix Bearer \\"HEAD \\\\\"INNER\\\" LEAK_NAME\\"'
    Object.assign(error, {
      code: 'code prefix https://first.test/p\'LEAK_PATH custom://two.test/x?LEAK_QUERY',
    })

    expect(serializeDiagnosticError(error)).toEqual({
      name: 'name prefix [REDACTED]',
      message: 'message prefix [REDACTED]',
      code: 'code prefix [REDACTED]',
    })
    expect(serializeDiagnosticError('non-error Authorization: Bearer LEAK_NON_ERROR')).toEqual({
      name: 'NonError',
      message: 'non-error [REDACTED]',
      code: null,
    })
  })

  it('serializes every secret trigger after length-changing ordinary text without retaining its suffix', () => {
    const prefix = 'ordinary İ prefix; '
    const triggers = [
      'Bearer SERIAL_BEARER_LEAK',
      'authorization=SERIAL_AUTHORIZATION_LEAK',
      'cookie=SERIAL_COOKIE_LEAK',
      'password=SERIAL_PASSWORD_LEAK',
      'secret=SERIAL_SECRET_LEAK',
      'token=SERIAL_TOKEN_LEAK',
    ]

    for (const trigger of triggers) {
      const attack = `${prefix}${trigger}`
      const error = new Error(attack)
      error.name = attack
      Object.assign(error, { code: attack })

      expect(serializeDiagnosticError(error)).toEqual({
        name: `${prefix}[REDACTED]`,
        message: `${prefix}[REDACTED]`,
        code: `${prefix}[REDACTED]`,
      })
      expect(serializeDiagnosticError(attack)).toEqual({
        name: 'NonError',
        message: `${prefix}[REDACTED]`,
        code: null,
      })
    }
  })

  it('atomically persists every secret trigger after length-changing ordinary text as terminally redacted', async () => {
    const prefix = 'ordinary İ prefix; '
    const envelopePath = join(root, '.m0-results', 'length-changing-prefix.diagnostic.json')
    const attacks = {
      bearer: `${prefix}Bearer ENVELOPE_BEARER_LEAK`,
      authorization: `${prefix}authorization=ENVELOPE_AUTHORIZATION_LEAK`,
      cookie: `${prefix}cookie=ENVELOPE_COOKIE_LEAK`,
      password: `${prefix}password=ENVELOPE_PASSWORD_LEAK`,
      secret: `${prefix}secret=ENVELOPE_SECRET_LEAK`,
      token: `${prefix}token=ENVELOPE_TOKEN_LEAK`,
    }
    await writeDiagnosticEnvelope(envelopePath, attacks)

    const persisted = await readFile(envelopePath, 'utf8')
    expect(JSON.parse(persisted)).toEqual(
      Object.fromEntries(Object.keys(attacks).map(key => [key, `${prefix}[REDACTED]`])),
    )
    expect(persisted).not.toContain('_LEAK')
  })

  it('terminally sanitizes Review G, I, K, and M attacks in atomic envelope persistence', async () => {
    const envelopePath = join(root, '.m0-results', 'terminal-boundaries.diagnostic.json')
    await writeDiagnosticEnvelope(envelopePath, {
      reviewG: 'navigation failed at https://example.test/path?G_QUERY#G_HASH',
      reviewI: '_https://prefix.test/p?I_QUERY and token="I_HEAD I_TAIL"',
      reviewK: {
        authorization: 'before authorization=\\"K_HEAD K_TAIL\\" after',
        cookie: 'before cookie=\\\'K_COOKIE_HEAD K_COOKIE_TAIL\\\' after',
        password: 'before password=K_PASS_HEAD\\ K_PASS_TAIL after',
        url: 'before https://user K_USER:K_PASS@k.test/p?K_QUERY#K_HASH after',
      },
      reviewM: {
        token: 'before token=\\"M_HEAD \\\\\"M_INNER\\\" M_TAIL\\" after',
        bearer: 'before Bearer \\"M_BEARER_HEAD \\\\\"M_BEARER_INNER\\\" M_BEARER_TAIL\\" after',
        url: 'before https://first.test/p\'M_PATH custom+two://second.test/x?M_QUERY#M_HASH',
      },
    })

    const persisted = await readFile(envelopePath, 'utf8')
    expect(JSON.parse(persisted)).toEqual({
      reviewG: 'navigation failed at [REDACTED]',
      reviewI: '_[REDACTED]',
      reviewK: {
        authorization: 'before [REDACTED]',
        cookie: 'before [REDACTED]',
        password: 'before [REDACTED]',
        url: 'before [REDACTED]',
      },
      reviewM: {
        token: 'before [REDACTED]',
        bearer: 'before [REDACTED]',
        url: 'before [REDACTED]',
      },
    })
    for (const marker of ['G_QUERY', 'I_QUERY', 'I_TAIL', 'K_TAIL', 'K_QUERY', 'M_TAIL', 'M_PATH', 'M_QUERY']) {
      expect(persisted).not.toContain(marker)
    }
  })
})
