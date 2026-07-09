import { describe, expect, it } from 'vitest'

import { parsePluginSourceInput } from './plugin-source-parser'

describe('parsePluginSourceInput', () => {
  describe('cradle:// deep links', () => {
    it('maps a full marketplace deep link to a git source', () => {
      const url = 'cradle://plugins/install?source=github&repository=wibus-wee/cradle-app&path=plugins/foo&version=1.2.3&channel=bundled&ref=main'
      expect(parsePluginSourceInput(url)).toEqual({
        kind: 'git',
        location: 'wibus-wee/cradle-app',
        ref: 'main',
        subPath: 'plugins/foo',
      })
    })

    it('defaults ref to undefined when the deep link omits it', () => {
      const url = 'cradle://plugins/install?source=github&repository=owner/repo&path=.&version=1.0.0&channel=bundled'
      expect(parsePluginSourceInput(url)).toEqual({
        kind: 'git',
        location: 'owner/repo',
        ref: undefined,
        subPath: undefined,
      })
    })

    it('drops subPath when path is empty or root', () => {
      const url = 'cradle://plugins/install?source=github&repository=owner/repo&path=&version=1.0.0&channel=bundled'
      expect(parsePluginSourceInput(url)).toEqual({
        kind: 'git',
        location: 'owner/repo',
        ref: undefined,
        subPath: undefined,
      })
    })

    it('rejects a deep link whose repository is malformed', () => {
      expect(parsePluginSourceInput('cradle://plugins/install?repository=not-a-repo')).toBeNull()
    })

    it('rejects a non-install cradle:// link', () => {
      expect(parsePluginSourceInput('cradle://plugins/browse?repository=owner/repo')).toBeNull()
    })
  })

  describe('gitHub URLs', () => {
    it('parses a plain https URL with no tree', () => {
      expect(parsePluginSourceInput('https://github.com/owner/repo')).toEqual({
        kind: 'git',
        location: 'owner/repo',
      })
    })

    it('parses a tree URL into ref + subPath', () => {
      expect(parsePluginSourceInput('https://github.com/owner/repo/tree/v1.2.3/packages/plugin')).toEqual({
        kind: 'git',
        location: 'owner/repo',
        ref: 'v1.2.3',
        subPath: 'packages/plugin',
      })
    })

    it('parses a tree URL with a branch ref and no subPath', () => {
      expect(parsePluginSourceInput('https://github.com/owner/repo/tree/develop')).toEqual({
        kind: 'git',
        location: 'owner/repo',
        ref: 'develop',
      })
    })

    it('accepts a bare github.com URL without protocol', () => {
      expect(parsePluginSourceInput('github.com/owner/repo/tree/main/pkg/sub')).toEqual({
        kind: 'git',
        location: 'owner/repo',
        ref: 'main',
        subPath: 'pkg/sub',
      })
    })

    it('strips a trailing .git suffix', () => {
      expect(parsePluginSourceInput('https://github.com/owner/repo.git')).toEqual({
        kind: 'git',
        location: 'owner/repo',
      })
    })

    it('rejects a non-github host', () => {
      expect(parsePluginSourceInput('https://gitlab.com/owner/repo')).toBeNull()
    })

    it('rejects a github URL missing the repo segment', () => {
      expect(parsePluginSourceInput('https://github.com/owner')).toBeNull()
    })
  })

  describe('owner/repo shorthand', () => {
    it('maps owner/repo to a git source', () => {
      expect(parsePluginSourceInput('wibus-wee/cradle-app')).toEqual({
        kind: 'git',
        location: 'wibus-wee/cradle-app',
      })
    })

    it('strips .git from shorthand', () => {
      expect(parsePluginSourceInput('owner/repo.git')).toEqual({
        kind: 'git',
        location: 'owner/repo',
      })
    })

    it('rejects shorthand with extra path segments', () => {
      expect(parsePluginSourceInput('owner/repo/extra')).toBeNull()
    })
  })

  describe('npm packages', () => {
    it('maps a scoped package', () => {
      expect(parsePluginSourceInput('@cradle/some-plugin')).toEqual({
        kind: 'npm',
        location: '@cradle/some-plugin',
      })
    })

    it('maps an unscoped package', () => {
      expect(parsePluginSourceInput('lodash')).toEqual({
        kind: 'npm',
        location: 'lodash',
      })
    })

    it('rejects an invalid scoped name', () => {
      expect(parsePluginSourceInput('@Bad/Name')).toBeNull()
    })
  })

  describe('local paths and garbage', () => {
    it('rejects absolute posix paths (localPath is CLI-only)', () => {
      expect(parsePluginSourceInput('/Users/me/plugins')).toBeNull()
    })

    it('rejects home-relative paths', () => {
      expect(parsePluginSourceInput('~/plugins/foo')).toBeNull()
    })

    it('rejects windows drive paths', () => {
      expect(parsePluginSourceInput('C:\\Users\\me\\plugins')).toBeNull()
    })

    it('rejects traversal in a cradle:// deep-link path param', () => {
      // Query params are not path-normalized by URL, so this is the vector
      // normalizeSubPath() must defend against.
      expect(parsePluginSourceInput('cradle://plugins/install?repository=owner/repo&path=../etc')).toBeNull()
    })

    it('rejects traversal segments inside a deep-link subPath', () => {
      expect(parsePluginSourceInput('cradle://plugins/install?repository=owner/repo&path=pkg/../../etc')).toBeNull()
    })

    it('rejects empty / whitespace input', () => {
      expect(parsePluginSourceInput('')).toBeNull()
      expect(parsePluginSourceInput('   ')).toBeNull()
    })

    it('rejects random garbage', () => {
      expect(parsePluginSourceInput('this is not a plugin source')).toBeNull()
    })
  })

  describe('whitespace handling', () => {
    it('trims surrounding whitespace before detecting', () => {
      expect(parsePluginSourceInput('  owner/repo  ')).toEqual({
        kind: 'git',
        location: 'owner/repo',
      })
    })
  })
})
