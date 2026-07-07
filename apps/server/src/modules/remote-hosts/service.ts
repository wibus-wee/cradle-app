import { randomUUID } from 'node:crypto'
import { hostname } from 'node:os'

import type { RemoteHost } from '@cradle/db'
import { remoteHosts } from '@cradle/db'
import { asc, eq } from 'drizzle-orm'
import { z } from 'zod'

import { AppError } from '../../errors/app-error'
import { db } from '../../infra'
import type { SignedRelayAssertion } from '../relay-servers/relay-signature-service'
import {
  generateRelaySigningKeyPair,
  signRelayAssertion,
} from '../relay-servers/relay-signature-service'
import { resolveRelayUrl as resolveRelayServerUrl } from '../relay-servers/service'
import {
  startRelayControllerTransport,
} from '../relay-transport/controller-transport'
import { generateRelayKeyPair, publicKeyFromPrivate, relayPublicKeyFingerprint } from '../relay-transport/crypto'
import { readSecret, upsertSecret } from '../secrets/service'
import type { RemoteCradleServerTunnelHandle } from './cradle-server-tunnel'
import {
  buildRemoteCradleSshLaunchConfig,
  startRemoteCradleServerTunnel,
} from './cradle-server-tunnel'
import type { RemoteCradleClient, RemoteCradleServerHealthPayload, RemoteWorkspaceFileContent, RemoteWorkspaceFileEntry, RemoteWorkspaceFileInfo, RemoteWorkspaceView } from './remote-cradle-client'
import {
  createRemoteCradleClient,
} from './remote-cradle-client'

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

export type RemoteHostTransport = 'ssh' | 'direct-url' | 'relay'

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

export interface RemoteHostRelayConfigInput {
  relayServerId?: string | null
  relayUrl?: string | null
  roomId?: string | null
  pinnedHostPubkey?: string | null
  controllerKeyRef?: string | null
}

export interface RemoteHostRelayConfig {
  relayServerId: string | null
  relayUrl: string | null
  roomId: string | null
  pinnedHostPubkey: string | null
  controllerKeyRef: string | null
}

export interface RemoteHostConnectionConfigInput {
  transport?: RemoteHostTransport
  baseUrl?: string
  ssh?: RemoteHostSshProfileInput
  sshExecutable?: string
  sshArgs?: string[]
  connectTimeoutMs?: number
  relay?: RemoteHostRelayConfigInput
}

export interface RemoteHostCradleServerCapabilityInput {
  enabled?: boolean
  remoteHost?: string
  remotePort?: number
}

export interface RemoteHostCapabilitiesInput {
  cradleServer?: RemoteHostCradleServerCapabilityInput
}

export interface SshProfileLaunchConfig {
  sshTarget: string
  sshArgs: string[]
}

export type RemoteHostConnectionState = 'idle' | 'connected' | 'offline'

export interface RemoteHostView extends RemoteHost {
  connectionState: RemoteHostConnectionState
  lastError: string | null
}

export interface RemoteCradleServerConnectionView {
  hostId: string
  state: RemoteHostConnectionState
  localBaseUrl: string | null
  lastError: string | null
}

export interface RemoteCradleServerHealthView extends RemoteCradleServerConnectionView {
  status: 'ok'
  health: RemoteCradleServerHealthPayload
}

interface RemoteHostConnectionRecord {
  host: RemoteHost
  tunnel: RemoteCradleServerTunnelHandle | null
  baseUrl: string
  lastError: string | null
  tunnelExited: boolean
}

interface RemoteHostCradleServerCapability {
  enabled: boolean
  remoteHost: string
  remotePort: number
}

