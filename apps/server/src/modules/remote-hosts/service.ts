import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import type { RemoteHost } from '@cradle/db'
import { remoteHosts } from '@cradle/db'
import type {
  AgentListResult,
  AgentStartParams,
  AgentStartResult,
  FsListDirectoryParams,
  FsListDirectoryResult,
  FsReadFileParams,
  FsReadFileResult,
  FsStatParams,
  FsStatResult,
  GitProbeRepositoryParams,
  GitProbeRepositoryResult,
  HostHealthResult,
  RemoteAgentParams,
  RemoteAgentResult,
  RemoteAgentStreamMethod,
  RemoteAgentStreamValue,
  RemoteAgentUnaryMethod,
  RuntimeListResult,
  WorkspaceListParams,
  WorkspaceListResult,
} from '@cradle/remote-agent-protocol'
import { asc, eq } from 'drizzle-orm'
import { z } from 'zod'

import { AppError } from '../../errors/app-error'
import { db } from '../../infra'
import { createRelayRoomId, mintRelayToken } from '../relay-servers/relay-token-service'
import { readDefaultRelayServer, resolveRelayUrl } from '../relay-servers/service'
import {
  startRemoteCradleServerTunnel,
  type RemoteCradleServerTunnelHandle,
} from './cradle-server-tunnel'
import {
  createRemoteAgentDaemonClient,
  RemoteAgentRpcError,
  RemoteAgentTransportError,
  type RemoteAgentDaemonClient,
  type RemoteHostConnectionState,
} from './daemon-client'
import {
  createRelayRemoteAgentDaemonClient,
} from './relay-transport'
import {
  deleteRemoteHostAgentdSessionLink,
  readRemoteHostAgentdSessionLink,
  upsertRemoteHostAgentdSessionLink,
  type UpsertRemoteHostAgentdSessionLinkInput,
} from './session-links'
import { startSshTunnel, type SshTunnelHandle } from './ssh-tunnel'

export {
  deleteRemoteHostAgentdSessionLink,
  readRemoteHostAgentdSessionLink,
  upsertRemoteHostAgentdSessionLink,
  type UpsertRemoteHostAgentdSessionLinkInput,
}

export interface CreateRemoteHostInput {
  id?: string
  displayName: string
  enabled?: boolean
  connectionConfig?: RemoteHostConnectionConfigInput
  capabilities?: RemoteHostCapabilitiesInput
}

export interface UpdateRemoteHostInput {
  displayName?: string
  enabled?: boolean
  connectionConfig?: RemoteHostConnectionConfigInput
  capabilities?: RemoteHostCapabilitiesInput
}

export type RemoteHostTransport = 'ssh' | 'direct-socket' | 'relay'

export interface RemoteHostSshProfileInput {
  hostName: string
  user?: string | null
  port?: number | null
  auth?: 'default' | 'identityFile'
  identityFilePath?: string | null
}

export interface RemoteHostSshProfile {
  hostName: string
  user: string | null
  port: number | null
  auth: 'default' | 'identityFile'
  identityFilePath: string | null
}

export interface RemoteHostConnectionConfigInput {
  transport?: RemoteHostTransport
  localSocketPath?: string
  ssh?: RemoteHostSshProfileInput
  relay?: RemoteHostRelayConfig
  sshExecutable?: string
  sshArgs?: string[]
  connectTimeoutMs?: number
}

export interface RemoteHostAgentdCapabilityInput {
  enabled?: boolean
  remoteSocketPath?: string
  lastDaemonHostId?: string | null
  lastDaemonVersion?: string | null
  lastPlatform?: string | null
  lastArch?: string | null
}

export interface RemoteHostCradleServerCapabilityInput {
  enabled?: boolean
  remoteHost?: string
  remotePort?: number
}

export interface RemoteHostCapabilitiesInput {
  agentd?: RemoteHostAgentdCapabilityInput
  cradleServer?: RemoteHostCradleServerCapabilityInput
}

export interface SshProfileLaunchConfig {
  sshTarget: string
  sshArgs: string[]
}

export interface RemoteHostView extends RemoteHost {
  connectionState: RemoteHostConnectionState
  lastError: string | null
}

export interface RemoteHostConnectionView {
  hostId: string
  state: RemoteHostConnectionState
  localSocketPath: string | null
  daemonHostId: string | null
  daemonVersion: string | null
  platform: string | null
  arch: string | null
  lastError: string | null
}

export interface RemoteHostHealthView {
  hostId: string
  status: 'ok' | 'offline'
  daemonVersion: string | null
  daemonHostId: string | null
  uptimeSeconds: number | null
  connectionState: RemoteHostConnectionState
  lastError: string | null
}

interface RemoteHostConnectionRecord {
  host: RemoteHost
  client: RemoteAgentDaemonClient | null
  tunnel: SshTunnelHandle | null
  localSocketPath: string | null
  lastError: string | null
  tunnelExited: boolean
}

interface ConnectionConfigTransportFields {
  transport?: RemoteHostTransport
  localSocketPath?: string
  ssh?: RemoteHostSshProfile
  relay?: RemoteHostRelayConfig
}

export interface RemoteHostRelayConfig {
  relayUrl: string
  enrollmentId?: string
  relayServerId?: string | null
  enrollmentSecretHash?: string
  lastSessionRoomId?: string
  lastSeenAt?: number
}

interface RemoteHostRelaySessionConfig {
  relayUrl: string
  roomId: string
  controllerToken: string
}

interface RemoteHostAgentdCapability {
  enabled: boolean
  remoteSocketPath: string
  lastDaemonHostId: string | null
  lastDaemonVersion: string | null
  lastPlatform: string | null
  lastArch: string | null
}

interface RemoteHostCradleServerCapability {
  enabled: boolean
  remoteHost: string
  remotePort: number
}

interface RemoteHostCapabilities {
  agentd: RemoteHostAgentdCapability
  cradleServer: RemoteHostCradleServerCapability
}

interface NormalizedRemoteHostConnection {
  connectionConfigJson: string
  capabilitiesJson: string
}

interface RemoteHostConnectionPatch {
  connectionConfig?: RemoteHostConnectionConfigInput
  capabilities?: RemoteHostCapabilitiesInput
}

