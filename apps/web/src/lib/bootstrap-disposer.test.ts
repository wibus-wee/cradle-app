// @vitest-environment node

import { describe, expect, it, vi } from 'vitest'

import { createBootstrapDisposerRegistry } from './bootstrap-disposer'

describe('bootstrap disposer registry', () => {
  it('runs each registered cleanup exactly once', () => {
    const cleanup = vi.fn()
    const registry = createBootstrapDisposerRegistry()
    registry.add(cleanup)
    registry.add(cleanup)

    registry.dispose()
    registry.dispose()

    expect(cleanup).toHaveBeenCalledOnce()
  })

  it('immediately runs cleanup that finishes registering after disposal', () => {
    const cleanup = vi.fn()
    const registry = createBootstrapDisposerRegistry()
    registry.dispose()

    registry.add(cleanup)

    expect(cleanup).toHaveBeenCalledOnce()
  })

  it('continues disposing after one cleanup fails', () => {
    const onError = vi.fn()
    const second = vi.fn()
    const registry = createBootstrapDisposerRegistry(onError)
    registry.add(() => {
      throw new Error('cleanup failed')
    })
    registry.add(second)

    registry.dispose()

    expect(onError).toHaveBeenCalledOnce()
    expect(second).toHaveBeenCalledOnce()
  })
})
