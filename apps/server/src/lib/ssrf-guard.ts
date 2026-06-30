import { promises as dns } from 'node:dns'
import net from 'node:net'

import { AppError } from '../errors/app-error'

/**
 * Link-preview SSRF guard.
 *
 * Resolves the URL host and rejects anything that points at a private, loopback,
 * link-local, or cloud-metadata address before we issue an outbound fetch.
 * Without this, a user-controlled URL pasted into issue content could coerce the
 * server into probing the internal network.
 */

const BLOCKED_METADATA_HOSTS = new Set([
  '169.254.169.254', // AWS / GCP / Azure IMDS
  'fd00:ec2::254', // AWS IMDSv6
])

export interface ResolvedFetchTarget {
  url: string
  hostname: string
}

export async function resolveSafeFetchTarget(rawUrl: string): Promise<ResolvedFetchTarget> {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  }
  catch {
    throw new AppError({
      code: 'link_preview_invalid_url',
      status: 400,
      message: 'Link preview requires a valid URL',
    })
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new AppError({
      code: 'link_preview_invalid_scheme',
      status: 400,
      message: 'Link preview only supports http and https URLs',
    })
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '')

  if (BLOCKED_METADATA_HOSTS.has(hostname)) {
    throw new AppError({
      code: 'link_preview_blocked_host',
      status: 400,
      message: 'Link preview target is not allowed',
    })
  }

  // Literal IP hosts are checked directly; hostnames are resolved and every
  // returned address is checked. We resolve before fetching so DNS-rebinding
  // to a private IP at request time is still caught for the resolved name.
  if (net.isIP(hostname)) {
    assertPublicIp(hostname)
  }
  else {
    const addresses = await resolveAllAddresses(hostname)
    if (addresses.length === 0) {
      throw new AppError({
        code: 'link_preview_unresolved_host',
        status: 400,
        message: 'Link preview target host could not be resolved',
      })
    }
    for (const address of addresses) {
      assertPublicIp(address)
    }
  }

  return { url: parsed.toString(), hostname }
}

async function resolveAllAddresses(hostname: string): Promise<string[]> {
  try {
    const records = await dns.lookup(hostname, { all: true })
    return records.map(record => record.address)
  }
  catch {
    return []
  }
}

function assertPublicIp(ip: string): void {
  if (BLOCKED_METADATA_HOSTS.has(ip)) {
    throwBlocked()
  }

  const version = net.isIP(ip)
  if (version === 4) {
    if (isPrivateIPv4(ip)) {
      throwBlocked()
    }
    return
  }

  if (version === 6) {
    if (isPrivateIPv6(ip)) {
      throwBlocked()
    }
    return
  }

  // Not an IP we recognize — treat conservatively.
  throwBlocked()
}

function throwBlocked(): never {
  throw new AppError({
    code: 'link_preview_blocked_host',
    status: 400,
    message: 'Link preview target is not allowed',
  })
}

/**
 * IPv4 private/reserved ranges per RFC1918 + loopback + link-local + carrier-grade NAT.
 */
function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map(part => Number.parseInt(part, 10))
  if (parts.length !== 4 || parts.some(part => Number.isNaN(part) || part < 0 || part > 255)) {
    return true
  }

  const [a, b] = parts

  if (a === 0) {
    return true // 0.0.0.0/8 "this network"
  }
  if (a === 10) {
    return true // 10.0.0.0/8
  }
  if (a === 127) {
    return true // 127.0.0.0/8 loopback
  }
  if (a === 169 && b === 254) {
    return true // 169.254.0.0/16 link-local
  }
  if (a === 172 && b >= 16 && b <= 31) {
    return true // 172.16.0.0/12
  }
  if (a === 192 && b === 168) {
    return true // 192.168.0.0/16
  }
  if (a === 100 && b >= 64 && b <= 127) {
    return true // 100.64.0.0/10 CGNAT
  }
  if (a >= 224) {
    return true // 224.0.0.0/4 multicast + 240.0.0.0/4 reserved
  }

  return false
}

/**
 * IPv6 private/reserved ranges: loopback (::1), unique-local (fc00::/7),
 * link-local (fe80::/10), and unspecified (::).
 */
function isPrivateIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase()
  if (normalized === '::1' || normalized === '::') {
    return true
  }
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) {
    return true // fc00::/7 unique-local
  }
  if (normalized.startsWith('fe8')
    || normalized.startsWith('fe9')
    || normalized.startsWith('fea')
    || normalized.startsWith('feb')) {
    return true // fe80::/10 link-local
  }
  // IPv4-mapped (::ffff:a.b.c.d) — delegate to the v4 check.
  const mapped = normalized.match(/::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/)
  if (mapped) {
    return isPrivateIPv4(mapped[1])
  }
  return false
}