const nonBlankStringSchema = z.string().trim().min(1)
const DEFAULT_REMOTE_DAEMON_SOCKET_PATH = '~/.cradle/agentd/agent.sock'
const UNIX_SOCKET_PATH_LIMIT = 100
const transportSchema = z.enum(['ssh', 'direct-socket', 'relay'])
const sshAuthSchema = z.enum(['default', 'identityFile'])
const sshProfileSchema = z.object({
  hostName: nonBlankStringSchema,
  user: nonBlankStringSchema.nullable().optional(),
  port: z.number().int().min(1).max(65_535).nullable().optional(),
  auth: sshAuthSchema.default('default'),
  identityFilePath: nonBlankStringSchema.nullable().optional(),
}).superRefine((profile, ctx) => {
  if (profile.auth === 'identityFile' && !profile.identityFilePath) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['identityFilePath'],
      message: 'identityFilePath is required when SSH auth is identityFile.',
    })
  }
  if (profile.auth === 'default' && profile.identityFilePath) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['identityFilePath'],
      message: 'identityFilePath can only be set when SSH auth is identityFile.',
    })
  }
}).transform(profile => ({
  hostName: profile.hostName,
  user: profile.user ?? null,
  port: profile.port ?? null,
  auth: profile.auth,
  identityFilePath: profile.auth === 'identityFile' ? profile.identityFilePath ?? null : null,
}))

const connectionConfigSchema = z.object({
  transport: transportSchema.optional(),
  localSocketPath: nonBlankStringSchema.optional(),
  ssh: sshProfileSchema.optional(),
  relay: z.object({
    relayUrl: nonBlankStringSchema,
    enrollmentId: nonBlankStringSchema.optional(),
    relayServerId: nonBlankStringSchema.nullable().optional(),
    enrollmentSecretHash: nonBlankStringSchema.optional(),
    lastSessionRoomId: nonBlankStringSchema.optional(),
    lastSeenAt: z.number().int().nonnegative().optional(),
  }).optional(),
  sshExecutable: nonBlankStringSchema.optional(),
  sshArgs: z.array(z.string()).optional(),
  connectTimeoutMs: z.number().int().positive().max(120_000).optional(),
}).passthrough().superRefine((config, ctx) => {
  if (config.transport === 'direct-socket' && !config.localSocketPath) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['localSocketPath'],
      message: 'localSocketPath is required when transport is direct-socket.',
    })
  }
  if (config.transport === 'relay' && !config.relay) {
    return
  }
  // A relay host is created "pending" — transport is relay but the relay
  // enrollment is only filled in once the user completes pairing from the UI.
  // Until then there is no relay block, and connecting fails until enrollment
  // is done and agentd has started a host session.
}).transform(config => ({
  ...config,
  transport: config.transport ?? 'ssh',
}))

type RemoteHostConnectionConfig = z.infer<typeof connectionConfigSchema>

const agentdCapabilitySchema = z.object({
  enabled: z.boolean().default(true),
  remoteSocketPath: nonBlankStringSchema.default(DEFAULT_REMOTE_DAEMON_SOCKET_PATH),
  lastDaemonHostId: nonBlankStringSchema.nullable().optional(),
  lastDaemonVersion: nonBlankStringSchema.nullable().optional(),
  lastPlatform: nonBlankStringSchema.nullable().optional(),
  lastArch: nonBlankStringSchema.nullable().optional(),
}).transform(agentd => ({
  enabled: agentd.enabled,
  remoteSocketPath: agentd.remoteSocketPath,
  lastDaemonHostId: agentd.lastDaemonHostId ?? null,
  lastDaemonVersion: agentd.lastDaemonVersion ?? null,
  lastPlatform: agentd.lastPlatform ?? null,
  lastArch: agentd.lastArch ?? null,
}))

const cradleServerCapabilitySchema = z.object({
  enabled: z.boolean().default(false),
  remoteHost: nonBlankStringSchema.default('127.0.0.1'),
  remotePort: z.number().int().min(1).max(65_535).default(21_423),
}).transform(cradleServer => ({
  enabled: cradleServer.enabled,
  remoteHost: cradleServer.remoteHost,
  remotePort: cradleServer.remotePort,
}))

const capabilitiesSchema = z.object({
  agentd: agentdCapabilitySchema.default({
    enabled: true,
    remoteSocketPath: DEFAULT_REMOTE_DAEMON_SOCKET_PATH,
    lastDaemonHostId: null,
    lastDaemonVersion: null,
    lastPlatform: null,
    lastArch: null,
  }),
  cradleServer: cradleServerCapabilitySchema.default({
    enabled: false,
    remoteHost: '127.0.0.1',
    remotePort: 21_423,
  }),
}).transform(capabilities => ({
  agentd: capabilities.agentd,
  cradleServer: capabilities.cradleServer,
}))

const connections = new Map<string, RemoteHostConnectionRecord>()
const connectPromises = new Map<string, Promise<RemoteHostConnectionView>>()
const cradleServerConnections = new Map<string, RemoteCradleServerConnectionRecord>()
const cradleServerConnectPromises = new Map<string, Promise<RemoteCradleServerConnectionView>>()

interface RemoteCradleServerConnectionRecord {
  host: RemoteHost
  tunnel: RemoteCradleServerTunnelHandle | null
  lastError: string | null
  tunnelExited: boolean
}

export interface RemoteCradleServerConnectionView {
  hostId: string
  state: 'idle' | 'connected' | 'offline'
  localBaseUrl: string | null
  lastError: string | null
}

export interface RemoteCradleServerHealthPayload {
  status: 'ok'
  uptime: number
  memory: {
    heapUsed: number
    heapTotal: number
    rss: number
    external: number
  }
  cpu: {
    percent: number | null
    userMicros: number
    systemMicros: number
    sampleMs: number | null
    usedMicros: number | null
    windowReady: boolean
  }
  timestamp: number
}

export interface RemoteCradleServerHealthView extends RemoteCradleServerConnectionView {
  status: 'ok'
  health: RemoteCradleServerHealthPayload
}

export function listRemoteHosts(): RemoteHostView[] {
  return db()
    .select()
    .from(remoteHosts)
    .orderBy(asc(remoteHosts.displayName), asc(remoteHosts.id))
    .all()
    .map(toHostView)
}

export function readRemoteHost(hostId: string): RemoteHostView {
  return toHostView(requireRemoteHost(hostId))
}

