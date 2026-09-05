import { Buffer } from 'node:buffer'
import type { Readable } from 'node:stream'

import { expect } from '@playwright/test'
import type { Entry, ZipFile } from 'yauzl'
import { openPromise as openZipPromise } from 'yauzl'

import {
  EXTERNAL_SESSION_REPLY,
  EXTERNAL_SESSION_TITLE,
} from '../helpers/external-session-import-scenario'
import type { CradleWorld } from '../world'

const EXPORT_TIMEOUT = 30_000
const ARCHIVE_TITLE = 'Portable Session Export'
const SESSION_ID_KEY = 'session-export.session-id'
const ARCHIVE_KEY = 'session-export.archive'

interface SessionResponse {
  id: string
  title: string | null
  createdAt: number
}

interface SessionArchiveJson {
  session: {
    id: string
    title: string
    modelId: string | null
    providerTargetId: string | null
    createdAt: number
    updatedAt: number
  }
  usage: {
    totalTokens: number
    promptTokens: number
    completionTokens: number
    turnCount: number
  }
  messages: Array<{
    id: string
    role: 'user' | 'assistant'
    status: string
    content: string
    createdAt: number
    updatedAt: number
  }>
}

interface DownloadedSessionArchive {
  fileName: string
  entries: Map<string, Buffer>
  session: SessionResponse
}

function expectedArchiveFileName(session: SessionResponse): string {
  const date = new Date(session.createdAt * 1000)
  const dateBucket = `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}${String(date.getUTCDate()).padStart(2, '0')}`
  return `cradle-session-portable-session-export-${dateBucket}.zip`
}

async function readEntry(zip: ZipFile, entry: Entry): Promise<Buffer> {
  const stream = await new Promise<Readable>((resolve, reject) => {
    zip.openReadStream(entry, (error, value) => {
      if (error || !value) {
        reject(error ?? new Error(`ZIP entry ${entry.fileName} did not expose a readable stream`))
        return
      }
      resolve(value)
    })
  })

  return await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = []
    stream.on('data', chunk => chunks.push(Buffer.from(chunk)))
    stream.once('error', reject)
    stream.once('end', () => resolve(Buffer.concat(chunks)))
  })
}

async function readZipEntries(path: string): Promise<Map<string, Buffer>> {
  const zip = await openZipPromise(path, { lazyEntries: true })
  const entries = new Map<string, Buffer>()

  return await new Promise<Map<string, Buffer>>((resolve, reject) => {
    let settled = false

    const fail = (error: Error) => {
      if (settled) {
        return
      }
      settled = true
      zip.close()
      reject(error)
    }

    zip.once('error', fail)
    zip.on('entry', (entry) => {
      if (entries.has(entry.fileName)) {
        fail(new Error(`Duplicate ZIP entry: ${entry.fileName}`))
        return
      }

      void readEntry(zip, entry).then((content) => {
        entries.set(entry.fileName, content)
        zip.readEntry()
      }, fail)
    })
    zip.once('end', () => {
      if (!settled) {
        settled = true
        resolve(entries)
      }
    })
    zip.readEntry()
  })
}

export class SessionExportPage {
  constructor(private readonly world: CradleWorld) {}

  private get page() {
    return this.world.page
  }

