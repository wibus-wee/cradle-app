import { describe, expect, it } from 'vitest'

import { resolveGeneratedCommandGroup } from './generated-command-selection'

const groups = new Set(['session', 'work', 'workspace'])

describe('generated command group selection', () => {
  it.each([
    [['node', 'cradle', 'session', 'list'], 'session'],
    [['node', 'cradle', '--server', 'http://localhost:7331', 'work', 'list'], 'work'],
    [['node', 'cradle', '--server=http://localhost:7331', 'workspace', 'list'], 'workspace'],
    [['node', 'cradle', 'man', 'session', 'list'], 'session'],
    [['node', 'cradle', 'help', 'work'], 'work'],
  ])('selects only the requested generated group from %j', (argv, expected) => {
    expect(resolveGeneratedCommandGroup(argv, groups)).toBe(expected)
  })

  it.each([
    ['node', 'cradle'],
    ['node', 'cradle', '--help'],
    ['node', 'cradle', '--help', 'session'],
    ['node', 'cradle', 'open', 'session'],
    ['node', 'cradle', 'javascript', 'workspace'],
    ['node', 'cradle', 'unknown', 'session'],
  ])('does not select a group for non-generated command argv %j', (...argv) => {
    expect(resolveGeneratedCommandGroup(argv, groups)).toBeUndefined()
  })
})
