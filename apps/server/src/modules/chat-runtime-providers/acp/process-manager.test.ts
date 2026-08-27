import { PassThrough } from 'node:stream'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AcpProcessManager } from './process-manager'

const managedProcess = vi.hoisted(() => ({
  spawn: vi.fn(),
}))

vi.mock('../../../infra/managed-process', () => ({
  spawnManagedProcess: managedProcess.spawn,
}))

describe('acpProcessManager stderr capture', () => {
  beforeEach(() => {
    managedProcess.spawn.mockReset()
  })

  it('redacts injected auth environment values before retaining stderr metrics', () => {
    const proc = new PassThrough() as PassThrough & {
      stdin: PassThrough
      stdout: PassThrough
      stderr: PassThrough
      pid: number
      targetPid: number
      exitCode: number | null
      stop: () => Promise<void>
    }
    proc.stdin = new PassThrough()
    proc.stdout = new PassThrough()
    proc.stderr = new PassThrough()
    proc.pid = 42
    proc.targetPid = 42
    proc.exitCode = null
    proc.stop = async () => {}
    managedProcess.spawn.mockReturnValue(proc)

    const manager = new AcpProcessManager()
    manager.spawn({
      agentId: 'agent',
      cmd: '/fake/acp-agent',
      args: [],
      env: { ACP_API_KEY: 'resolved-secret-value' },
      sensitiveEnvNames: ['ACP_API_KEY'],
      distributionType: 'command',
    })
    proc.stderr.write('authentication failed for resolved-secret-value\n')

    expect(manager.getMetrics()[0]?.stderrLines).toEqual([
      'authentication failed for [REDACTED]',
    ])
    expect(JSON.stringify(manager.getMetrics())).not.toContain('resolved-secret-value')
  })
})
