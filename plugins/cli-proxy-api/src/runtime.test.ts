import { createHash } from 'node:crypto'
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type { PluginDownloadedArtifact, PluginDownloadService } from '@cradle/plugin-sdk/server'
import { create as createTar } from 'tar'
import { afterEach, describe, expect, it } from 'vitest'

import { installRuntime, readRuntimeStatus, uninstallRuntime, validateArchiveEntry } from './runtime'

const temporaryDirectories: string[] = []

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'cradle-cli-proxy-api-'))
  temporaryDirectories.push(directory)
  return directory
}

function artifact(taskId: string, filePath: string, bytes: number): PluginDownloadedArtifact {
  return {
    taskId,
    filePath,
    bytes,
    checksum: { algorithm: 'sha256', expected: null, actual: '0'.repeat(64), matched: null },
  }
}

describe('cLIProxyAPI managed runtime', () => {
  afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
  })

  it('rejects archive paths that could escape the plugin data directory', () => {
    expect(() => validateArchiveEntry('../outside')).toThrow('unsafe path')
    expect(() => validateArchiveEntry('/absolute/path')).toThrow('unsafe path')
    expect(() => validateArchiveEntry('C:\\outside\\binary.exe')).toThrow('unsafe path')
    expect(() => validateArchiveEntry('safe/bin/cli-proxy-api')).not.toThrow()
  })

  it('installs a checksum-pinned release atomically and removes only the managed runtime', async () => {
    const fixtureRoot = await temporaryDirectory()
    const dataDir = path.join(fixtureRoot, 'plugin-data')
    const archiveInput = path.join(fixtureRoot, 'archive-input')
    const executable = path.join(archiveInput, 'cli-proxy-api')
    await mkdir(archiveInput, { recursive: true })
    await writeFile(executable, '#!/bin/sh\nexit 0\n')
    await chmod(executable, 0o755)

    const assetName = 'CLIProxyAPI_1.2.3_darwin_arm64.tar.gz'
    const archivePath = path.join(fixtureRoot, assetName)
    await createTar({ cwd: archiveInput, file: archivePath, gzip: true }, ['cli-proxy-api'])
    const archiveBytes = (await stat(archivePath)).size
    const archiveChecksum = createHash('sha256').update(await readFile(archivePath)).digest('hex')
    const checksumPath = path.join(fixtureRoot, 'checksums.txt')
    await writeFile(checksumPath, `${archiveChecksum}  ${assetName}\n`)
    const checksumBytes = (await stat(checksumPath)).size
    const releasePath = path.join(fixtureRoot, 'release.json')
    await writeFile(releasePath, JSON.stringify({
      tag_name: 'v1.2.3',
      assets: [
        { name: assetName, browser_download_url: `https://example.test/${assetName}`, size: archiveBytes },
        { name: 'checksums.txt', browser_download_url: 'https://example.test/checksums.txt', size: checksumBytes },
      ],
    }))

    const released: string[] = []
    const downloads: PluginDownloadService = {
      async execute(request) {
        if (request.fileName === 'release-latest.json') {
          return artifact('release', releasePath, (await stat(releasePath)).size)
        }
        if (request.fileName.startsWith('checksums-')) {
          return artifact('checksums', checksumPath, checksumBytes)
        }
        expect(request.integrity?.checksum).toEqual({ algorithm: 'sha256', value: archiveChecksum })
        return artifact('archive', archivePath, archiveBytes)
      },
      async release(taskId) {
        released.push(taskId)
      },
    }

    const installed = await installRuntime({ dataDir, downloads, platform: 'darwin', arch: 'arm64' })

    expect(installed).toMatchObject({ installed: true, version: '1.2.3', supported: true })
    expect(installed.executablePath).toContain(path.join('runtime', 'versions', '1.2.3'))
    expect(released).toEqual(['release', 'checksums', 'archive'])
    expect(readRuntimeStatus({ dataDir, platform: 'darwin', arch: 'arm64' })).toMatchObject({
      installed: true,
      version: '1.2.3',
    })

    await writeFile(path.join(dataDir, 'account.json'), '{"preserved":true}')
    await uninstallRuntime({ dataDir, platform: 'darwin', arch: 'arm64' })

    await expect(readFile(path.join(dataDir, 'account.json'), 'utf8')).resolves.toBe('{"preserved":true}')
    expect(readRuntimeStatus({ dataDir, platform: 'darwin', arch: 'arm64' }).installed).toBe(false)
  })
})
