import type { AddressInfo } from 'node:net'
import net from 'node:net'

import { afterEach, describe, expect, it } from 'vitest'

import type { EnvelopePipeHandlers } from '../../src/modules/relay-transport/envelope-pipe'
import type { FabricIpcAuthFrame } from '../../src/modules/relay-transport/ipc-envelope-pipe'
import {
  encodeFabricIpcFrame,
  FABRIC_IPC_MAX_FRAME_BYTES,
  FabricIpcFrameParser,
  IpcEnvelopePipe,
} from '../../src/modules/relay-transport/ipc-envelope-pipe'

const TOKEN = 'test-ipc-token'

function validAuth(overrides: Partial<FabricIpcAuthFrame> = {}): FabricIpcAuthFrame {
  return {
    version: 1,
    token: TOKEN,
    role: 'controller',
    relayUrl: 'http://relay.test:8787',
    fabricId: 'fabric-1',
    nodeId: 'node-1',
    linkId: 'link-1',
    headers: { 'x-cradle-fabric-certificate': 'cert', 'x-cradle-fabric-proof': 'proof' },
    ...overrides,
  }
}

interface FakeAgent {
  port: number
  close: () => Promise<void>
  auths: FabricIpcAuthFrame[]
  /** Envelopes received after auth, as raw frame bytes. */
  envelopes: Buffer[]
  /** Send framed bytes to every authenticated connection. */
  broadcast: (payload: Buffer) => void
  /** Write one frame to authenticated connections in fixed-size slices. */
  broadcastSliced: (payload: Buffer, sliceBytes: number) => void
  /** Destroy every connection without sending anything. */
  destroyConnections: () => void
  connections: () => number
}

/**
 * In-process agent speaking the fabric-agent IPC contract: first frame must
 * be the JSON auth frame with the right token — a wrong token closes the
 * connection without a reply — every later frame passes through verbatim.
 */
function startFakeAgent(options: { token?: string, dropAfterAuthBytes?: number } = {}): Promise<FakeAgent> {
  const expectedToken = options.token ?? TOKEN
  const auths: FabricIpcAuthFrame[] = []
  const envelopes: Buffer[] = []
  const sockets = new Set<net.Socket>()
  const server = net.createServer((socket) => {
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
    let authenticated = false
    const parser = new FabricIpcFrameParser()
    socket.on('data', (chunk) => {
      let frames: Uint8Array[]
      try {
        frames = parser.push(chunk)
      }
 catch {
        socket.destroy()
        return
      }
      for (const frame of frames) {
        if (!authenticated) {
          let auth: FabricIpcAuthFrame
          try {
            auth = JSON.parse(Buffer.from(frame.buffer, frame.byteOffset, frame.byteLength).toString('utf8')) as FabricIpcAuthFrame
          }
 catch {
            socket.destroy()
            return
          }
          if (auth.token !== expectedToken) {
            // Contract: a wrong token closes the connection without a reply.
            socket.destroy()
            return
          }
          authenticated = true
          auths.push(auth)
          if (options.dropAfterAuthBytes !== undefined) {
            // Test-only upstream death: close after mirroring N bytes.
            socket.write(encodeFabricIpcFrame(Buffer.alloc(options.dropAfterAuthBytes, 1)))
            socket.end()
          }
          continue
        }
        envelopes.push(Buffer.from(frame.buffer, frame.byteOffset, frame.byteLength))
      }
    })
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo
      resolve({
        port,
        auths,
        envelopes,
        broadcast: (payload) => {
          const framed = encodeFabricIpcFrame(payload)
          for (const socket of sockets) {
            socket.write(framed)
          }
        },
        broadcastSliced: (payload, sliceBytes) => {
          const framed = encodeFabricIpcFrame(payload)
          for (const socket of sockets) {
            for (let offset = 0; offset < framed.byteLength; offset += sliceBytes) {
              socket.write(framed.subarray(offset, Math.min(offset + sliceBytes, framed.byteLength)))
            }
          }
        },
        destroyConnections: () => {
          for (const socket of sockets) {
            socket.destroy()
          }
        },
        connections: () => sockets.size,
        close: () => new Promise((done) => {
          for (const socket of sockets) {
            socket.destroy()
          }
          server.close(() => done())
        }),
      })
    })
  })
}

function connectPipe(port: number, handlers: EnvelopePipeHandlers, auth: Partial<FabricIpcAuthFrame> = {}): IpcEnvelopePipe {
  return new IpcEnvelopePipe({ port, auth: validAuth(auth) }, handlers)
}

function waitFor(condition: () => boolean, timeoutMs = 5_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const poll = () => {
      if (condition()) {
        resolve()
        return
      }
      if (Date.now() - started > timeoutMs) {
        reject(new Error('timed out waiting for condition'))
        return
      }
      setTimeout(poll, 5)
    }
    poll()
  })
}

