import { describe, expect, it } from 'vitest'

import {
  isAbsoluteOrPathLikeCommand,
  parseArgsJson,
  parseEnvJson,
  resolveBinaryCommand,
  resolveEffectiveLaunch,
} from './launch-config'

describe('launch-config', () => {
  describe('parseArgsJson / parseEnvJson', () => {
    it('parses JSON arrays and objects', () => {
      expect(parseArgsJson('["--stdio","--debug"]')).toEqual(['--stdio', '--debug'])
      expect(parseArgsJson(null)).toEqual([])
      expect(parseArgsJson('')).toEqual([])
      expect(parseArgsJson('not-json')).toEqual([])
      expect(parseEnvJson('{"A":"1","B":"2"}')).toEqual({ A: '1', B: '2' })
      expect(parseEnvJson(null)).toEqual({})
    })
  })

  describe('resolveEffectiveLaunch', () => {
    it('returns base when overrides are null', () => {
      const effective = resolveEffectiveLaunch({
        distributionType: 'npx',
        installPath: null,
        cmd: '@demo/agent',
        args: JSON.stringify(['--stdio']),
        env: JSON.stringify({ BASE: '1' }),
        overrideCmd: null,
        overrideArgs: null,
        overrideEnv: null,
      })
      expect(effective).toEqual({
        distributionType: 'npx',
        installPath: null,
        cmd: '@demo/agent',
        args: ['--stdio'],
        env: { BASE: '1' },
      })
    })

    it('replaces args including empty array override', () => {
      const withEmpty = resolveEffectiveLaunch({
        distributionType: 'command',
        installPath: null,
        cmd: '/bin/echo',
        args: JSON.stringify(['a']),
        env: '{}',
        overrideArgs: '[]',
      })
      expect(withEmpty.args).toEqual([])
      expect(withEmpty.cmd).toBe('/bin/echo')
    })

    it('shallow-merges env with override keys winning', () => {
      const effective = resolveEffectiveLaunch({
        distributionType: 'npx',
        installPath: null,
        cmd: 'pkg',
        args: '[]',
        env: JSON.stringify({ A: 'base', B: 'base' }),
        overrideEnv: JSON.stringify({ B: 'override', C: 'new' }),
      })
      expect(effective.env).toEqual({ A: 'base', B: 'override', C: 'new' })
    })

    it('uses overrideCmd when set', () => {
      const effective = resolveEffectiveLaunch({
        distributionType: 'binary',
        installPath: '/opt/agent',
        cmd: 'bin/agent',
        args: '[]',
        env: '{}',
        overrideCmd: '/usr/local/bin/agent',
      })
      expect(effective.cmd).toBe('/usr/local/bin/agent')
      expect(effective.distributionType).toBe('binary')
      expect(effective.installPath).toBe('/opt/agent')
    })
  })

  describe('resolveBinaryCommand', () => {
    it('joins relative cmd under installPath', () => {
      expect(resolveBinaryCommand('/opt/agent', 'bin/agent')).toBe('/opt/agent/bin/agent')
    })

    it('uses absolute cmd as-is', () => {
      expect(resolveBinaryCommand('/opt/agent', '/usr/bin/agent')).toBe('/usr/bin/agent')
    })

    it('rejects path traversal outside installPath', () => {
      expect(() => resolveBinaryCommand('/opt/agent', '../escape')).toThrow(/escapes installPath/)
    })

    it('requires installPath', () => {
      expect(() => resolveBinaryCommand('', 'bin')).toThrow(/installPath is required/)
    })
  })

  describe('isAbsoluteOrPathLikeCommand', () => {
    it('flags absolute paths and relative traversal', () => {
      expect(isAbsoluteOrPathLikeCommand('/usr/bin/x')).toBe(true)
      expect(isAbsoluteOrPathLikeCommand('../x')).toBe(true)
      expect(isAbsoluteOrPathLikeCommand('./x')).toBe(true)
    })

    it('allows package names including scoped packages', () => {
      expect(isAbsoluteOrPathLikeCommand('@demo/agent')).toBe(false)
      expect(isAbsoluteOrPathLikeCommand('demo-agent')).toBe(false)
    })
  })
})
