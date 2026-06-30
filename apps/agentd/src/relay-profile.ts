import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export interface AgentdRelayProfile {
  serverUrl: string
  relayUrl: string
  enrollmentId: string
  enrollmentSecret: string
}

export function readRelayProfile(homeDir: string, name: string): AgentdRelayProfile {
  const path = relayProfilePath(homeDir, name)
  if (!existsSync(path)) {
    throw new Error(`agentd relay profile ${name} does not exist`)
  }
  return parseRelayProfile(JSON.parse(readFileSync(path, 'utf8')))
}

export function writeRelayProfile(homeDir: string, name: string, profile: AgentdRelayProfile): void {
  const dir = join(homeDir, 'relay-profiles')
  mkdirSync(dir, { recursive: true })
  writeFileSync(relayProfilePath(homeDir, name), `${JSON.stringify(profile, null, 2)}\n`, { mode: 0o600 })
}

function relayProfilePath(homeDir: string, name: string): string {
  return join(homeDir, 'relay-profiles', `${sanitizeProfileName(name)}.json`)
}

function sanitizeProfileName(name: string): string {
  const trimmed = name.trim()
  if (!/^[a-zA-Z0-9._-]+$/.test(trimmed)) {
    throw new Error('agentd relay profile name may only contain letters, numbers, dot, underscore, and dash')
  }
  return trimmed
}

function parseRelayProfile(value: AgentdRelayProfile): AgentdRelayProfile {
  assertNonBlank(value.serverUrl, 'serverUrl')
  assertNonBlank(value.relayUrl, 'relayUrl')
  assertNonBlank(value.enrollmentId, 'enrollmentId')
  assertNonBlank(value.enrollmentSecret, 'enrollmentSecret')
  return {
    serverUrl: value.serverUrl.trim(),
    relayUrl: value.relayUrl.trim(),
    enrollmentId: value.enrollmentId.trim(),
    enrollmentSecret: value.enrollmentSecret.trim(),
  }
}

function assertNonBlank(value: string, field: string): void {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`agentd relay profile ${field} is required`)
  }
}