function events() {
  return {
    opened: 0,
    closed: 0,
    errors: [] as Error[],
    messages: [] as Uint8Array[],
    handlers(): EnvelopePipeHandlers {
      return {
        onOpen: () => { this.opened += 1 },
        onClose: () => { this.closed += 1 },
        onError: error => this.errors.push(error),
        onMessage: data => this.messages.push(data),
      }
    },
  }
}

describe('fabric agent IPC envelope pipe', () => {
  const agents: FakeAgent[] = []
  const pipes: IpcEnvelopePipe[] = []

  afterEach(async () => {
    for (const pipe of pipes.splice(0)) {
      pipe.teardown()
    }
    for (const agent of agents.splice(0)) {
      await agent.close()
    }
  })

  async function spawnAgent(options: Parameters<typeof startFakeAgent>[0] = {}): Promise<FakeAgent> {
    const agent = await startFakeAgent(options)
    agents.push(agent)
    return agent
  }

  it('sends the length-prefixed JSON auth frame first with token, role, route, and headers', async () => {
    const agent = await spawnAgent()
    const pipe = connectPipe(agent.port, {})
    pipes.push(pipe)
    await waitFor(() => agent.auths.length === 1)

    expect(agent.auths[0]).toEqual(validAuth())
  })

  it('closes without a reply when the token is wrong', async () => {
    const agent = await spawnAgent()
    const seen = events()
    const pipe = connectPipe(agent.port, seen.handlers(), { token: 'wrong-token' })
    pipes.push(pipe)
    await waitFor(() => seen.closed === 1)

    expect(seen.opened).toBe(1)
    expect(agent.auths).toHaveLength(0)
    expect(seen.messages).toHaveLength(0)
    expect(pipe.open).toBe(false)
  })

  it('delivers a pass-through envelope in both directions without modification', async () => {
    const agent = await spawnAgent()
    const seen = events()
    const pipe = connectPipe(agent.port, seen.handlers())
    pipes.push(pipe)
    await waitFor(() => seen.opened === 1)

    // 32 binary bytes with a NUL prefix — nothing envelope-shaped, proving pass-through.
    const outbound = Buffer.concat([Buffer.alloc(4, 0), Buffer.from('cradle-fabric-payload')])
    pipe.send(new Uint8Array(outbound.buffer, outbound.byteOffset, outbound.byteLength))
    await waitFor(() => agent.envelopes.length === 1)
    expect(agent.envelopes[0]!.equals(outbound)).toBe(true)

    const inbound = Buffer.from([3, 1, 2, 0, 9, 9, 9, 9])
    agent.broadcast(inbound)
    await waitFor(() => seen.messages.length === 1)
    expect(Buffer.from(seen.messages[0]!).equals(inbound)).toBe(true)
  })

  it('passes a multi-KiB frame through fragmented pipe writes without corruption', async () => {
    const agent = await spawnAgent()
    const seen = events()
    const pipe = connectPipe(agent.port, seen.handlers())
    pipes.push(pipe)
    await waitFor(() => seen.opened === 1)

    const payload = Buffer.alloc(4_096)
    for (let index = 0; index < payload.byteLength; index += 1) {
      payload[index] = index % 251
    }
    // The pipe writes prefix and payload as separate writes; TCP is free to
    // fragment or coalesce, and the agent-side parser must reassemble either way.
    pipe.send(new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength))
    await waitFor(() => agent.envelopes.length === 1)
    expect(agent.envelopes[0]!.equals(payload)).toBe(true)
  })

  it('reassembles inbound frames the agent writes in small slices', async () => {
    const agent = await spawnAgent()
    const seen = events()
    const pipe = connectPipe(agent.port, seen.handlers())
    pipes.push(pipe)
    await waitFor(() => seen.opened === 1)

    const payload = Buffer.alloc(2_000)
    for (let index = 0; index < payload.byteLength; index += 1) {
      payload[index] = index % 256
    }
    // Sliced writes exercise the reassembly path regardless of how loopback
    // TCP coalesces them; exact fragmentation positions are covered by the
    // deterministic parser unit tests below.
    agent.broadcastSliced(payload, 97)
    await waitFor(() => seen.messages.length === 1)
    expect(Buffer.from(seen.messages[0]!.buffer, seen.messages[0]!.byteOffset, seen.messages[0]!.byteLength).equals(payload)).toBe(true)
  })

  it('closes with an error when the agent announces more than the 1 MiB cap', async () => {
    // A contract-violating peer: accepts anything, then announces oversize.
    const violator = net.createServer((socket) => {
      socket.once('data', () => {
        const announcement = Buffer.alloc(4)
        announcement.writeUInt32BE(FABRIC_IPC_MAX_FRAME_BYTES + 1, 0)
        socket.write(announcement)
      })
    })
    await new Promise<void>((resolve, reject) => {
      violator.once('error', reject)
      violator.listen(0, '127.0.0.1', resolve)
    })
    const { port } = violator.address() as AddressInfo

    const seen = events()
    const pipe = connectPipe(port, seen.handlers())
    pipes.push(pipe)
    await waitFor(() => seen.opened === 1)
    await waitFor(() => seen.closed === 1)

    expect(seen.errors.some(error => /1 MiB/u.test(error.message))).toBe(true)
    expect(pipe.open).toBe(false)
    await new Promise<void>(resolve => violator.close(() => resolve()))
  })

  it('dies exactly once when the agent drops an established connection', async () => {
    const agent = await spawnAgent()
    const seen = events()
    const pipe = connectPipe(agent.port, seen.handlers())
    pipes.push(pipe)
    await waitFor(() => seen.opened === 1)

    agent.destroyConnections()
    await waitFor(() => seen.closed === 1)
    expect(seen.opened).toBe(1)
    expect(pipe.open).toBe(false)
    // No replay: bytes sent after death are dropped silently, never buffered.
    pipe.send(new Uint8Array([1, 2, 3]))
    expect(agent.envelopes).toHaveLength(0)
  })

  it('drops outbound bytes while still connecting instead of throwing', async () => {
    const agent = await spawnAgent()
    const pipe = new IpcEnvelopePipe({ port: agent.port, auth: validAuth() }, {})
    pipes.push(pipe)
    // Possibly still connecting — must never throw.
    expect(() => pipe.send(new Uint8Array([1, 2, 3]))).not.toThrow()
    pipe.teardown()
  })
})