export function createRemoteHost(input: CreateRemoteHostInput): RemoteHostView {
  const now = currentUnixSeconds()
  const normalized = normalizeRemoteHostConnection(input, null)
  const row = db()
    .insert(remoteHosts)
    .values({
      id: input.id ?? randomUUID(),
      displayName: input.displayName.trim(),
      enabled: input.enabled ?? true,
      connectionConfigJson: normalized.connectionConfigJson,
      capabilitiesJson: normalized.capabilitiesJson,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get()
  return toHostView(row)
}

export function updateRemoteHost(hostId: string, patch: UpdateRemoteHostInput): RemoteHostView {
  const current = requireRemoteHost(hostId)
  const update: Partial<typeof remoteHosts.$inferInsert> = {
    updatedAt: currentUnixSeconds(),
  }
  if (patch.displayName !== undefined) {
    update.displayName = patch.displayName.trim()
  }
  if (patch.enabled !== undefined) {
    update.enabled = patch.enabled
  }
  if (hasConnectionPatch(patch)) {
    const normalized = normalizeRemoteHostConnection(patch, current)
    update.connectionConfigJson = normalized.connectionConfigJson
    update.capabilitiesJson = normalized.capabilitiesJson
  }

  const row = db()
    .update(remoteHosts)
    .set(update)
    .where(eq(remoteHosts.id, hostId))
    .returning()
    .get()
  return toHostView(row)
}

export async function deleteRemoteHost(hostId: string): Promise<void> {
  await disconnectRemoteHost(hostId)
  await disconnectRemoteHostCradleServer(hostId)
  db()
    .delete(remoteHosts)
    .where(eq(remoteHosts.id, hostId))
    .run()
}

export async function connectRemoteHost(hostId: string): Promise<RemoteHostConnectionView> {
  const existingPromise = connectPromises.get(hostId)
  if (existingPromise) {
    return existingPromise
  }

  const promise = connectRemoteHostInner(hostId).finally(() => {
    connectPromises.delete(hostId)
  })
  connectPromises.set(hostId, promise)
  return promise
}

export async function disconnectRemoteHost(hostId: string): Promise<void> {
  const record = connections.get(hostId)
  connections.delete(hostId)
  if (!record) {
    return
  }
  await record.client?.close()
  await record.tunnel?.close()
}

export const connectRemoteHostAgentd = connectRemoteHost
export const disconnectRemoteHostAgentd = disconnectRemoteHost

export async function readRemoteHostHealth(hostId: string): Promise<RemoteHostHealthView> {
  const record = requireConnectedRecord(hostId)
  try {
    const health = await record.client.call('host/health', {})
    return {
      hostId,
      status: 'ok',
      daemonVersion: health.daemonVersion,
      daemonHostId: health.hostId,
      uptimeSeconds: health.uptimeSeconds,
      connectionState: connectionStateOf(record),
      lastError: record.lastError,
    }
  }
  catch (error) {
    throw toAppError(error, 'remote_host_health_failed')
  }
}

export const readRemoteHostAgentdHealth = readRemoteHostHealth

export async function connectRemoteHostCradleServer(hostId: string): Promise<RemoteCradleServerConnectionView> {
  const existingPromise = cradleServerConnectPromises.get(hostId)
  if (existingPromise) {
    return existingPromise
  }
  const promise = connectRemoteHostCradleServerInner(hostId).finally(() => {
    cradleServerConnectPromises.delete(hostId)
  })
  cradleServerConnectPromises.set(hostId, promise)
  return promise
}

export async function disconnectRemoteHostCradleServer(hostId: string): Promise<void> {
  const record = cradleServerConnections.get(hostId)
  cradleServerConnections.delete(hostId)
  await record?.tunnel?.close()
}

export async function readRemoteHostCradleServerHealth(hostId: string): Promise<RemoteCradleServerHealthView> {
  const record = requireCradleServerConnection(hostId)
  const health = await fetchRemoteCradleServerHealth(record)
  return {
    ...toCradleServerConnectionView(record),
    status: 'ok',
    health,
  }
}

export async function testRemoteHostCradleServer(hostId: string): Promise<RemoteCradleServerHealthView> {
  await disconnectRemoteHostCradleServer(hostId)
  await connectRemoteHostCradleServer(hostId)
  return await readRemoteHostCradleServerHealth(hostId)
}

export async function listRemoteRuntimes(hostId: string): Promise<RuntimeListResult> {
  return await callRemoteHost(hostId, 'runtime/list', {})
}

export async function listRemoteWorkspaces(
  hostId: string,
  params: WorkspaceListParams,
): Promise<WorkspaceListResult> {
  return await callRemoteHost(hostId, 'workspace/list', params)
}

export async function listRemoteDirectory(
  hostId: string,
  params: FsListDirectoryParams,
): Promise<FsListDirectoryResult> {
  return await callRemoteHost(hostId, 'fs/listDirectory', params)
}

export async function statRemotePath(
  hostId: string,
  params: FsStatParams,
): Promise<FsStatResult> {
  return await callRemoteHost(hostId, 'fs/stat', params)
}

export async function readRemoteFile(
  hostId: string,
  params: FsReadFileParams,
): Promise<FsReadFileResult> {
  return await callRemoteHost(hostId, 'fs/readFile', params)
}

export async function probeRemoteRepository(
  hostId: string,
  params: GitProbeRepositoryParams,
): Promise<GitProbeRepositoryResult> {
  return await callRemoteHost(hostId, 'git/probeRepository', params)
}

export async function listRemoteAgents(hostId: string): Promise<AgentListResult> {
  return await callRemoteHost(hostId, 'agent/list', {})
}

export async function startRemoteAgent(
  hostId: string,
  params: AgentStartParams,
): Promise<AgentStartResult> {
  return await callRemoteHost(hostId, 'agent/start', params)
}

export interface CreateRemoteHostRelayPairingTokenInput {
  relayUrl?: string
  relayServerId?: string
  ttlMs?: number
}

export interface RemoteHostRelayPairingTokenView {
  relayUrl: string
  relayServerId: string | null
  roomId: string
  pairingToken: string
  hostToken: string
  enrollmentId: string
  enrollmentSecret: string
  expiresAt: string
}

export interface ClaimRemoteHostRelayPairingInput {
  relayUrl?: string
  relayServerId?: string
  pairingCode: string
  ttlMs?: number
}

export interface RemoteHostRelayClaimView {
  relayUrl: string
  roomId: string
  enrollmentId: string
}

export interface CreateRemoteHostRelayHostSessionInput {
  enrollmentSecret: string
  ttlMs?: number
}

export interface RemoteHostRelayHostSessionView {
  relayUrl: string
  roomId: string
  roomStartToken: string
  hostToken: string
  expiresAt: string
}

/**
 * Resolve which relay server a pairing operation should target.
 *
 * Precedence: an explicit relayUrl wins (legacy/ad-hoc), then a configured
 * relay server by id, then the host's stored relay config, then the default
 * relay server. Returns the resolved URL and, when known, the relay server id
 * so the pairing-token response can echo it back to the UI.
 */
function resolvePairingRelay(input: {
  relayUrl?: string
  relayServerId?: string
  storedRelayUrl?: string
}): { relayUrl: string, relayServerId: string | null } {
  if (input.relayUrl?.trim()) {
    return { relayUrl: input.relayUrl.trim(), relayServerId: null }
  }
  if (input.relayServerId?.trim()) {
    return { relayUrl: resolveRelayUrl(input.relayServerId.trim()), relayServerId: input.relayServerId.trim() }
  }
  if (input.storedRelayUrl?.trim()) {
    return { relayUrl: input.storedRelayUrl.trim(), relayServerId: null }
  }
  const defaultServer = readDefaultRelayServer()
  if (defaultServer) {
    return { relayUrl: defaultServer.relayUrl, relayServerId: defaultServer.id }
  }
  throw new AppError({
    code: 'remote_relay_url_required',
    status: 400,
    message: 'A relay server is required to pair a remote host. Configure one under Relay servers or pass a relay URL.',
  })
}

export function createRemoteHostRelayPairingToken(
  hostId: string,
  input: CreateRemoteHostRelayPairingTokenInput,
): RemoteHostRelayPairingTokenView {
  const host = requireRemoteHost(hostId)
  const currentConfig = parseConnectionConfig(host.connectionConfigJson)
  const { relayUrl, relayServerId } = resolvePairingRelay({
    relayUrl: input.relayUrl,
    relayServerId: input.relayServerId,
    storedRelayUrl: currentConfig.relay?.relayUrl,
  })
  const roomId = createRelayRoomId()
  const enrollment = createRelayEnrollment({
    host,
    relayUrl,
    relayServerId,
    roomId,
  })
  const pairingToken = mintRelayToken({
    subject: `remote-host:${hostId}`,
    purpose: 'pairing_start',
    roomId,
    ttlMs: input.ttlMs,
  })
  const hostToken = mintRelayToken({
    subject: `remote-host:${hostId}:host`,
    purpose: 'ws',
    role: 'host',
    roomId,
    ttlMs: input.ttlMs,
  })
  return {
    relayUrl,
    relayServerId,
    roomId,
    pairingToken: pairingToken.token,
    hostToken: hostToken.token,
    enrollmentId: enrollment.enrollmentId,
    enrollmentSecret: enrollment.enrollmentSecret,
    expiresAt: pairingToken.expiresAt,
  }
}

export async function claimRemoteHostRelayPairing(
  hostId: string,
  input: ClaimRemoteHostRelayPairingInput,
): Promise<RemoteHostRelayClaimView> {
  const host = requireRemoteHost(hostId)
  const currentConfig = parseConnectionConfig(host.connectionConfigJson)
  const { relayUrl } = resolvePairingRelay({
    relayUrl: input.relayUrl,
    relayServerId: input.relayServerId,
    storedRelayUrl: currentConfig.relay?.relayUrl,
  })

  const pendingClaim = await postRelayClaim(
    relayUrl,
    mintRelayToken({
      subject: `remote-host:${hostId}:claim`,
      purpose: 'pairing_claim',
      ttlMs: input.ttlMs,
    }).token,
    input.pairingCode,
  )
  const controllerToken = mintRelayToken({
    subject: `remote-host:${hostId}:controller`,
    purpose: 'ws',
    role: 'controller',
    roomId: pendingClaim.roomId,
    ttlMs: input.ttlMs,
  })
  const claimed = await postRelayClaim(
    relayUrl,
    mintRelayToken({
      subject: `remote-host:${hostId}:claim`,
      purpose: 'pairing_claim',
      ttlMs: input.ttlMs,
    }).token,
    input.pairingCode,
    controllerToken.token,
  )
  const enrollment = requireRelayEnrollmentByRoom(hostId, claimed.roomId)

  updateRemoteHost(hostId, {
    connectionConfig: {
      ...currentConfig,
      transport: 'relay',
      relay: {
        ...enrollment,
        relayUrl: enrollment.relayUrl,
        relayServerId: enrollment.relayServerId,
        enrollmentId: enrollment.enrollmentId,
      },
    },
  })

  return {
    relayUrl: enrollment.relayUrl,
    roomId: claimed.roomId,
    enrollmentId: enrollment.enrollmentId,
  }
}

export function createRemoteHostRelayHostSession(
  enrollmentId: string,
  input: CreateRemoteHostRelayHostSessionInput,
): RemoteHostRelayHostSessionView {
  const host = requireRemoteHost(enrollmentId)
  const connectionConfig = parseConnectionConfig(host.connectionConfigJson)
  const relay = requireRelayConfig(connectionConfig)
  if (!host.enabled) {
    throw new AppError({
      code: 'remote_host_disabled',
      status: 409,
      message: 'Remote host is disabled.',
      details: { hostId: host.id },
    })
  }
  if (!verifyRelayEnrollmentSecret(input.enrollmentSecret, relay.enrollmentSecretHash)) {
    throw new AppError({
      code: 'remote_relay_enrollment_secret_invalid',
      status: 401,
      message: 'Remote relay enrollment secret is invalid.',
      details: { enrollmentId },
    })
  }

  const roomId = createRelayRoomId()
  const roomStartToken = mintRelayToken({
    subject: `remote-host:${host.id}:room-start`,
    purpose: 'room_start',
    roomId,
    ttlMs: input.ttlMs,
  })
  const hostToken = mintRelayToken({
    subject: `remote-host:${host.id}:host`,
    purpose: 'ws',
    role: 'host',
    roomId,
    ttlMs: input.ttlMs,
  })
  const now = currentUnixSeconds()
  updateRemoteHost(host.id, {
    connectionConfig: {
      ...connectionConfig,
      relay: {
        ...relay,
        lastSessionRoomId: roomId,
        lastSeenAt: now,
      },
    },
  })

  return {
    relayUrl: relay.relayUrl,
    roomId,
    roomStartToken: roomStartToken.token,
    hostToken: hostToken.token,
    expiresAt: roomStartToken.expiresAt,
  }
}

export async function callRemoteHost<M extends RemoteAgentUnaryMethod>(
  hostId: string,
  method: M,
  params: RemoteAgentParams<M>,
): Promise<RemoteAgentResult<M>> {
  const record = requireConnectedRecord(hostId)
  try {
    return await record.client.call(method, params)
  }
  catch (error) {
    throw toAppError(error, 'remote_daemon_call_failed')
  }
}

export async function* openRemoteHostStream<M extends RemoteAgentStreamMethod>(
  hostId: string,
  method: M,
  params: RemoteAgentParams<M>,
): AsyncGenerator<RemoteAgentStreamValue<M>, void, void> {
  const record = requireConnectedRecord(hostId)
  try {
    yield* record.client.openStream(method, params)
  }
  catch (error) {
    throw toAppError(error, 'remote_daemon_stream_failed')
  }
}

export function getRemoteHostConnectionView(hostId: string): RemoteHostConnectionView {
  const row = requireRemoteHost(hostId)
  const capabilities = parseCapabilities(row.capabilitiesJson)
  const record = connections.get(hostId)
  if (!record) {
    return {
      hostId,
      state: 'idle',
      localSocketPath: null,
      daemonHostId: capabilities.agentd.lastDaemonHostId,
      daemonVersion: capabilities.agentd.lastDaemonVersion,
      platform: capabilities.agentd.lastPlatform,
      arch: capabilities.agentd.lastArch,
      lastError: null,
    }
  }
  return toConnectionView(record)
}

async function connectRemoteHostInner(hostId: string): Promise<RemoteHostConnectionView> {
  const host = requireRemoteHost(hostId)
  if (!host.enabled) {
    throw new AppError({
      code: 'remote_host_disabled',
      status: 409,
      message: 'Remote host is disabled.',
      details: { hostId },
    })
  }

  await disconnectRemoteHost(hostId)

  const connectionConfig = parseConnectionConfig(host.connectionConfigJson)
  const capabilities = parseCapabilities(host.capabilitiesJson)
  const isRelay = connectionConfig.transport === 'relay'
  const localSocketPath = isRelay ? null : connectionConfig.localSocketPath ?? defaultLocalSocketPath(host.id)
  if (localSocketPath) {
    assertUnixSocketPathLength(localSocketPath)
  }
  let tunnel: SshTunnelHandle | null = null
  let record: RemoteHostConnectionRecord | null = null

  try {
    if (connectionConfig.transport === 'ssh') {
      if (!localSocketPath) {
        throw new RemoteAgentTransportError('Local socket path is required for SSH transport.')
      }
      const sshLaunch = resolveHostSshLaunchConfig(host, connectionConfig)
      tunnel = await startSshTunnel({
        hostId: host.id,
        sshTarget: sshLaunch.sshTarget,
        localSocketPath,
        remoteSocketPath: capabilities.agentd.remoteSocketPath,
        sshExecutable: sshLaunch.sshExecutable,
        sshArgs: sshLaunch.sshArgs,
        readyTimeoutMs: connectionConfig.connectTimeoutMs ?? 10_000,
      })
    }

    const client = isRelay
      ? await connectRelayDaemonClientWithRetry({
        relayConfig: createRelayControllerSessionConfig(host, connectionConfig),
        timeoutMs: connectionConfig.connectTimeoutMs ?? 10_000,
        onTransportClose: (error) => {
          if (!record) {
            return
          }
          record.lastError = error.message
        },
      })
      : await connectDaemonClientWithRetry({
        socketPath: localSocketPath ?? '',
        timeoutMs: connectionConfig.connectTimeoutMs ?? 10_000,
        onTransportClose: (error) => {
          if (!record) {
            return
          }
          record.lastError = error.message
        },
      })

    record = {
      host,
      client,
      tunnel,
      localSocketPath,
      lastError: null,
      tunnelExited: false,
    }
    tunnel?.onExit((exit) => {
      if (!record) {
        return
      }
      record.tunnelExited = true
      record.lastError = `ssh tunnel exited with code ${exit.code ?? 'null'} signal ${exit.signal ?? 'null'}`
      void record.client?.close()
    })
    connections.set(hostId, record)
    persistDaemonIdentity(hostId, client.hello)
    return toConnectionView(record)
  }
  catch (error) {
    await tunnel?.close()
    const appError = toAppError(error, 'remote_host_connect_failed')
    connections.set(hostId, {
      host,
      client: null,
      tunnel: null,
      localSocketPath,
      lastError: appError.message,
      tunnelExited: true,
    })
    throw appError
  }
}

async function connectRemoteHostCradleServerInner(hostId: string): Promise<RemoteCradleServerConnectionView> {
  const host = requireRemoteHost(hostId)
  if (!host.enabled) {
    throw new AppError({
      code: 'remote_host_disabled',
      status: 409,
      message: 'Remote host is disabled.',
      details: { hostId },
    })
  }

  await disconnectRemoteHostCradleServer(hostId)

  const connectionConfig = parseConnectionConfig(host.connectionConfigJson)
  const capabilities = parseCapabilities(host.capabilitiesJson)
  if (!capabilities.cradleServer.enabled) {
    throw new AppError({
      code: 'remote_cradle_server_capability_disabled',
      status: 409,
      message: 'Remote host Cradle Server capability is disabled.',
      details: { hostId },
    })
  }
  if (connectionConfig.transport !== 'ssh') {
    throw new AppError({
      code: 'remote_cradle_server_ssh_required',
      status: 409,
      message: 'Remote Cradle Server connections require SSH transport.',
      details: { hostId, transport: connectionConfig.transport },
    })
  }

  let tunnel: RemoteCradleServerTunnelHandle | null = null
  let record: RemoteCradleServerConnectionRecord | null = null
  try {
    const sshLaunch = resolveHostSshLaunchConfig(host, connectionConfig)
    tunnel = await startRemoteCradleServerTunnel({
      hostId: host.id,
      sshTarget: sshLaunch.sshTarget,
      sshExecutable: sshLaunch.sshExecutable,
      sshArgs: sshLaunch.sshArgs,
      remoteHost: capabilities.cradleServer.remoteHost,
      remotePort: capabilities.cradleServer.remotePort,
      readyTimeoutMs: connectionConfig.connectTimeoutMs ?? 10_000,
    })
    record = {
      host,
      tunnel,
      lastError: null,
      tunnelExited: false,
    }
    tunnel.onExit((exit) => {
      if (!record) {
        return
      }
      record.tunnelExited = true
      record.lastError = `ssh tunnel exited with code ${exit.code ?? 'null'} signal ${exit.signal ?? 'null'}`
    })
    cradleServerConnections.set(hostId, record)
    await fetchRemoteCradleServerHealth(record)
    return toCradleServerConnectionView(record)
  }
  catch (error) {
    await tunnel?.close()
    const appError = toAppError(error, 'remote_cradle_server_connect_failed')
    cradleServerConnections.set(hostId, {
      host,
      tunnel: null,
      lastError: appError.message,
      tunnelExited: true,
    })
    throw appError
  }
}

async function fetchRemoteCradleServerHealth(record: RemoteCradleServerConnectionRecord): Promise<RemoteCradleServerHealthPayload> {
  if (!record.tunnel || record.tunnelExited) {
    throw new AppError({
      code: 'remote_cradle_server_offline',
      status: 503,
      message: 'Remote Cradle Server tunnel is not connected.',
      details: { hostId: record.host.id, lastError: record.lastError },
    })
  }
  let response: Response
  try {
    response = await fetch(`${record.tunnel.localBaseUrl}/health`)
  }
  catch (error) {
    throw new AppError({
      code: 'remote_cradle_server_health_failed',
      status: 503,
      message: 'SSH connected, but the remote Cradle Server health check failed.',
      details: {
        hostId: record.host.id,
        error: error instanceof Error ? error.message : String(error),
      },
    })
  }
  if (!response.ok) {
    throw new AppError({
      code: 'remote_cradle_server_health_failed',
      status: 502,
      message: `SSH connected, but remote Cradle Server returned HTTP ${response.status} from /health.`,
      details: { hostId: record.host.id, status: response.status },
    })
  }
  return await response.json() as RemoteCradleServerHealthPayload
}

async function connectDaemonClientWithRetry(input: {
  socketPath: string
  timeoutMs: number
  onTransportClose: (error: RemoteAgentTransportError) => void
}): Promise<RemoteAgentDaemonClient> {
  const deadline = Date.now() + input.timeoutMs
  let lastError: unknown
  while (Date.now() <= deadline) {
    const client = createRemoteAgentDaemonClient({
      socketPath: input.socketPath,
      onTransportClose: input.onTransportClose,
    })
    try {
      await client.connect()
      return client
    }
    catch (error) {
      lastError = error
      await client.close()
      await delay(150)
    }
  }
  throw lastError ?? new RemoteAgentTransportError('Timed out connecting to remote daemon.')
}

function requireRemoteHost(hostId: string): RemoteHost {
  const host = db()
    .select()
    .from(remoteHosts)
    .where(eq(remoteHosts.id, hostId))
    .get()
  if (!host) {
    throw new AppError({
      code: 'remote_host_not_found',
      status: 404,
      message: 'Remote host was not found.',
      details: { hostId },
    })
  }
  return host
}

function parseCapabilities(raw: string): RemoteHostCapabilities {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw || '{}')
  }
  catch (error) {
    throw new AppError({
      code: 'invalid_remote_host_capabilities',
      status: 400,
      message: 'Remote host capabilities config is invalid.',
      details: {
        error: error instanceof Error ? error.message : String(error),
      },
    })
  }
  return normalizeCapabilities(parsed)
}

