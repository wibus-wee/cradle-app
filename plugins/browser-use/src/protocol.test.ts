import { describe, expect, it } from 'vitest'

import type { BrowserCommand } from './protocol'
import { encodeFrame, FrameDecoder } from './protocol'

describe('browser-use protocol framing', () => {
  it('decodes a complete frame', () => {
    const decoder = new FrameDecoder()
    const command: BrowserCommand = { id: 'one', type: 'tabs_list' }

    expect(decoder.push(encodeFrame(command))).toEqual([command])
  })

  it('waits for split frame chunks', () => {
    const decoder = new FrameDecoder()
    const command: BrowserCommand = { id: 'two', type: 'get_text', selector: 'main' }
    const frame = encodeFrame(command)

    expect(decoder.push(frame.subarray(0, 3))).toEqual([])
    expect(decoder.push(frame.subarray(3, 8))).toEqual([])
    expect(decoder.push(frame.subarray(8))).toEqual([command])
  })

  it('decodes multiple frames in one chunk', () => {
    const decoder = new FrameDecoder()
    const first: BrowserCommand = { id: 'first', type: 'tabs_list' }
    const second: BrowserCommand = { id: 'second', type: 'keyboard', key: 'Enter' }

    expect(decoder.push(Buffer.concat([encodeFrame(first), encodeFrame(second)]))).toEqual([first, second])
  })
})
