import { describe, expect, it, vi } from 'vitest'

import { CodeActivityBus } from './code-activity-bus'

const target = {
  workspace: { id: 'workspace-1', name: 'Cradle' },
  file: { relativePath: 'apps/web/src/app.tsx', language: 'typescript' },
}

describe('code activity bus', () => {
  it('delivers the current non-write heartbeat to late subscribers', () => {
    const bus = new CodeActivityBus()
    bus.setCurrentTarget(target)
    const handler = vi.fn()

    bus.subscribe('plugin', handler)

    expect(handler).toHaveBeenCalledWith({
      kind: 'code.heartbeat',
      occurredAt: expect.any(Number),
      ...target,
      isWrite: false,
    })
  })

  it('reports writes only for the currently active workspace file', () => {
    const bus = new CodeActivityBus()
    const handler = vi.fn()
    bus.subscribe('plugin', handler)
    bus.setCurrentTarget(target)
    handler.mockClear()

    bus.recordWrite('workspace-2', target.file.relativePath)
    bus.recordWrite(target.workspace.id, 'other.ts')
    bus.recordWrite(target.workspace.id, target.file.relativePath)

    expect(handler).toHaveBeenCalledOnce()
    expect(handler).toHaveBeenCalledWith({
      kind: 'code.heartbeat',
      occurredAt: expect.any(Number),
      ...target,
      isWrite: true,
    })
  })

  it('does not emit another read heartbeat for the same target', () => {
    const bus = new CodeActivityBus()
    const handler = vi.fn()
    bus.subscribe('plugin', handler)

    bus.setCurrentTarget(target)
    bus.setCurrentTarget({
      workspace: { ...target.workspace },
      file: { ...target.file },
    })

    expect(handler).toHaveBeenCalledOnce()
  })
})