function normalizeCapabilities(raw: unknown): RemoteHostCapabilities {
  try {
    return capabilitiesSchema.parse(raw)
  }
  catch (error) {
    throw new AppError({
      code: 'invalid_remote_host_capabilities',
      status: 400,
      message: 'Remote host capabilities config is invalid.',
      details: {
        error: error instanceof Error ? error.message : String(error),
      },
    })
  }
}

function createRelayEnrollment(input: {
  host: RemoteHost
  relayUrl: string
  relayServerId: string | null
  roomId: string
}): { enrollmentId: string, enrollmentSecret: string } {
  const currentConfig = parseConnectionConfig(input.host.connectionConfigJson)
  const enrollmentId = input.host.id
  const enrollmentSecret = generateRelayEnrollmentSecret()
  updateRemoteHost(input.host.id, {
    connectionConfig: {
      ...currentConfig,
      transport: 'relay',
      relay: {
        relayUrl: input.relayUrl,
        relayServerId: input.relayServerId,
        enrollmentId,
        enrollmentSecretHash: hashRelayEnrollmentSecret(enrollmentSecret),
        lastSessionRoomId: input.roomId,
      },
    },
  })
  return { enrollmentId, enrollmentSecret }
}

function requireRelayEnrollmentByRoom(hostId: string, roomId: string): RemoteHostRelayConfig & {
  enrollmentId: string
  enrollmentSecretHash: string
} {
  const host = requireRemoteHost(hostId)
  const relay = requireRelayConfig(parseConnectionConfig(host.connectionConfigJson))
  if (relay.lastSessionRoomId !== roomId) {
    throw new AppError({
      code: 'remote_relay_enrollment_not_found',
      status: 404,
      message: 'Remote relay enrollment was not found for the claimed room.',
      details: { hostId, roomId },
    })
  }
  return relay
}

