import { access, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import type { DesktopDownloadTaskRecord } from './download-task-store'
import { DesktopDownloadTaskStore } from './download-task-store'

const tempRoots: string[] = []

async function temporaryUserData(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'cradle-desktop-download-store-'))
  tempRoots.push(root)
  return root
}

function taskRecord(taskId = 'task-1'): DesktopDownloadTaskRecord {
  const timestamp = '2026-07-15T12:00:00.000Z'
  return {
    task: {
      taskId,
      scope: 'desktop',
      owner: { namespace: 'plugin', resourceType: 'release', resourceId: '1', displayName: 'Example download' },
      fileName: 'example.zip',
      sourceId: 'primary',
      status: 'queued',
      transferredBytes: 0,
      totalBytes: null,
      attempts: 0,
      maxAttempts: 1,
      error: null,
      result: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      startedAt: null,
      finishedAt: null,
    },
    resume: null,
    artifactReleasedAt: null,
  }
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('desktopDownloadTaskStore', () => {
  it('quarantines malformed JSON and starts from an empty state', async () => {
    const userDataPath = await temporaryUserData()
    const statePath = path.join(userDataPath, 'download-center', 'tasks.json')
    await mkdir(path.dirname(statePath), { recursive: true })
    await writeFile(statePath, '{ this is not JSON', { encoding: 'utf8', flush: true })

    const store = new DesktopDownloadTaskStore({ userDataPath, now: () => new Date('2026-07-15T12:00:00.000Z') })

    await expect(store.load()).resolves.toEqual([])
    await expect(readFile(statePath, 'utf8')).resolves.toContain('"tasks": []')
    await expect(readdir(path.dirname(statePath))).resolves.toContain('tasks.json.corrupt-2026-07-15T12-00-00-000Z')
  })

  it('writes through a temporary file and atomically leaves a complete state document', async () => {
    const userDataPath = await temporaryUserData()
    const store = new DesktopDownloadTaskStore({ userDataPath })
    await store.load()

    await store.put(taskRecord())

    await expect(readFile(store.filePath, 'utf8')).resolves.toContain('"taskId": "task-1"')
    await expect(access(`${store.filePath}.tmp`)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('retains all active tasks and only the 100 newest terminal tasks', async () => {
    const userDataPath = await temporaryUserData()
    const store = new DesktopDownloadTaskStore({ userDataPath })
    await store.load()
    for (let index = 0; index < 102; index += 1) {
      const record = taskRecord(`terminal-${index}`)
      record.task.status = 'completed'
      record.task.updatedAt = new Date(Date.UTC(2026, 6, 15, 12, 0, index)).toISOString()
      record.task.finishedAt = record.task.updatedAt
      await store.put(record)
    }
    const active = taskRecord('active')
    active.task.status = 'downloading'
    await store.put(active)

    const records = store.list()
    expect(records).toHaveLength(101)
    expect(records.some(record => record.task.taskId === 'active')).toBe(true)
    expect(records.some(record => record.task.taskId === 'terminal-0')).toBe(false)
    expect(records.some(record => record.task.taskId === 'terminal-101')).toBe(true)
  })
})