describe('fabric IPC frame parser', () => {
  it('emits a zero-copy view when one chunk holds a complete frame', () => {
    const parser = new FabricIpcFrameParser()
    const payload = Buffer.from('envelope-bytes')
    const chunk = encodeFabricIpcFrame(payload)

    const frames = parser.push(chunk)

    expect(frames).toHaveLength(1)
    const frame = frames[0]!
    expect(Buffer.from(frame.buffer, frame.byteOffset, frame.byteLength).equals(payload)).toBe(true)
    // Zero-copy proof: mutating the delivered view mutates the original chunk.
    frame[0] = 88
    expect(chunk[4]).toBe(88)
  })

  it('preserves trailing bytes of a second frame inside the same chunk', () => {
    const parser = new FabricIpcFrameParser()
    const first = encodeFabricIpcFrame(Buffer.from('aaaa'))
    const second = encodeFabricIpcFrame(Buffer.from('bb'))
    const frames = parser.push(Buffer.concat([first, second]))

    expect(frames).toHaveLength(2)
    expect(Buffer.from(frames[0]!.buffer, frames[0]!.byteOffset, frames[0]!.byteLength).toString()).toBe('aaaa')
    expect(Buffer.from(frames[1]!.buffer, frames[1]!.byteOffset, frames[1]!.byteLength).toString()).toBe('bb')
  })

  it('reassembles a frame fragmented at every byte position', () => {
    const payload = Buffer.alloc(300)
    for (let index = 0; index < payload.byteLength; index += 1) {
      payload[index] = index % 256
    }
    const framed = encodeFabricIpcFrame(payload)
    for (const split of [1, 2, 3, 4, 5, 7, 100, 303]) {
      const parser = new FabricIpcFrameParser()
      const frames: Uint8Array[] = []
      for (let offset = 0; offset < framed.byteLength; offset += split) {
        frames.push(...parser.push(Buffer.from(framed.subarray(offset, Math.min(offset + split, framed.byteLength)))))
      }
      expect(frames).toHaveLength(1)
      expect(Buffer.from(frames[0]!.buffer, frames[0]!.byteOffset, frames[0]!.byteLength).equals(payload)).toBe(true)
    }
  })

  it('reassembles a length prefix split across chunks', () => {
    const parser = new FabricIpcFrameParser()
    const framed = encodeFabricIpcFrame(Buffer.from('prefix-split'))
    expect(parser.push(Buffer.from(framed.subarray(0, 2)))).toHaveLength(0)
    const frames = parser.push(Buffer.from(framed.subarray(2)))
    expect(frames).toHaveLength(1)
    expect(Buffer.from(frames[0]!.buffer, frames[0]!.byteOffset, frames[0]!.byteLength).toString()).toBe('prefix-split')
  })

  it('rejects a frame announcing more than the 1 MiB cap', () => {
    const parser = new FabricIpcFrameParser()
    const announcement = Buffer.alloc(4)
    announcement.writeUInt32BE(FABRIC_IPC_MAX_FRAME_BYTES + 1, 0)

    expect(() => parser.push(announcement)).toThrow(/1 MiB/u)
  })

  it('accepts a frame at exactly the 1 MiB cap boundary', () => {
    const parser = new FabricIpcFrameParser()
    const payload = Buffer.alloc(FABRIC_IPC_MAX_FRAME_BYTES, 1)
    const frames = parser.push(encodeFabricIpcFrame(payload))

    expect(frames).toHaveLength(1)
    expect(frames[0]!.byteLength).toBe(FABRIC_IPC_MAX_FRAME_BYTES)
  })
})