function createRelayControllerSessionConfig(
  host: RemoteHost,
  connectionConfig: RemoteHostConnectionConfig,
): RemoteHostRelaySessionConfig {
  const relay = requireRelayConfig(connectionConfig)
  if (relay.enrollmentId !== host.id) {
    throw new AppError({
      code: 'remote_relay_enrollment_host_mismatch',
      status: 409,
      message: 'Remote relay enrollment does not belong to this remote host.',
      details: { hostId: host.id, enrollmentId: relay.enrollmentId },
    })
  }
  if (!relay.lastSessionRoomId) {
    throw new AppError({
      code: 'remote_relay_host_session_required',
      status: 409,
      message: 'Remote relay host is not online. Start agentd relay from its saved profile before connecting.',
      details: { hostId: host.id, enrollmentId: relay.enrollmentId },
    })
  }
  const controllerToken = mintRelayToken({
    subject: `remote-host:${host.id}:controller`,
    purpose: 'ws',
    role: 'controller',
    roomId: relay.lastSessionRoomId,
  })
  return {
    relayUrl: relay.relayUrl,
    roomId: relay.lastSessionRoomId,
    controllerToken: controllerToken.token,
  }
}

function requireConnectedRecord(hostId: string): RemoteHostConnectionRecord & { client: RemoteAgentDaemonClient } {
  requireRemoteHost(hostId)
  const record = connections.get(hostId)
  if (!record || !record.client || connectionStateOf(record) !== 'connected') {
    throw new AppError({
      code: 'remote_host_offline',
      status: 503,
      message: 'Remote host is not connected.',
      details: {
        hostId,
        state: record ? connectionStateOf(record) : 'idle',
        lastError: record?.lastError ?? null,
      },
    })
  }
  return { ...record, client: record.client }
}

