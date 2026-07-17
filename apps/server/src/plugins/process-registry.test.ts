import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createPluginProcessService, listPluginProcesses, stopAllPluginProcesses } from './process-registry'

const temporaryDirectories: string[] = []

describe('plugin managed processes', () => {
  afterEach(async () => {
    await stopAllPluginProcesses()
    await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
  })

  it('runs only plugin-owned executables and stops them through the owner lifecycle', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'cradle-plugin-process-'))
    temporaryDirectories.push(dataDir)
    const binDir = path.join(dataDir, 'bin')
    const command = path.join(binDir, 'sidecar')
    await mkdir(binDir, { recursive: true })
    await writeFile(command, '#!/bin/sh\nwhile true; do sleep 1; done\n')
    await chmod(command, 0o755)
    const processes = createPluginProcessService('@cradle/process-fixture', dataDir)

    await expect(processes.spawn({
      id: 'outside',
      displayName: 'Outside process',
      command: '/bin/sh',
    })).rejects.toThrow('inside the plugin data directory')

    const handle = await processes.spawn({
      id: 'sidecar',
      displayName: 'Fixture sidecar',
      command,
      cwd: dataDir,
    })

    expect(handle.status()).toMatchObject({ id: 'sidecar', state: 'running' })
    expect(listPluginProcesses('@cradle/process-fixture')).toHaveLength(1)

    await processes.stopAll()

    expect(handle.status()).toBeNull()
    expect(listPluginProcesses('@cradle/process-fixture')).toEqual([])
  })
})
