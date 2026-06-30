#!/usr/bin/env node
import { homedir } from 'node:os'
import { join } from 'node:path'

import { startAgentdRelayClient, startAgentdRelayHostSessionClient } from './relay-client'
import { readRelayProfile, writeRelayProfile } from './relay-profile'
import { startAgentdServer } from './server'

function readArg(name: string): string | null {
  const index = process.argv.indexOf(name)
  if (index === -1) {
    return null
  }
  return process.argv[index + 1] ?? null
}

function readFlag(name: string): boolean {
  return process.argv.includes(name)
}

function readNumberArg(name: string): number | undefined {
  const value = readArg(name)
  if (!value) {
    return undefined
  }
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive number`)
  }
  return parsed
}

function resolveHomeDir(): string {
  const explicitHome = process.env.CRADLE_AGENTD_HOME?.trim()
  if (explicitHome) {
    return explicitHome
  }
  if (process.env.npm_lifecycle_event === 'dev') {
    return join(process.cwd(), '.cradle', 'agentd')
  }
  return join(homedir(), '.cradle', 'agentd')
}

function resolveSocketPath(homeDir: string): string {
  return readArg('--socket')
    ?? process.env.CRADLE_AGENTD_SOCKET?.trim()
    ?? join(homeDir, 'agent.sock')
}

function resolveRelayProfileName(): string {
  return readArg('--profile') ?? process.env.CRADLE_AGENTD_RELAY_PROFILE?.trim() ?? 'default'
}

function resolveRelaySubcommand(): string {
  const value = process.argv[3]
  if (!value || value.startsWith('--')) {
    return 'enroll'
  }
  return value
}

const homeDir = resolveHomeDir()

if (process.argv[2] === 'relay') {
  const subcommand = resolveRelaySubcommand()

  if (subcommand === 'start') {
    runPersistentRelay()
      .catch((error) => {
        console.error('[agentd] relay start failed', error)
        process.exitCode = 1
      })
  }
  else if (subcommand === 'enroll') {
    runRelayEnrollment()
      .catch((error) => {
        console.error('[agentd] relay failed', error)
        process.exitCode = 1
      })
  }
  else {
    console.error(`[agentd] unknown relay subcommand ${subcommand}`)
    process.exitCode = 1
  }
}
else {
  const socketPath = resolveSocketPath(homeDir)

  startAgentdServer({ homeDir, socketPath })
    .then(() => {
      console.log(`[agentd] listening on ${socketPath}`)
    })
    .catch((error) => {
      console.error('[agentd] failed to start', error)
      process.exitCode = 1
    })
}

async function runRelayEnrollment(): Promise<void> {
  const relayUrl = readArg('--relay-url') ?? process.env.CRADLE_AGENTD_RELAY_URL?.trim()
  const pairingToken = readArg('--pairing-token') ?? process.env.CRADLE_AGENTD_PAIRING_TOKEN?.trim()
  const hostToken = readArg('--host-token') ?? process.env.CRADLE_AGENTD_HOST_TOKEN?.trim()
  const roomId = readArg('--room-id') ?? process.env.CRADLE_AGENTD_ROOM_ID?.trim()
  const saveProfile = readFlag('--save-profile')
  const profileName = resolveRelayProfileName()
  const serverUrl = readArg('--server-url') ?? process.env.CRADLE_AGENTD_SERVER_URL?.trim()
  const enrollmentId = readArg('--enrollment-id') ?? process.env.CRADLE_AGENTD_RELAY_ENROLLMENT_ID?.trim()
  const enrollmentSecret = readArg('--enrollment-secret') ?? process.env.CRADLE_AGENTD_RELAY_ENROLLMENT_SECRET?.trim()

  if (!relayUrl || !pairingToken) {
    throw new Error('relay enroll requires --relay-url and --pairing-token')
  }
  if (saveProfile && (!serverUrl || !enrollmentId || !enrollmentSecret)) {
    throw new Error('relay enroll --save-profile requires --server-url, --enrollment-id, and --enrollment-secret')
  }

  const client = await startAgentdRelayClient({
    homeDir,
    relayUrl,
    pairingToken,
    hostToken,
    roomId,
  })
  if (saveProfile && serverUrl && enrollmentId && enrollmentSecret) {
    writeRelayProfile(homeDir, profileName, {
      serverUrl,
      relayUrl,
      enrollmentId,
      enrollmentSecret,
    })
    console.log(`[agentd] relay profile ${profileName} saved`)
  }
  console.log(`[agentd] relay pairing code ${client.pairingCode} expires at ${client.expiresAt}`)
  console.log(`[agentd] relay host connected for room ${client.roomId}`)
  await client.closed
}

async function runPersistentRelay(): Promise<void> {
  const profileName = resolveRelayProfileName()
  const profile = readRelayProfile(homeDir, profileName)
  const ttlMs = readNumberArg('--ttl-ms')
  let attempt = 0
  while (true) {
    try {
      const client = await startAgentdRelayHostSessionClient({
        homeDir,
        serverUrl: profile.serverUrl,
        enrollmentId: profile.enrollmentId,
        enrollmentSecret: profile.enrollmentSecret,
        ttlMs,
      })
      attempt = 0
      console.log(`[agentd] relay host session connected for room ${client.roomId} expires at ${client.expiresAt}`)
      await client.closed
      console.error('[agentd] relay host session closed')
    }
    catch (error) {
      console.error('[agentd] relay host session failed', error)
    }
    const backoffMs = Math.min(30_000, 1_000 * 2 ** Math.min(attempt, 5))
    attempt += 1
    await delay(backoffMs)
  }
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