function requireCradleServerConnection(hostId: string): RemoteCradleServerConnectionRecord {
  requireRemoteHost(hostId)
  const record = cradleServerConnections.get(hostId)
  if (!record || !record.tunnel || record.tunnelExited) {
    throw new AppError({
      code: 'remote_cradle_server_offline',
      status: 503,
      message: 'Remote Cradle Server tunnel is not connected.',
      details: {
        hostId,
        state: record ? cradleServerConnectionStateOf(record) : 'idle',
        lastError: record?.lastError ?? null,
      },
    })
  }
  return record
}

function toHostView(row: RemoteHost): RemoteHostView {
  const record = connections.get(row.id)
  return {
    ...row,
    connectionState: record ? connectionStateOf(record) : 'idle',
    lastError: record?.lastError ?? null,
  }
}

function toConnectionView(record: RemoteHostConnectionRecord): RemoteHostConnectionView {
  const hello = record.client?.hello
  const capabilities = parseCapabilities(record.host.capabilitiesJson)
  return {
    hostId: record.host.id,
    state: connectionStateOf(record),
    localSocketPath: record.localSocketPath,
    daemonHostId: hello?.hostId ?? capabilities.agentd.lastDaemonHostId,
    daemonVersion: hello?.daemonVersion ?? capabilities.agentd.lastDaemonVersion,
    platform: hello?.platform ?? capabilities.agentd.lastPlatform,
    arch: hello?.arch ?? capabilities.agentd.lastArch,
    lastError: record.lastError,
  }
}

