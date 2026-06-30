import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'
import type { PtyOpenEvent } from '@cradle/remote-agent-protocol'

import { PtyRegistry } from './pty'

describe('PtyRegistry', () => {
  it('opens, writes to, and closes a host-level PTY', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'cradle-agentd-pty-'))
    const registry = new PtyRegistry()
    const stream = registry.open({
      ptyId: 'pty-test',
      cwd,
      cols: 80,
      rows: 24,
      shell: '/bin/sh',
    })

    try {
      const opened = await nextWithTimeout(stream, 'opened')
      expect(opened.done).toBe(false)
      expect(opened.value).toEqual(expect.objectContaining({
        kind: 'opened',
        ptyId: 'pty-test',
        cwd,
      }))

      expect(registry.write({
        ptyId: 'pty-test',
        data: 'printf "hello-pty\\n"; exit\r',
      })).toEqual({ ok: true })

      const events: PtyOpenEvent[] = [opened.value as PtyOpenEvent]
      for (let index = 0; index < 20; index += 1) {
        const next = await nextWithTimeout(stream, 'pty output')
        if (next.done) {
          break
        }
        events.push(next.value)
        if (next.value.kind === 'exit') {
          break
        }
      }

      expect(events.some(event => event.kind === 'output' && event.data.includes('hello-pty'))).toBe(true)
      expect(events.some(event => event.kind === 'exit' && event.ptyId === 'pty-test')).toBe(true)
    }
    finally {
      registry.close({ ptyId: 'pty-test' })
      rmSync(cwd, { recursive: true, force: true })
    }
  })
})

async function nextWithTimeout<T>(
  stream: AsyncGenerator<T, void, void>,
  label: string,
): Promise<IteratorResult<T, void>> {
  return await Promise.race([
    stream.next(),
    new Promise<IteratorResult<T, void>>((_, reject) => {
      setTimeout(() => reject(new Error(`Timed out waiting for ${label}`)), 2_000)
    }),
  ])
}
