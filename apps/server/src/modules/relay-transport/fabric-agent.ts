import { readFileSync } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'

import { getLogger } from '../../logging/logger'
import type { EnvelopePipe, EnvelopePipeHandlers } from './envelope-pipe'
import type { FabricIpcAuthFrame } from './ipc-envelope-pipe'
import { IpcEnvelopePipe } from './ipc-envelope-pipe'
import { WebSocketEnvelopePipe } from './websocket-envelope-pipe'

/**
 * Fabric agent discovery and envelope-carriage mode selection.
 *
 * The server learns the agent endpoint only through environment injection:
 *
 * - `CRADLE_FABRIC_AGENT_LOCATOR` — path to the agent's `agent.json` locator
 *   file. When present and readable, new pipes prefer the agent IPC contract.
 * - `CRADLE_FABRIC_AGENT_DISABLED` — escape hatch; `1` or `true` forces direct
 *   relayd WebSockets even when a locator is present.
 *
 * Resolution happens per connection attempt, never cached: an agent restart
 * rewrites its locator and token, so a pipe opened after the restart must see
 * fresh values. The fallback matrix is the degradation policy required by the
 * fabric-agent integration plan:
 *
 * - Locator absent or the escape hatch is set: direct WebSocket, silently —
 *   this is the normal standalone-server shape, not a degradation.
 * - Locator present but unreadable/invalid, token file unreadable, or the IPC
 *   TCP connect itself fails: direct WebSocket with a warning. A connect-time
 *   failure means the pipe never became writable, so falling back loses no
 *   byte the consumer already depended on.
 * - Once the IPC pipe reports open (the auth frame left the kernel), the pipe
 *   IS the link: any later death surfaces exactly like a relayd WebSocket
 *   death — no fallback, no replay. New connection attempts re-resolve the
 *   locator from scratch, so they use direct WebSocket while the agent is
 *   down and return to IPC once it is back; established pipes never migrate.
 *
 * The contract has no positive auth acknowledgement: a wrong token is an
 * immediate close after a successful TCP connect, indistinguishable from any
 * other post-open death. Wrong-token configurations therefore converge to
 * direct WebSocket across retries (each fresh attempt re-reads the token
 * file) rather than within one connection.
 */

const logger = getLogger().child({ module: 'fabric-agent-discovery' })

export interface FabricAgentEndpoint {
  /** Absolute path of the locator file the endpoint was read from. */
  locatorPath: string
  port: number
  /** Auth token read from the token file recorded in the locator. */
  token: string
}

export type FabricAgentResolution
  = | { mode: 'endpoint', endpoint: FabricAgentEndpoint }
    | { mode: 'absent' }
    | { mode: 'disabled' }
    | { mode: 'invalid', locatorPath: string, reason: string }

interface FabricAgentLocatorFile {
  version?: unknown
  port?: unknown
  tokenFile?: unknown
}

function fabricAgentDisabled(env: NodeJS.ProcessEnv): boolean {
  const value = env.CRADLE_FABRIC_AGENT_DISABLED?.trim().toLowerCase()
  return value === '1' || value === 'true'
}

/** Parse locator JSON content; pure so tests can pin the contract shape. */
export function parseFabricAgentLocator(content: string): { port: number, tokenFile: string } {
  let parsed: FabricAgentLocatorFile
  try {
    parsed = JSON.parse(content) as FabricAgentLocatorFile
  }
 catch {
    throw new Error('locator is not valid JSON')
  }
  if (parsed.version !== 1) {
    throw new Error(`unsupported locator version ${String(parsed.version)}`)
  }
  if (typeof parsed.port !== 'number' || !Number.isInteger(parsed.port) || parsed.port < 1 || parsed.port > 65_535) {
    throw new Error('locator port is not a valid TCP port')
  }
  if (typeof parsed.tokenFile !== 'string' || parsed.tokenFile.trim().length === 0) {
    throw new Error('locator tokenFile is missing')
  }
  return { port: parsed.port, tokenFile: parsed.tokenFile }
}

/**
 * Read one agent endpoint from its locator file. The token file path is
 * resolved relative to the locator file's directory (the contract places it
 * next to the agent's state directory, where the locator also lives); an
 * absolute path is honored as written. The token travels only through this
 * mode-0600 file — never a command line.
 */
export function readFabricAgentEndpoint(locatorPath: string): FabricAgentEndpoint {
  const locator = parseFabricAgentLocator(readFileSync(locatorPath, 'utf8'))
  const tokenPath = isAbsolute(locator.tokenFile)
    ? locator.tokenFile
    : join(dirname(locatorPath), locator.tokenFile)
  const token = readFileSync(tokenPath, 'utf8').trim()
  if (token.length === 0) {
    throw new Error('agent token file is empty')
  }
  return { locatorPath, port: locator.port, token }
}

/** Resolve the current agent endpoint from the environment, fresh per call. */
export function resolveFabricAgent(env: NodeJS.ProcessEnv = process.env): FabricAgentResolution {
  if (fabricAgentDisabled(env)) {
    return { mode: 'disabled' }
  }
  const locatorPath = env.CRADLE_FABRIC_AGENT_LOCATOR?.trim()
  if (!locatorPath) {
    return { mode: 'absent' }
  }
  try {
    return { mode: 'endpoint', endpoint: readFabricAgentEndpoint(locatorPath) }
  }
 catch (error) {
    return { mode: 'invalid', locatorPath, reason: error instanceof Error ? error.message : String(error) }
  }
}

