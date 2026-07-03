import { describe, expect, it } from 'vitest'

import { getExecutableCommand, getPathDelimiter, resolveDefaultShell } from './pty-platform'

describe('resolveDefaultShell', () => {
  describe('win32', () => {
    it('returns COMSPEC when it points at a valid path', () => {
      expect(resolveDefaultShell({
        platform: 'win32',
        comspec: 'C:\\Windows\\System32\\cmd.exe',
        shell: undefined,
      })).toBe('C:\\Windows\\System32\\cmd.exe')
    })

    // Regression: COMSPEC is an empty string on some Windows machines. The
        // earlier `??` fallback only caught null/undefined, so an empty COMSPEC
        // flowed into node-pty as `file=""` and crashed with `File not found: `.
    it('falls back to cmd.exe when COMSPEC is an empty string', () => {
      expect(resolveDefaultShell({
        platform: 'win32',
        comspec: '',
        shell: undefined,
      })).toBe('cmd.exe')
    })

    it('falls back to cmd.exe when COMSPEC is unset', () => {
      expect(resolveDefaultShell({
        platform: 'win32',
        comspec: undefined,
        shell: undefined,
      })).toBe('cmd.exe')
    })
  })

  describe('non-win32', () => {
    it('returns SHELL when set', () => {
      expect(resolveDefaultShell({
        platform: 'darwin',
        comspec: undefined,
        shell: '/bin/zsh',
      })).toBe('/bin/zsh')
    })

    it('falls back to /bin/sh when SHELL is an empty string', () => {
      expect(resolveDefaultShell({
        platform: 'linux',
        comspec: undefined,
        shell: '',
      })).toBe('/bin/sh')
    })

    it('falls back to /bin/sh when SHELL is unset', () => {
      expect(resolveDefaultShell({
        platform: 'darwin',
        comspec: undefined,
        shell: undefined,
      })).toBe('/bin/sh')
    })
  })
})

describe('getPathDelimiter', () => {
  it('returns ";" on win32 and ":" otherwise (matches host platform)', () => {
    const delimiter = getPathDelimiter()
    expect(delimiter).toBe(process.platform === 'win32' ? ';' : ':')
  })
})

describe('getExecutableCommand', () => {
  it('strips Windows executable extensions from a bare name', () => {
    expect(getExecutableCommand('cmd.exe')).toBe('cmd')
    expect(getExecutableCommand('powershell.EXE')).toBe('powershell')
    expect(getExecutableCommand('setup.bat')).toBe('setup')
    expect(getExecutableCommand('profile.ps1')).toBe('profile')
  })

  it('leaves extensionless names untouched', () => {
    expect(getExecutableCommand('zsh')).toBe('zsh')
  })
})
