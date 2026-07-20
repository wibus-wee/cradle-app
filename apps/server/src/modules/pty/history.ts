import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { getServerConfig } from '../../infra'

const HISTORY_VERSION = 1
const MAX_HISTORY_CHARS = 256 * 1024

export interface TerminalHistoryBlob {
  version: number
  sessionId: string
  ansi: string
  lines: number
  capturedAt: number
}

function isHistoryEnabled(): boolean {
  return process.env.CRADLE_TERMINAL_HISTORY === '1'
    || process.env.CRADLE_TERMINAL_HISTORY === 'true'
}

function historyDir(): string | null {
  const config = getServerConfig()
  const dataDir = config.dataDir ?? dirname(config.dbPath)
  if (!dataDir) {
    return null
  }
  return join(dataDir, 'terminal-history')
}

function historyPath(sessionId: string): string | null {
  const dir = historyDir()
  if (!dir) {
    return null
  }
  // Keep path components simple; session ids are UUIDs / opaque ids.
  const safeId = sessionId.replace(/[^\w.-]/g, '_')
  return join(dir, `${safeId}.json`)
}

export function readTerminalHistory(sessionId: string): TerminalHistoryBlob | null {
  if (!isHistoryEnabled()) {
    return null
  }
  const path = historyPath(sessionId)
  if (!path) {
    return null
  }
  try {
    const raw = readFileSync(path, 'utf8')
    const parsed = JSON.parse(raw) as TerminalHistoryBlob
    if (parsed.version !== HISTORY_VERSION || typeof parsed.ansi !== 'string') {
      return null
    }
    return parsed
  }
  catch {
    return null
  }
}

export function writeTerminalHistory(sessionId: string, ansi: string): void {
  if (!isHistoryEnabled()) {
    return
  }
  const path = historyPath(sessionId)
  if (!path || !ansi) {
    return
  }
  try {
    mkdirSync(dirname(path), { recursive: true })
    const trimmed = ansi.length > MAX_HISTORY_CHARS
      ? ansi.slice(ansi.length - MAX_HISTORY_CHARS)
      : ansi
    const blob: TerminalHistoryBlob = {
      version: HISTORY_VERSION,
      sessionId,
      ansi: trimmed,
      lines: trimmed.split('\n').length,
      capturedAt: Math.floor(Date.now() / 1000),
    }
    writeFileSync(path, JSON.stringify(blob), 'utf8')
  }
  catch {
    // History is best-effort and may contain secrets; never fail process lifecycle.
  }
}

export function deleteTerminalHistory(sessionId: string): void {
  const path = historyPath(sessionId)
  if (!path) {
    return
  }
  try {
    unlinkSync(path)
  }
  catch {
    // ignore missing/unreadable
  }
}

export function terminalHistoryEnabled(): boolean {
  return isHistoryEnabled()
}