interface RemoteHostCapabilities {
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
const transportSchema = z.enum(['ssh', 'direct-url', 'relay'])
const sshAuthSchema = z.enum(['default', 'identityFile'])

const relayConfigSchema = z.object({
  relayServerId: nonBlankStringSchema.nullable().optional(),
  relayUrl: nonBlankStringSchema.nullable().optional(),
  roomId: nonBlankStringSchema.nullable().optional(),
  pinnedHostPubkey: nonBlankStringSchema.nullable().optional(),
  controllerKeyRef: nonBlankStringSchema.nullable().optional(),
}).passthrough().transform(relay => ({
  relayServerId: relay.relayServerId ?? null,
  relayUrl: relay.relayUrl ?? null,
  roomId: relay.roomId ?? null,
  pinnedHostPubkey: relay.pinnedHostPubkey ?? null,
  controllerKeyRef: relay.controllerKeyRef ?? null,
}))

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
  baseUrl: nonBlankStringSchema.optional(),
  ssh: sshProfileSchema.optional(),
  sshExecutable: nonBlankStringSchema.optional(),
  sshArgs: z.array(z.string()).optional(),
  connectTimeoutMs: z.number().int().positive().max(120_000).optional(),
  relay: relayConfigSchema.optional(),
}).passthrough().superRefine((config, ctx) => {
  const transport = config.transport ?? 'ssh'
  if (transport === 'ssh' && !config.ssh) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['ssh'],
      message: 'ssh is required when transport is ssh.',
    })
  }
  if (transport === 'direct-url' && !config.baseUrl) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['baseUrl'],
      message: 'baseUrl is required when transport is direct-url.',
    })
  }
  if (transport === 'relay' && !config.relay) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['relay'],
      message: 'relay is required when transport is relay.',
    })
  }
}).transform(config => ({
  ...config,
  transport: config.transport ?? 'ssh',
}))

type RemoteHostConnectionConfig = z.infer<typeof connectionConfigSchema>

const cradleServerCapabilitySchema = z.object({
  enabled: z.boolean().default(true),
  remoteHost: nonBlankStringSchema.default('127.0.0.1'),
  remotePort: z.number().int().min(1).max(65_535).default(21_423),
}).transform(cradleServer => ({
  enabled: cradleServer.enabled,
  remoteHost: cradleServer.remoteHost,
  remotePort: cradleServer.remotePort,
}))

const capabilitiesSchema = z.object({
  cradleServer: cradleServerCapabilitySchema.default({
    enabled: true,
    remoteHost: '127.0.0.1',
    remotePort: 21_423,
  }),
}).passthrough().transform(capabilities => ({
  cradleServer: capabilities.cradleServer,
}))

const connections = new Map<string, RemoteHostConnectionRecord>()
const connectPromises = new Map<string, Promise<RemoteCradleServerConnectionView>>()

export const connectRemoteHost = connectRemoteHostCradleServer
export const disconnectRemoteHost = disconnectRemoteHostCradleServer
export const buildSshProfileLaunchConfig = buildRemoteCradleSshLaunchConfig

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
  await disconnectRemoteHostCradleServer(hostId)
  db()
    .delete(remoteHosts)
    .where(eq(remoteHosts.id, hostId))
    .run()
}

export async function connectRemoteHostCradleServer(hostId: string): Promise<RemoteCradleServerConnectionView> {
  const existingPromise = connectPromises.get(hostId)
  if (existingPromise) {
    return existingPromise
  }
  const promise = connectRemoteHostCradleServerInner(hostId).finally(() => {
    connectPromises.delete(hostId)
  })
  connectPromises.set(hostId, promise)
  return promise
}

export async function disconnectRemoteHostCradleServer(hostId: string): Promise<void> {
  const record = connections.get(hostId)
  connections.delete(hostId)
  await record?.tunnel?.close()
}

export async function readRemoteHostCradleServerHealth(hostId: string): Promise<RemoteCradleServerHealthView> {
  const record = await connectedRecord(hostId)
  const health = await fetchRemoteCradleServerHealth(record)
  return {
    ...toConnectionView(record),
    status: 'ok',
    health,
  }
}

export async function testRemoteHostCradleServer(hostId: string): Promise<RemoteCradleServerHealthView> {
  await disconnectRemoteHostCradleServer(hostId)
  await connectRemoteHostCradleServer(hostId)
  return await readRemoteHostCradleServerHealth(hostId)
}

