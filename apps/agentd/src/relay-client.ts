import {
  encodeRemoteAgentFrame,
  parseRemoteAgentFrame,
  type RemoteAgentFrame,
} from '@cradle/remote-agent-protocol'
import {
  encodeRelayEnvelope,
  parseRelayEnvelope,
  type RelayEnvelope,
} from '@cradle/remote-relay-protocol'
import { WebSocket } from 'ws'

import { AgentdDaemon } from './daemon'
import { dispatchRemoteAgentFrame, invalidRemoteAgentFrame } from './protocol-dispatch'

export interface AgentdRelayClientOptions {
  homeDir: string
  relayUrl: string
  pairingToken: string
  hostToken?: string | null
  roomId?: string | null
}

export interface AgentdRelayClient {
  roomId: string
  pairingCode: string
  expiresAt: string
  close: () => Promise<void>
  closed: Promise<void>
}

export interface AgentdRelayHostSessionClient {
  roomId: string
  expiresAt: string
  close: () => Promise<void>
  closed: Promise<void>
}

export interface AgentdRelayHostSessionOptions {
  homeDir: string
  serverUrl: string
  enrollmentId: string
  enrollmentSecret: string
  ttlMs?: number
}

interface PairingStartResponse {
  roomId: string
  pairingCode: string
  hostToken?: string
  expiresAt: string
}

interface HostSessionResponse {
  relayUrl: string
  roomId: string
  roomStartToken: string
  hostToken: string
  expiresAt: string
}

interface RelayHostSessionResponse {
  roomId: string
  hostToken: string
  expiresAt: string
}

type RelayRawData = Buffer | ArrayBuffer | Buffer[]

interface RelayWebSocket {
  readyState: number
  on(event: 'message', listener: (raw: RelayRawData) => void): void
  once(event: 'open', listener: () => void): void
  once(event: 'close', listener: () => void): void
  once(event: 'error', listener: (error: Error) => void): void
  close(code?: number, reason?: string): void
  send(data: string, callback: (error?: Error) => void): void
}

interface RelayWebSocketConstructor {
  readonly OPEN: number
  new(url: string, options: { headers: Record<string, string> }): RelayWebSocket
}

// ws publishes both browser and Node entry points; this package's bundler resolution
// sees the browser-shaped type. Keep the Node cast isolated at the transport boundary.
const NodeWebSocket = WebSocket as unknown as RelayWebSocketConstructor

export async function startAgentdRelayClient(options: AgentdRelayClientOptions): Promise<AgentdRelayClient> {
  const daemon = new AgentdDaemon({ homeDir: options.homeDir })
  const pairing = await startPairing(options)
  const hostToken = pairing.hostToken || options.hostToken?.trim()
  if (!hostToken) {
    throw new Error('agentd relay host token is required')
  }
  const { socket, opened } = createHostSocket(options.relayUrl, hostToken)
  const client = new RelayHostConnection({
    daemon,
    socket,
    roomId: pairing.roomId,
  })
  client.start()
  await opened.catch(async (error: unknown) => {
    await client.close()
    throw error
  })
  return {
    roomId: pairing.roomId,
    pairingCode: pairing.pairingCode,
    expiresAt: pairing.expiresAt,
    close: () => client.close(),
    closed: client.closed,
  }
}

export async function startAgentdRelayHostSessionClient(
  options: AgentdRelayHostSessionOptions,
): Promise<AgentdRelayHostSessionClient> {
  const daemon = new AgentdDaemon({ homeDir: options.homeDir })
  const session = await createHostSession(options)
  const started = await startRelayHostSession(session.relayUrl, session.roomStartToken, session.hostToken)
  const { socket, opened } = createHostSocket(session.relayUrl, started.hostToken)
  const client = new RelayHostConnection({
    daemon,
    socket,
    roomId: started.roomId,
  })
  client.start()
  await opened.catch(async (error: unknown) => {
    await client.close()
    throw error
  })
  return {
    roomId: started.roomId,
    expiresAt: started.expiresAt,
    close: () => client.close(),
    closed: client.closed,
  }
}

async function startPairing(options: AgentdRelayClientOptions): Promise<PairingStartResponse> {
  const response = await fetch(joinURL(options.relayUrl, '/pairing/start'), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${options.pairingToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      ...(options.hostToken ? { hostToken: options.hostToken } : {}),
      ...(options.roomId ? { roomId: options.roomId } : {}),
    }),
  })
  if (!response.ok) {
    throw new Error(`agentd relay pairing failed: HTTP ${response.status}`)
  }
  return await response.json() as PairingStartResponse
}

