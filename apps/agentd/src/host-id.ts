import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

export function readHostId(homeDir: string): string {
  mkdirSync(homeDir, { recursive: true })
  const hostIdPath = join(homeDir, 'host-id')
  if (existsSync(hostIdPath)) {
    return readFileSync(hostIdPath, 'utf8').trim()
  }
  const hostId = randomUUID()
  writeFileSync(hostIdPath, `${hostId}\n`, { mode: 0o600 })
  return hostId
}
