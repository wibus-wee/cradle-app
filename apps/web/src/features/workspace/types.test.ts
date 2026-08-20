import { describe, expect, it } from 'vitest'

import { isWorkEligibleWorkspace } from './types'

describe('isWorkEligibleWorkspace', () => {
  it('accepts available local and mounted Node workspaces', () => {
    expect(isWorkEligibleWorkspace({
      locator: { nodeId: 'local', path: '/local/project' },
      availability: 'available',
      multiFolder: false,
    })).toBe(true)
    expect(isWorkEligibleWorkspace({
      locator: { nodeId: 'node-macbook', path: '/remote/project' },
      availability: 'remote',
      multiFolder: false,
    })).toBe(true)
  })

  it('rejects missing and multi-folder workspaces', () => {
    expect(isWorkEligibleWorkspace({
      locator: { nodeId: 'local', path: '/missing/project' },
      availability: 'missing',
      multiFolder: false,
    })).toBe(false)
    expect(isWorkEligibleWorkspace({
      locator: { nodeId: 'node-macbook', path: '/remote/multi' },
      availability: 'remote',
      multiFolder: true,
    })).toBe(false)
  })
})
