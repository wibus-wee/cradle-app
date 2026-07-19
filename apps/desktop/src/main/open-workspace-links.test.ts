import { describe, expect, it } from 'vitest'

import {
  buildOpenWorkspaceTrayAction,
  collectOpenWorkspaceUrls,
  isOpenWorkspaceUrl,
  OpenWorkspaceLinkError,
  parseOpenWorkspaceUrl,
} from './open-workspace-links'

const validUrl = 'cradle://open/workspace?id=bb3c1bce-55f8-4215-aa4b-c565e487eb3c'

describe('parseOpenWorkspaceUrl', () => {
  it('parses a valid open workspace deep link', () => {
    expect(parseOpenWorkspaceUrl(validUrl)).toEqual({
      workspaceId: 'bb3c1bce-55f8-4215-aa4b-c565e487eb3c',
      originalUrl: validUrl,
    })
  })

  it('decodes encoded workspace ids', () => {
    expect(parseOpenWorkspaceUrl('cradle://open/workspace?id=a%20b')).toEqual({
      workspaceId: 'a b',
      originalUrl: 'cradle://open/workspace?id=a%20b',
    })
  })

  it('rejects non-cradle protocols and wrong hosts', () => {
    expect(() => parseOpenWorkspaceUrl('https://open/workspace?id=x')).toThrow(OpenWorkspaceLinkError)
    expect(() => parseOpenWorkspaceUrl('cradle://plugins/install?id=x')).toThrow(OpenWorkspaceLinkError)
    expect(() => parseOpenWorkspaceUrl('cradle://open/other?id=x')).toThrow(OpenWorkspaceLinkError)
  })

  it('requires id and rejects unknown params', () => {
    expect(() => parseOpenWorkspaceUrl('cradle://open/workspace')).toThrow(/id/)
    expect(() => parseOpenWorkspaceUrl('cradle://open/workspace?id=a&token=b')).toThrow(/token/)
  })
})

describe('collectOpenWorkspaceUrls', () => {
  it('filters argv-style values', () => {
    expect(collectOpenWorkspaceUrls([
      '/Applications/Cradle.app/Contents/MacOS/Cradle',
      validUrl,
      'cradle://plugins/install?source=github',
      '--some-flag',
    ])).toEqual([validUrl])
  })

  it('isOpenWorkspaceUrl matches only open workspace links', () => {
    expect(isOpenWorkspaceUrl(validUrl)).toBe(true)
    expect(isOpenWorkspaceUrl('cradle://plugins/install')).toBe(false)
  })
})

describe('buildOpenWorkspaceTrayAction', () => {
  it('builds the renderer tray action payload', () => {
    expect(buildOpenWorkspaceTrayAction('ws-1')).toEqual({
      actionId: 'open-workspace',
      payload: { workspaceId: 'ws-1' },
    })
  })
})