/** Everything the carriage layer needs to reach one fabric route. */
export interface EnvelopePipeTarget {
  role: 'node' | 'controller'
  relayUrl: string
  fabricId: string
  /** Cert-bound Node identity (`nodeCertificate.subjectId`). */
  nodeId: string
  /** Required for the controller role, exactly one pipe per link. */
  linkId?: string
  /** Certificate/proof headers, sent verbatim on the WS upgrade or in the IPC auth frame. */
  headers: Record<string, string>
}

export function fabricRelayWebSocketUrl(relayUrl: string, path: string): URL {
  const url = new URL(path, `${relayUrl.replace(/\/+$/, '')}/`)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return url
}

function fabricRelayWebSocketPath(target: EnvelopePipeTarget): string {
  if (target.role === 'node') {
    return '/v1/ws/nodes'
  }
  return `/v1/ws/controllers/${encodeURIComponent(target.linkId ?? '')}`
}

function createDirectWebSocketPipe(target: EnvelopePipeTarget, handlers: EnvelopePipeHandlers): EnvelopePipe {
  return new WebSocketEnvelopePipe(fabricRelayWebSocketUrl(target.relayUrl, fabricRelayWebSocketPath(target)), target.headers, handlers)
}

/**
 * Open one envelope pipe for a fabric route, preferring the fabric agent IPC
 * when discovery resolves an endpoint and falling back to a direct relayd
 * WebSocket on connect-time failure as described at the top of this file.
 */
export function connectEnvelopePipe(target: EnvelopePipeTarget, handlers: EnvelopePipeHandlers): EnvelopePipe {
  const resolution = resolveFabricAgent()
  if (resolution.mode === 'invalid') {
    logger.warn('Fabric agent locator is unusable; using a direct relay WebSocket', {
      role: target.role,
      fabricId: target.fabricId,
      nodeId: target.nodeId,
      locatorPath: resolution.locatorPath,
      reason: resolution.reason,
    })
  }
  if (resolution.mode !== 'endpoint') {
    return createDirectWebSocketPipe(target, handlers)
  }
  return new FabricAgentCandidatePipe(target, resolution.endpoint, handlers)
}

/**
 * Two-phase pipe: fabric-agent IPC while the connection is still unproven,
 * transparently replaced by a direct relayd WebSocket if TCP connect or auth
 * write fails before the pipe ever became writable. Once the IPC pipe opens,
 * the composite forwards events verbatim — a later death is link death, not a
 * fallback trigger.
 */
class FabricAgentCandidatePipe implements EnvelopePipe {
  private inner: EnvelopePipe
  private fellBack = false
  private ipcOpened = false
  private closedByConsumer = false
  private tornDown = false

  constructor(
    private readonly target: EnvelopePipeTarget,
    endpoint: FabricAgentEndpoint,
    private readonly handlers: EnvelopePipeHandlers,
  ) {
    const auth: FabricIpcAuthFrame = {
      version: 1,
      token: endpoint.token,
      role: target.role,
      relayUrl: target.relayUrl,
      fabricId: target.fabricId,
      nodeId: target.nodeId,
      ...(target.role === 'controller' && target.linkId !== undefined ? { linkId: target.linkId } : {}),
      headers: target.headers,
    }
    this.inner = new IpcEnvelopePipe({ port: endpoint.port, auth }, {
      onOpen: () => {
        this.ipcOpened = true
        this.handlers.onOpen?.()
      },
      onMessage: (data) => {
        this.handlers.onMessage?.(data)
      },
      onError: (error) => {
        if (this.canFallBack()) {
          this.fallback(error)
          return
        }
        this.handlers.onError?.(error)
      },
      onClose: (code, reason) => {
        if (this.canFallBack()) {
          this.fallback()
          return
        }
        this.handlers.onClose?.(code, reason)
      },
    })
  }

  get open(): boolean {
    return this.inner.open
  }

  send(data: Uint8Array): void {
    this.inner.send(data)
  }

  close(code?: number, reason?: string): void {
    this.closedByConsumer = true
    this.inner.close(code, reason)
  }

  teardown(): void {
    if (this.tornDown) {
      return
    }
    this.tornDown = true
    this.inner.teardown()
  }

  /**
   * Fallback is only possible while the IPC connection never became usable:
   * no byte the consumer sent was ever accepted by a transport, so switching
   * carriage loses nothing. Once open — or once the consumer initiated the
   * close itself — the death is final.
   */
  private canFallBack(): boolean {
    return !this.fellBack && !this.ipcOpened && !this.closedByConsumer && !this.tornDown
  }

  private fallback(cause?: Error): void {
    if (!this.canFallBack()) {
      return
    }
    this.fellBack = true
    const ipc = this.inner
    this.inner = createDirectWebSocketPipe(this.target, this.handlers)
    ipc.teardown()
    logger.warn('Fabric agent IPC connect failed; falling back to a direct relay WebSocket', {
      role: this.target.role,
      fabricId: this.target.fabricId,
      nodeId: this.target.nodeId,
      error: cause?.message,
    })
  }
}