  async exportCurrentSession(): Promise<void> {
    const sessionId = await this.world.chat.sessionId()
    this.world.remember(SESSION_ID_KEY, sessionId)
    await this.world.chat.openSessionMenu(sessionId)

    const responsePromise = this.page.waitForResponse((response) => {
      const url = new URL(response.url())
      return response.request().method() === 'GET'
        && url.pathname === `/sessions/${sessionId}/export/zip`
    }, { timeout: EXPORT_TIMEOUT })

    const downloadPromise = this.page.waitForEvent('download', { timeout: EXPORT_TIMEOUT })
    await this.world.chat.clickSessionMenuAction(sessionId, 'export-zip')
    const [response, download] = await Promise.all([responsePromise, downloadPromise])

    expect(response.status()).toBe(200)
    expect(response.headers()['content-type']).toBe('application/zip')
    expect(response.headers()['cache-control']).toBe('no-store')
    expect(await download.failure()).toBeNull()

    const downloadPath = await download.path()
    if (!downloadPath) {
      throw new Error('Completed session export did not produce a local download path')
    }

    const sessionResponse = await fetch(`${this.world.params.serverUrl}/sessions/${sessionId}`)
    expect(sessionResponse.ok).toBe(true)
    const session = await sessionResponse.json() as SessionResponse
    const archive = {
      fileName: download.suggestedFilename(),
      entries: await readZipEntries(downloadPath),
      session,
    } satisfies DownloadedSessionArchive
    this.world.remember(ARCHIVE_KEY, archive)
  }

  async renameCurrentSession(title: string): Promise<void> {
    const sessionId = await this.world.chat.sessionId()
    this.world.remember(SESSION_ID_KEY, sessionId)
    await this.world.chat.openSessionMenu(sessionId)
    await this.world.chat.clickSessionMenuAction(sessionId, 'rename')

    const input = this.page.locator(`[data-testid="session-rename-input-${sessionId}"]`)
    await expect(input).toBeVisible({ timeout: EXPORT_TIMEOUT })
    await input.fill(title)
    await input.press('Enter')
    await expect(input).toHaveCount(0, { timeout: EXPORT_TIMEOUT })
    await this.world.chat.expectSessionTitle(sessionId, title, EXPORT_TIMEOUT)
  }

  expectArchiveIdentity(): void {
    const { fileName, session } = this.world.recall<DownloadedSessionArchive>(ARCHIVE_KEY)
    expect(session.id).toBe(this.world.recall<string>(SESSION_ID_KEY))
    expect(session.title).toBe(ARCHIVE_TITLE)
    expect(fileName).toBe(expectedArchiveFileName(session))
  }

  expectArchiveContents(): void {
    const { entries, session } = this.world.recall<DownloadedSessionArchive>(ARCHIVE_KEY)
    expect([...entries.keys()].sort()).toEqual(['session.json', 'transcript.md'])

    const sessionJson = JSON.parse(entries.get('session.json')!.toString('utf8')) as SessionArchiveJson
    expect(sessionJson.session).toMatchObject({
      id: session.id,
      title: ARCHIVE_TITLE,
      createdAt: session.createdAt,
    })
    expect(sessionJson.messages.map(message => ({
      role: message.role,
      status: message.status,
      content: message.content,
    }))).toEqual([
      { role: 'user', status: 'complete', content: EXTERNAL_SESSION_TITLE },
      { role: 'assistant', status: 'complete', content: EXTERNAL_SESSION_REPLY },
    ])
    expect(sessionJson.usage).toEqual({
      totalTokens: expect.any(Number),
      promptTokens: expect.any(Number),
      completionTokens: expect.any(Number),
      turnCount: expect.any(Number),
    })

    const transcript = entries.get('transcript.md')!.toString('utf8')
    expect(transcript).toContain(`# ${ARCHIVE_TITLE}`)
    expect(transcript).toContain(`## User`)
    expect(transcript).toContain(EXTERNAL_SESSION_TITLE)
    expect(transcript).toContain(`## Assistant`)
    expect(transcript).toContain(EXTERNAL_SESSION_REPLY)
  }

  async expectCurrentSessionUnchanged(): Promise<void> {
    const sessionId = this.world.recall<string>(SESSION_ID_KEY)
    expect(await this.world.chat.sessionId()).toBe(sessionId)
    await this.world.chat.expectUserMessage(EXTERNAL_SESSION_TITLE, EXPORT_TIMEOUT)
    await this.world.chat.expectAssistantContains(EXTERNAL_SESSION_REPLY, EXPORT_TIMEOUT)
    await this.world.chat.expectSessionTitle(sessionId, ARCHIVE_TITLE, EXPORT_TIMEOUT)
  }
}