function toCradleServerConnectionView(record: RemoteCradleServerConnectionRecord): RemoteCradleServerConnectionView {
  return {
    hostId: record.host.id,
    state: cradleServerConnectionStateOf(record),
    localBaseUrl: record.tunnel && !record.tunnelExited ? record.tunnel.localBaseUrl : null,
    lastError: record.lastError,
  }
}

function connectionStateOf(record: RemoteHostConnectionRecord): RemoteHostConnectionState {
  if (record.tunnelExited) {
    return 'offline'
  }
  return record.client?.state ?? 'offline'
}

function cradleServerConnectionStateOf(record: RemoteCradleServerConnectionRecord): RemoteCradleServerConnectionView['state'] {
  if (record.tunnelExited) {
    return 'offline'
  }
  return record.tunnel ? 'connected' : 'offline'
}

function persistDaemonIdentity(hostId: string, hello: RemoteAgentDaemonClient['hello']): void {
  if (!hello) {
    return
  }
  const host = requireRemoteHost(hostId)
  const capabilities = parseCapabilities(host.capabilitiesJson)
  const nextCapabilities = normalizeCapabilities({
    ...capabilities,
    agentd: {
      ...capabilities.agentd,
      lastDaemonHostId: hello.hostId,
      lastDaemonVersion: hello.daemonVersion,
      lastPlatform: hello.platform,
      lastArch: hello.arch,
    },
  })
  db()
    .update(remoteHosts)
    .set({
      capabilitiesJson: JSON.stringify(nextCapabilities),
      lastSeenAt: currentUnixSeconds(),
      updatedAt: currentUnixSeconds(),
    })
    .where(eq(remoteHosts.id, hostId))
    .run()
}

function parseConnectionConfig(raw: string): RemoteHostConnectionConfig {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  }
  catch (error) {
    throw new AppError({
      code: 'invalid_remote_host_connection_config',
      status: 400,
      message: 'Remote host connection config is invalid.',
      details: {
        error: error instanceof Error ? error.message : String(error),
      },
    })
  }
  return normalizeConnectionConfig(parsed)
}

function normalizeRemoteHostConnection(
  input: RemoteHostConnectionPatch,
  current: RemoteHost | null,
): NormalizedRemoteHostConnection {
  const baseConfig = input.connectionConfig !== undefined
    ? current
      ? parseConnectionConfig(current.connectionConfigJson)
      : {}
    : current
      ? parseConnectionConfig(current.connectionConfigJson)
      : {}
  const connectionConfig = normalizeConnectionConfig(mergeConnectionConfigInput(baseConfig, input))
  const baseCapabilities = current ? parseCapabilities(current.capabilitiesJson) : {}
  const capabilities = normalizeCapabilities(mergeCapabilitiesInput(baseCapabilities, input))
  return {
    connectionConfigJson: JSON.stringify(connectionConfig),
    capabilitiesJson: JSON.stringify(capabilities),
  }
}

function normalizeConnectionConfig(raw: unknown): RemoteHostConnectionConfig {
  try {
    return connectionConfigSchema.parse(raw)
  }
  catch (error) {
    throw new AppError({
      code: 'invalid_remote_host_connection_config',
      status: 400,
      message: 'Remote host connection config is invalid.',
      details: {
        error: error instanceof Error ? error.message : String(error),
      },
    })
  }
}

function mergeConnectionConfigInput(
  base: Record<string, unknown>,
  input: RemoteHostConnectionPatch,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...base }
  if (input.connectionConfig) {
    Object.assign(next, input.connectionConfig)
  }
  return next
}

function mergeCapabilitiesInput(
  base: RemoteHostCapabilities | Record<string, unknown>,
  input: RemoteHostConnectionPatch,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...base }
  const agentd = typeof next.agentd === 'object' && next.agentd !== null
    ? { ...next.agentd as Record<string, unknown> }
    : {}
  if (input.capabilities?.agentd) {
    Object.assign(agentd, input.capabilities.agentd)
  }
  next.agentd = agentd
  const cradleServer = typeof next.cradleServer === 'object' && next.cradleServer !== null
    ? { ...next.cradleServer as Record<string, unknown> }
    : {}
  if (input.capabilities?.cradleServer) {
    Object.assign(cradleServer, input.capabilities.cradleServer)
  }
  next.cradleServer = cradleServer
  return next
}

