import { describe, expect, it, vi } from 'vitest'

import { looksLikeJsonNdjsonLine, NdjsonLineSplitter } from './ndjson-lines'

describe('ndjsonLineSplitter', () => {
  it('splits only on LF and keeps U+2028 / U+2029 inside the record', () => {
    const lines: string[] = []
    const splitter = new NdjsonLineSplitter(line => lines.push(line))

    const description = 'chat.\u2028\n\nSimply type @Flight Network\u2029\n\nReal-Time'
    const message = JSON.stringify({
      method: 'app/list/updated',
      params: { description },
    })

    splitter.push(`${message}\n`)

    expect(lines).toHaveLength(1)
    expect(lines[0]).toBe(message)
    expect(JSON.parse(lines[0]!)).toEqual({
      method: 'app/list/updated',
      params: { description },
    })
  })

  it('supports CRLF record terminators without treating bare CR as a frame', () => {
    const lines: string[] = []
    const splitter = new NdjsonLineSplitter(line => lines.push(line))

    splitter.push('{"a":1}\r\n{"b":2}\r\n')

    expect(lines).toEqual(['{"a":1}', '{"b":2}'])
  })

  it('buffers partial chunks across pushes', () => {
    const lines: string[] = []
    const splitter = new NdjsonLineSplitter(line => lines.push(line))

    splitter.push('{"method":"a"')
    expect(lines).toEqual([])
    splitter.push(',"x":1}\n{"method":"b"}\n')
    expect(lines).toEqual(['{"method":"a","x":1}', '{"method":"b"}'])
  })

  it('flushes a trailing unterminated record', () => {
    const onLine = vi.fn()
    const splitter = new NdjsonLineSplitter(onLine)

    splitter.push('{"partial":true')
    expect(onLine).not.toHaveBeenCalled()
    splitter.flush()
    expect(onLine).toHaveBeenCalledExactlyOnceWith('{"partial":true')
  })
})

describe('looksLikeJsonNdjsonLine', () => {
  it('accepts object and array frames', () => {
    expect(looksLikeJsonNdjsonLine('  {"method":"x"}')).toBe(true)
    expect(looksLikeJsonNdjsonLine('[1,2]')).toBe(true)
  })

  it('rejects plaintext stdout pollution and escape-fragment leftovers', () => {
    expect(looksLikeJsonNdjsonLine('\\n\\nSimply type @Flight Network')).toBe(false)
    expect(looksLikeJsonNdjsonLine('fatal: something')).toBe(false)
  })
})