export async function listRemoteCradleWorkspaces(hostId: string): Promise<RemoteWorkspaceView[]> {
  return await (await remoteCradleClient(hostId, 'list remote workspaces')).listWorkspaces()
}

export async function listRemoteCradleWorkspaceFiles(
  hostId: string,
  remoteWorkspaceId: string,
): Promise<RemoteWorkspaceFileEntry[]> {
  return await (await remoteCradleClient(hostId, 'list remote workspace files')).listWorkspaceFiles(remoteWorkspaceId)
}

export async function listRemoteCradleWorkspaceFileChildren(
  hostId: string,
  remoteWorkspaceId: string,
  relativePath: string,
): Promise<RemoteWorkspaceFileEntry[]> {
  return await (await remoteCradleClient(hostId, 'list remote workspace children'))
    .listWorkspaceFileChildren(remoteWorkspaceId, relativePath)
}

export async function readRemoteCradleWorkspaceFileContent(
  hostId: string,
  remoteWorkspaceId: string,
  relativePath: string,
): Promise<RemoteWorkspaceFileContent> {
  return await (await remoteCradleClient(hostId, 'read remote workspace file'))
    .readWorkspaceFileContent(remoteWorkspaceId, relativePath)
}

export async function readRemoteCradleWorkspaceFileInfo(
  hostId: string,
  remoteWorkspaceId: string,
  relativePath: string,
): Promise<RemoteWorkspaceFileInfo | null> {
  return await (await remoteCradleClient(hostId, 'read remote workspace file info'))
    .readWorkspaceFileInfo(remoteWorkspaceId, relativePath)
}

export async function resolveRemoteWorkspaceByPath(hostId: string, remotePath: string): Promise<RemoteWorkspaceView | null> {
  const workspaces = await listRemoteCradleWorkspaces(hostId)
  return workspaces.find(workspace => workspace.locator.path === remotePath) ?? null
}

async function remoteCradleClient(hostId: string, _operation: string): Promise<RemoteCradleClient> {
  const record = await connectedRecord(hostId)
  return createRemoteCradleClient(record.baseUrl)
}

async function connectedRecord(hostId: string): Promise<RemoteHostConnectionRecord> {
  const record = connections.get(hostId)
  if (record && !record.tunnelExited) {
    return record
  }
  await connectRemoteHostCradleServer(hostId)
  const next = connections.get(hostId)
  if (!next || next.tunnelExited) {
    throw new AppError({
      code: 'remote_cradle_server_not_connected',
      status: 503,
      message: 'Remote Cradle Server is not connected.',
      details: { hostId },
    })
  }
  return next
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
      message: 'Remote Cradle Server capability is disabled.',
      details: { hostId },
    })
  }

  let tunnel: RemoteCradleServerTunnelHandle | null = null
  let record: RemoteHostConnectionRecord | null = null
  try {
    let baseUrl: string
    if (connectionConfig.transport === 'direct-url') {
      baseUrl = normalizeBaseUrl(connectionConfig.baseUrl ?? '')
    }
    else if (connectionConfig.transport === 'relay') {
      tunnel = await startRelayControllerTunnel(host, connectionConfig)
      baseUrl = tunnel.localBaseUrl
    }
    else {
      tunnel = await startSshCradleTunnel(host, connectionConfig, capabilities)
      baseUrl = tunnel.localBaseUrl
    }

    record = {
      host,
      tunnel,
      baseUrl,
      lastError: null,
      tunnelExited: false,
    }
    tunnel?.onExit((exit) => {
      if (!record) {
        return
      }
      record.tunnelExited = true
      record.lastError = `tunnel exited with code ${exit.code ?? 'null'} signal ${exit.signal ?? 'null'}`
    })
    connections.set(hostId, record)
    await fetchRemoteCradleServerHealth(record)
    return toConnectionView(record)
  }
  catch (error) {
    await tunnel?.close()
    const appError = toAppError(error, 'remote_cradle_server_connect_failed')
    connections.set(hostId, {
      host,
      tunnel: null,
      baseUrl: connectionConfig.transport === 'direct-url' ? connectionConfig.baseUrl ?? '' : '',
      lastError: appError.message,
      tunnelExited: true,
    })
    throw appError
  }
}