async function createHostSession(options: AgentdRelayHostSessionOptions): Promise<HostSessionResponse> {
  const response = await fetch(joinURL(
    options.serverUrl,
    `/remote-hosts/relay/enrollments/${encodeURIComponent(options.enrollmentId)}/host-session`,
  ), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      enrollmentSecret: options.enrollmentSecret,
      ...(options.ttlMs ? { ttlMs: options.ttlMs } : {}),
    }),
  })
  if (!response.ok) {
    throw new Error(`agentd relay host session failed: HTTP ${response.status}`)
  }
  return await response.json() as HostSessionResponse
}

async function startRelayHostSession(
  relayUrl: string,
  roomStartToken: string,
  hostToken: string,
): Promise<RelayHostSessionResponse> {
  const response = await fetch(joinURL(relayUrl, '/rooms/host-session'), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${roomStartToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ hostToken }),
  })
  if (!response.ok) {
    throw new Error(`agentd relay room start failed: HTTP ${response.status}`)
  }
  return await response.json() as RelayHostSessionResponse
}

function createHostSocket(
  relayUrl: string,
  hostToken: string,
): { socket: RelayWebSocket, opened: Promise<void> } {
  const socket = new NodeWebSocket(joinWebSocketURL(relayUrl, '/ws/host'), {
    headers: {
      Authorization: `Bearer ${hostToken}`,
    },
  })
  const opened = new Promise<void>((resolve, reject) => {
    socket.once('open', () => resolve())
    socket.once('error', reject)
  })
  return { socket, opened }
}

class RelayHostConnection {
  readonly closed: Promise<void>

  private seq = 1
  private resolveClosed!: () => void
  private rejectClosed!: (error: Error) => void

  constructor(private readonly options: {
    daemon: AgentdDaemon
    socket: RelayWebSocket
    roomId: string
  }) {
    this.closed = new Promise((resolve, reject) => {
      this.resolveClosed = resolve
      this.rejectClosed = reject
    })
  }

  start(): void {
    this.options.socket.on('message', (raw) => {
      void this.handleMessage(raw)
    })
    this.options.socket.once('close', () => {
      this.resolveClosed()
    })
    this.options.socket.once('error', (error) => {
      this.rejectClosed(error instanceof Error ? error : new Error(String(error)))
    })
  }

  async close(): Promise<void> {
    if (this.options.socket.readyState === NodeWebSocket.OPEN) {
      this.options.socket.close(1000, 'agentd relay client closed')
    }
    await this.closed.catch(() => undefined)
  }

  private async handleMessage(raw: RelayRawData): Promise<void> {
    let envelope: RelayEnvelope
    try {
      envelope = parseRelayEnvelope(raw.toString())
    }
    catch (error) {
      await this.sendRemoteAgentFrame(invalidRemoteAgentFrame(error))
      return
    }
    if (envelope.kind !== 'remote_agent_frame') {
      return
    }

    let frame: RemoteAgentFrame
    try {
      frame = parseRemoteAgentFrame(envelope.payload)
    }
    catch (error) {
      await this.sendRemoteAgentFrame(invalidRemoteAgentFrame(error))
      return
    }

    await dispatchRemoteAgentFrame(this.options.daemon, frame, async (response) => {
      await this.sendRemoteAgentFrame(response)
    })
  }

  private async sendRemoteAgentFrame(frame: RemoteAgentFrame): Promise<void> {
    const payload = JSON.parse(encodeRemoteAgentFrame(frame))
    const streamId = streamIdForFrame(frame)
    const envelope: RelayEnvelope = {
      version: 1,
      roomId: this.options.roomId,
      seq: this.seq++,
      kind: 'remote_agent_frame',
      ...(streamId ? { streamId } : {}),
      payload,
    }
    await this.send(encodeRelayEnvelope(envelope))
  }

  private send(data: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.options.socket.readyState !== NodeWebSocket.OPEN) {
        reject(new Error('agentd relay socket is not open'))
        return
      }
      this.options.socket.send(data, (error) => {
        if (error) {
          reject(error)
          return
        }
        resolve()
      })
    })
  }
}

function streamIdForFrame(frame: RemoteAgentFrame): string | null {
  switch (frame.kind) {
    case 'stream.open':
    case 'stream.next':
    case 'stream.error':
    case 'stream.close':
      return frame.streamId
    default:
      return null
  }
}

function joinURL(base: string, path: string): string {
  return new URL(path, ensureTrailingSlash(base)).toString()
}

function joinWebSocketURL(base: string, path: string): string {
  const url = new URL(path, ensureTrailingSlash(base))
  if (url.protocol === 'http:') {
    url.protocol = 'ws:'
  }
  else if (url.protocol === 'https:') {
    url.protocol = 'wss:'
  }
  return url.toString()
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith('/') ? value : `${value}/`
}