function hasConnectionPatch(patch: UpdateRemoteHostInput): boolean {
  return patch.connectionConfig !== undefined || patch.capabilities !== undefined
}

export function buildSshProfileLaunchConfig(profile: RemoteHostSshProfile): SshProfileLaunchConfig {
  const sshArgs: string[] = []
  if (profile.port !== null) {
    sshArgs.push('-p', String(profile.port))
  }
  if (profile.auth === 'identityFile' && profile.identityFilePath) {
    sshArgs.push('-i', profile.identityFilePath)
  }
  return {
    sshTarget: profile.user ? `${profile.user}@${profile.hostName}` : profile.hostName,
    sshArgs,
  }
}

function resolveHostSshLaunchConfig(
  _host: RemoteHost,
  connectionConfig: RemoteHostConnectionConfig,
): {
  sshTarget: string
  sshExecutable?: string
  sshArgs: string[]
} {
  if (!connectionConfig.ssh) {
    throw new AppError({
      code: 'remote_host_ssh_profile_required',
      status: 400,
      message: 'Remote host SSH profile is required for SSH transport.',
    })
  }
  const profileLaunch = buildSshProfileLaunchConfig(connectionConfig.ssh)
  return {
    sshTarget: profileLaunch.sshTarget,
    sshExecutable: connectionConfig.sshExecutable,
    sshArgs: [
      ...profileLaunch.sshArgs,
      ...(connectionConfig.sshArgs ?? []),
    ],
  }
}

function defaultLocalSocketPath(hostId: string): string {
  const uid = typeof process.getuid === 'function' ? String(process.getuid()) : 'user'
  const dir = join('/tmp', `cradle-rrh-${uid}`)
  mkdirSync(dir, { recursive: true })
  return join(dir, `${hostId}.sock`)
}

function assertUnixSocketPathLength(socketPath: string): void {
  const byteLength = Buffer.byteLength(socketPath)
  if (byteLength <= UNIX_SOCKET_PATH_LIMIT) {
    return
  }
  throw new AppError({
    code: 'remote_host_local_socket_path_too_long',
    status: 400,
    message: 'Remote runtime local Unix socket path is too long for this operating system.',
    details: {
      socketPath,
      byteLength,
      limit: UNIX_SOCKET_PATH_LIMIT,
      suggestion: 'Use a shorter connectionConfig.localSocketPath such as /tmp/cradle-agentd.sock.',
    },
  })
}

function toAppError(error: unknown, fallbackCode: string): AppError {
  if (error instanceof AppError) {
    return error
  }
  if (error instanceof RemoteAgentRpcError) {
    return new AppError({
      code: error.code,
      status: 502,
      message: error.message,
      details: error.details && typeof error.details === 'object'
        ? error.details as Record<string, unknown>
        : { details: error.details },
    })
  }
  if (error instanceof RemoteAgentTransportError) {
    return new AppError({
      code: error.code,
      status: 503,
      message: error.message,
    })
  }
  return new AppError({
    code: fallbackCode,
    status: 502,
    message: error instanceof Error ? error.message : String(error),
  })
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function connectRelayDaemonClientWithRetry(input: {
  relayConfig: RemoteHostRelaySessionConfig
  timeoutMs: number
  onTransportClose: (error: RemoteAgentTransportError) => void
}): Promise<RemoteAgentDaemonClient> {
  const deadline = Date.now() + input.timeoutMs
  let lastError: unknown
  while (Date.now() <= deadline) {
    const client = createRelayRemoteAgentDaemonClient({
      relayUrl: input.relayConfig.relayUrl,
      roomId: input.relayConfig.roomId,
      controllerToken: input.relayConfig.controllerToken,
      onTransportClose: input.onTransportClose,
    })
    try {
      await client.connect()
      return client
    }
    catch (error) {
      lastError = error
      await client.close()
      await delay(150)
    }
  }
  throw lastError ?? new RemoteAgentTransportError('Timed out connecting to remote relay.')
}

function requireRelayConfig(config: RemoteHostConnectionConfig): RemoteHostRelayConfig & {
  enrollmentId: string
  enrollmentSecretHash: string
} {
  const relay = config.relay
  if (!relay) {
    throw new AppError({
      code: 'remote_relay_config_required',
      status: 400,
      message: 'Remote host relay config is required for relay transport.',
    })
  }
  if (!relay.enrollmentId || !relay.enrollmentSecretHash) {
    throw new AppError({
      code: 'remote_relay_reenrollment_required',
      status: 409,
      message: 'Remote relay host must be re-enrolled before it can reconnect persistently.',
    })
  }
  return {
    ...relay,
    enrollmentId: relay.enrollmentId,
    enrollmentSecretHash: relay.enrollmentSecretHash,
  }
}

function generateRelayEnrollmentSecret(): string {
  return `cradle_relay_enroll_${randomBytes(32).toString('base64url')}`
}

function hashRelayEnrollmentSecret(secret: string): string {
  return `sha256:${createHash('sha256').update(secret).digest('hex')}`
}

function verifyRelayEnrollmentSecret(secret: string, expectedHash: string): boolean {
  const candidateHash = hashRelayEnrollmentSecret(secret.trim())
  const candidate = Buffer.from(candidateHash)
  const expected = Buffer.from(expectedHash)
  return candidate.length === expected.length && timingSafeEqual(candidate, expected)
}

async function postRelayClaim(
  relayUrl: string,
  claimToken: string,
  pairingCode: string,
  controllerToken?: string,
): Promise<{ roomId: string }> {
  const response = await fetch(new URL('/pairing/claim', ensureTrailingSlash(relayUrl)), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${claimToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      pairingCode,
      ...(controllerToken ? { controllerToken } : {}),
    }),
  })
  if (!response.ok) {
    throw new AppError({
      code: 'remote_relay_claim_failed',
      status: 502,
      message: `Relay pairing claim failed with HTTP ${response.status}.`,
    })
  }
  return await response.json() as { roomId: string }
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith('/') ? value : `${value}/`
}

function currentUnixSeconds(): number {
  return Math.floor(Date.now() / 1000)
}