async function startSshCradleTunnel(
  host: RemoteHost,
  connectionConfig: RemoteHostConnectionConfig,
  capabilities: RemoteHostCapabilities,
): Promise<RemoteCradleServerTunnelHandle> {
  if (!connectionConfig.ssh) {
    throw new AppError({
      code: 'remote_cradle_server_ssh_required',
      status: 400,
      message: 'SSH profile is required when remote host transport is ssh.',
      details: { hostId: host.id },
    })
  }
  const sshLaunch = resolveHostSshLaunchConfig(connectionConfig)
  return await startRemoteCradleServerTunnel({
    hostId: host.id,
    sshTarget: sshLaunch.sshTarget,
    sshExecutable: connectionConfig.sshExecutable,
    sshArgs: [...sshLaunch.sshArgs, ...(connectionConfig.sshArgs ?? [])],
    remoteHost: capabilities.cradleServer.remoteHost,
    remotePort: capabilities.cradleServer.remotePort,
    readyTimeoutMs: connectionConfig.connectTimeoutMs ?? 10_000,
  })
}

// ── Relay transport ──

const RELAY_CONTROLLER_KEY_SECRET_KIND = 'system-relay-controller-key'
const RELAY_CONTROLLER_SIGNING_KEY_SECRET_KIND = 'system-relay-controller-signing-key'

/**
 * Claim a relay pairing: input the pairing string shown by the host, perform
 * the first E2E handshake, verify the host's public key fingerprint (MITM
 * check), then pin both pubkeys and the roomId into the remote-host config.
 * After claiming, `connectRemoteHostCradleServer` reconnects with no pairing
 * code (pinned-pubkey reconnect).
 */
