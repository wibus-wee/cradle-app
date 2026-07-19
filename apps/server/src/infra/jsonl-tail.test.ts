import { appendFile, mkdtemp, rm, truncate, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createJsonlTail } from './jsonl-tail'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('createJsonlTail', () => {
  it('reads existing records, waits for a complete line, and follows later appends', async () => {
    const path = await createTemporaryJsonlFile('{"id":1}\n{"id":2}')
    const records: number[] = []
    const tail = createJsonlTail({
      path,
      parse: line => JSON.parse(line) as { id: number },
    })
    const unsubscribe = tail.subscribe(record => records.push(record.id))

    await eventually(() => expect(records).toEqual([1]))
    await appendFile(path, '\n{"id":3}\n')
    await eventually(() => expect(records).toEqual([1, 2, 3]))

    unsubscribe()
    tail.close()
  })

  it('resets its byte cursor when the writer truncates the file', async () => {
    const path = await createTemporaryJsonlFile('{"id":1}\n')
    const records: number[] = []
    const tail = createJsonlTail({ path, parse: line => JSON.parse(line) as { id: number } })
    const unsubscribe = tail.subscribe(record => records.push(record.id))

    await eventually(() => expect(records).toEqual([1]))
    await truncate(path, 0)
    await writeFile(path, '{"id":2}\n')
    await eventually(() => expect(records).toEqual([1, 2]))

    unsubscribe()
    tail.close()
  })

  it('stops delivering and releases its watcher when its final subscriber leaves', async () => {
    const path = await createTemporaryJsonlFile('{"id":1}\n')
    const records: number[] = []
    const tail = createJsonlTail({ path, parse: line => JSON.parse(line) as { id: number } })
    const unsubscribe = tail.subscribe(record => records.push(record.id))

    await eventually(() => expect(records).toEqual([1]))
    unsubscribe()
    await appendFile(path, '{"id":2}\n')
    await new Promise(resolve => setTimeout(resolve, 40))
    expect(records).toEqual([1])

    tail.close()
  })

  it('reports malformed lines without blocking later records', async () => {
    const path = await createTemporaryJsonlFile('{not-json}\n{"id":2}\n')
    const records: number[] = []
    const errors: string[] = []
    const tail = createJsonlTail({
      path,
      parse: line => JSON.parse(line) as { id: number },
      onParseError: error => errors.push(error.message),
    })
    const unsubscribe = tail.subscribe(record => records.push(record.id))

    await eventually(() => expect(records).toEqual([2]))
    expect(errors).toHaveLength(1)

    unsubscribe()
    tail.close()
  })
})

async function createTemporaryJsonlFile(content: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'cradle-jsonl-tail-'))
  temporaryDirectories.push(directory)
  const path = join(directory, 'events.jsonl')
  await writeFile(path, content)
  return path
}

async function eventually(assertion: () => void): Promise<void> {
  const deadline = Date.now() + 1_000
  let lastError: unknown = null
  while (Date.now() < deadline) {
    try {
      assertion()
      return
    }
    catch (error) {
      lastError = error
      await new Promise(resolve => setTimeout(resolve, 10))
    }
  }
  throw lastError
}