export async function claimRemoteHostRelay(
  hostId: string,
  pairingString: string,
): Promise<RemoteCradleServerConnectionView> {
  const host = requireRemoteHost(hostId)
  const connectionConfig = parseConnectionConfig(host.connectionConfigJson)
  if (connectionConfig.transport !== 'relay' || !connectionConfig.relay) {
    throw new AppError({
      code: 'remote_host_not_relay',
      status: 409,
      message: 'Remote host transport is not relay.',
      details: { hostId },
    })
  }
  const relayUrl = resolveRelayUrl(connectionConfig.relay)
  const { pairingCode, roomId, hostKeyFingerprint } = parsePairingString(pairingString)

  // Controller encryption keypair: reuse if we already have one, else generate + persist.
  const existingKeyRef = connectionConfig.relay.controllerKeyRef
  let controllerPrivateKeyBase64: string
  let controllerPublicKeyBase64: string
  let controllerKeyRef: string
  if (existingKeyRef) {
    controllerPrivateKeyBase64 = readSecret(existingKeyRef)
    controllerPublicKeyBase64 = publicKeyFromPrivate(controllerPrivateKeyBase64)
    controllerKeyRef = existingKeyRef
  }
  else {
    const keypair = generateRelayKeyPair()
    controllerKeyRef = `relay-controller-key:${hostId}`
    upsertSecret({
      id: controllerKeyRef,
      kind: RELAY_CONTROLLER_KEY_SECRET_KIND,
      label: `Relay controller key (${host.displayName})`,
      secret: keypair.privateKeyBase64,
    })
    controllerPrivateKeyBase64 = keypair.privateKeyBase64
    controllerPublicKeyBase64 = keypair.publicKeyBase64
  }

  const controllerSigningPrivateKey = readOrCreateControllerSigningPrivateKey(hostId, host.displayName)

  // Step 1: claim the pairing code with the controller signing identity.
  const claimAssertion = signRelayAssertion(controllerSigningPrivateKey, {
    role: 'controller',
    purpose: 'claim',
    roomId,
    pairingCode,
  })
  await callPairingClaim(relayUrl, {
    assertion: claimAssertion,
  })

  const controllerWsAssertion = signRelayAssertion(controllerSigningPrivateKey, {
    role: 'controller',
    purpose: 'ws',
    roomId,
  })

  // Step 2: run the first handshake to learn + verify the host pubkey.
  const handle = await startRelayControllerTransport({
    hostId,
    relayUrl,
    roomId,
    wsAssertion: controllerWsAssertion,
    controllerPrivateKeyBase64,
    controllerPublicKeyBase64,
    pairingCode,
    controllerName: hostname(),
    readyTimeoutMs: connectionConfig.connectTimeoutMs ?? 15_000,
  })

  const hostPubkey = handle.hostPublicKeyBase64
  await handle.close()
  if (!hostPubkey) {
    throw new AppError({
      code: 'relay_pairing_no_host_key',
      status: 502,
      message: 'Relay handshake completed but no host public key was learned.',
      details: { hostId },
    })
  }
  if (relayPublicKeyFingerprint(hostPubkey) !== hostKeyFingerprint) {
    throw new AppError({
      code: 'relay_pairing_fingerprint_mismatch',
      status: 400,
      message: 'Host public key fingerprint does not match the pairing string. Possible relay tampering.',
      details: { hostId },
    })
  }

  // Step 3: pin the host pubkey, roomId, and controller key reference.
  const pinnedConfig: RemoteHostRelayConfig = {
    ...connectionConfig.relay,
    relayUrl,
    roomId,
    pinnedHostPubkey: hostPubkey,
    controllerKeyRef,
  }
  const updated = parseConnectionConfig(JSON.stringify({ ...connectionConfig, relay: pinnedConfig }))
  db()
    .update(remoteHosts)
    .set({
      connectionConfigJson: JSON.stringify(updated),
      updatedAt: currentUnixSeconds(),
    })
    .where(eq(remoteHosts.id, hostId))
    .run()

  return {
    hostId,
    state: 'idle',
    localBaseUrl: null,
    lastError: null,
  }
}

/** Open a relay controller tunnel using the pinned host pubkey (reconnect). */
async function startRelayControllerTunnel(
  host: RemoteHost,
  connectionConfig: RemoteHostConnectionConfig,
): Promise<RemoteCradleServerTunnelHandle> {
  const relay = connectionConfig.relay
  if (!relay) {
    throw new AppError({
      code: 'remote_cradle_server_relay_required',
      status: 400,
      message: 'Relay configuration is required when transport is relay.',
      details: { hostId: host.id },
    })
  }
  const relayUrl = resolveRelayUrl(relay)
  if (!relay.roomId || !relay.pinnedHostPubkey || !relay.controllerKeyRef) {
    throw new AppError({
      code: 'remote_cradle_server_relay_not_paired',
      status: 409,
      message: 'Relay host has not been paired yet. Call the relay claim endpoint first.',
      details: { hostId: host.id },
    })
  }
  const controllerPrivateKey = readSecret(relay.controllerKeyRef)
  const controllerPublicKey = publicKeyFromPrivate(controllerPrivateKey)
  const controllerSigningPrivateKey = readControllerSigningPrivateKey(host.id)
  const wsAssertion = signRelayAssertion(controllerSigningPrivateKey, {
    role: 'controller',
    purpose: 'ws',
    roomId: relay.roomId,
  })
  return await startRelayControllerTransport({
    hostId: host.id,
    relayUrl,
    roomId: relay.roomId,
    wsAssertion,
    controllerPrivateKeyBase64: controllerPrivateKey,
    controllerPublicKeyBase64: controllerPublicKey,
    pinnedHostPubkey: relay.pinnedHostPubkey,
    controllerName: hostname(),
    readyTimeoutMs: connectionConfig.connectTimeoutMs ?? 15_000,
  }) as RemoteCradleServerTunnelHandle
}

function resolveRelayUrl(relay: RemoteHostRelayConfig): string {
  if (relay.relayUrl) {
    return relay.relayUrl.replace(/\/+$/, '')
  }
  if (relay.relayServerId) {
    return resolveRelayServerUrl(relay.relayServerId)
  }
  throw new AppError({
    code: 'relay_url_required',
    status: 400,
    message: 'relayUrl or relayServerId is required for relay transport.',
  })
}

function parsePairingString(pairingString: string): { pairingCode: string, roomId: string, hostKeyFingerprint: string } {
  const trimmed = pairingString.trim()
  const hashIndex = trimmed.lastIndexOf('#')
  if (hashIndex <= 0 || hashIndex >= trimmed.length - 1) {
    throw new AppError({
      code: 'relay_pairing_string_invalid',
      status: 400,
      message: 'Pairing string must be `<pairingCode>:<roomId>#<hostKeyFingerprint>`.',
    })
  }
  const prefix = trimmed.slice(0, hashIndex)
  const separatorIndex = prefix.lastIndexOf(':')
  if (separatorIndex <= 0 || separatorIndex >= prefix.length - 1) {
    throw new AppError({
      code: 'relay_pairing_string_invalid',
      status: 400,
      message: 'Pairing string must be `<pairingCode>:<roomId>#<hostKeyFingerprint>`.',
    })
  }
  return {
    pairingCode: prefix.slice(0, separatorIndex),
    roomId: prefix.slice(separatorIndex + 1),
    hostKeyFingerprint: trimmed.slice(hashIndex + 1),
  }
}

function readOrCreateControllerSigningPrivateKey(hostId: string, displayName: string): string {
  const secretId = controllerSigningSecretId(hostId)
  try {
    return readSecret(secretId)
  }
  catch (error) {
    if (!(error instanceof AppError) || error.code !== 'secret_not_found') {
      throw error
    }
  }
  const keypair = generateRelaySigningKeyPair()
  upsertSecret({
    id: secretId,
    kind: RELAY_CONTROLLER_SIGNING_KEY_SECRET_KIND,
    label: `Relay controller signing key (${displayName})`,
    secret: keypair.privateKeyBase64,
  })
  return keypair.privateKeyBase64
}

function readControllerSigningPrivateKey(hostId: string): string {
  try {
    return readSecret(controllerSigningSecretId(hostId))
  }
  catch (error) {
    throw new AppError({
      code: 'remote_cradle_server_relay_signing_key_missing',
      status: 409,
      message: 'Relay controller is missing its signing key. Re-create the pairing.',
      details: { hostId, cause: error instanceof Error ? error.message : String(error) },
    })
  }
}

function controllerSigningSecretId(hostId: string): string {
  return `relay-controller-sign-key:${hostId}`
}

interface PairingClaimResponse {
  roomId: string
  expiresAt: string
}

async function callPairingClaim(
  relayUrl: string,
  body: { assertion: SignedRelayAssertion },
): Promise<PairingClaimResponse> {
  const url = new URL('/pairing/claim', `${relayUrl.replace(/\/+$/, '')}/`)
  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ assertion: body.assertion }),
      signal: AbortSignal.timeout(10_000),
    })
  }
  catch (error) {
    throw new AppError({
      code: 'relay_pairing_claim_unreachable',
      status: 502,
      message: `Could not reach relayd /pairing/claim: ${error instanceof Error ? error.message : String(error)}`,
    })
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new AppError({
      code: 'relay_pairing_claim_failed',
      status: 502,
      message: `relayd /pairing/claim returned ${response.status}: ${text}`,
    })
  }
  return await response.json() as PairingClaimResponse
}

async function fetchRemoteCradleServerHealth(record: RemoteHostConnectionRecord): Promise<RemoteCradleServerHealthPayload> {
  if (record.tunnelExited) {
    throw new AppError({
      code: 'remote_cradle_server_offline',
      status: 503,
      message: 'Remote Cradle Server connection is not connected.',
      details: { hostId: record.host.id },
    })
  }
  try {
    return await createRemoteCradleClient(record.baseUrl).readHealth()
  }
  catch (error) {
    record.lastError = error instanceof Error ? error.message : String(error)
    throw toAppError(error, 'remote_cradle_server_health_failed')
  }
}

function resolveHostSshLaunchConfig(connectionConfig: RemoteHostConnectionConfig): SshProfileLaunchConfig {
  if (!connectionConfig.ssh) {
    throw new AppError({
      code: 'remote_host_ssh_profile_required',
      status: 400,
      message: 'Remote host SSH profile is required.',
    })
  }
  return buildRemoteCradleSshLaunchConfig(connectionConfig.ssh)
}

function toHostView(host: RemoteHost): RemoteHostView {
  const record = connections.get(host.id)
  return {
    ...host,
    connectionState: record ? connectionStateOf(record) : 'idle',
    lastError: record?.lastError ?? null,
  }
}

function toConnectionView(record: RemoteHostConnectionRecord): RemoteCradleServerConnectionView {
  return {
    hostId: record.host.id,
    state: connectionStateOf(record),
    localBaseUrl: record.tunnelExited ? null : record.baseUrl,
    lastError: record.lastError,
  }
}

function connectionStateOf(record: RemoteHostConnectionRecord): RemoteHostConnectionState {
  return record.tunnelExited ? 'offline' : 'connected'
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

function normalizeRemoteHostConnection(
  input: RemoteHostConnectionPatch,
  current: RemoteHost | null,
): NormalizedRemoteHostConnection {
  const currentConnectionConfig = current ? parseConnectionConfig(current.connectionConfigJson) : {}
  const currentCapabilities = current ? parseCapabilities(current.capabilitiesJson) : {}
  const connectionConfig = parseConnectionConfig(JSON.stringify({
    ...currentConnectionConfig,
    ...(input.connectionConfig ?? {}),
  }))
  const capabilities = parseCapabilities(JSON.stringify(mergeCapabilities(currentCapabilities, input.capabilities)))
  return {
    connectionConfigJson: JSON.stringify(connectionConfig),
    capabilitiesJson: JSON.stringify(capabilities),
  }
}

function mergeCapabilities(
  current: Partial<RemoteHostCapabilities>,
  input?: RemoteHostCapabilitiesInput,
): RemoteHostCapabilitiesInput {
  return {
    cradleServer: {
      ...(current.cradleServer ?? {}),
      ...(input?.cradleServer ?? {}),
    },
  }
}

function parseConnectionConfig(raw: string): RemoteHostConnectionConfig {
  return connectionConfigSchema.parse(JSON.parse(raw || '{}'))
}

function parseCapabilities(raw: string): RemoteHostCapabilities {
  return capabilitiesSchema.parse(JSON.parse(raw || '{}'))
}

function normalizeBaseUrl(raw: string): string {
  const value = raw.trim().replace(/\/+$/, '')
  if (!value) {
    throw new AppError({
      code: 'remote_cradle_base_url_required',
      status: 400,
      message: 'Remote Cradle Server base URL is required for direct-url transport.',
    })
  }
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('Remote Cradle Server base URL must use http or https.')
    }
    return url.toString().replace(/\/+$/, '')
  }
  catch (error) {
    throw new AppError({
      code: 'remote_cradle_base_url_invalid',
      status: 400,
      message: error instanceof Error ? error.message : String(error),
      details: { baseUrl: raw },
    })
  }
}

function hasConnectionPatch(patch: UpdateRemoteHostInput): boolean {
  return patch.connectionConfig !== undefined || patch.capabilities !== undefined
}

function currentUnixSeconds(): number {
  return Math.floor(Date.now() / 1000)
}

function toAppError(error: unknown, fallbackCode: string): AppError {
  if (error instanceof AppError) {
    return error
  }
  return new AppError({
    code: fallbackCode,
    status: 503,
    message: error instanceof Error ? error.message : String(error),
  })
}
