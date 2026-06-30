import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import * as pty from 'node-pty'

import type { PtyExitState } from './protocol'

const execFileAsync = promisify(execFile)

export type PtyRuntimeRole = 'cli-tui' | 'bottom-panel'

interface RuntimeRecord {
  process: pty.IPty | null
  cols: number
  rows: number
  destroyed: boolean
  role: PtyRuntimeRole
  executable: string
  cwd: string
  startedAt: number
}

interface RuntimeHooks {
  onOutput: (sessionId: string, role: PtyRuntimeRole, data: string) => void
  onExit: (sessionId: string, exit: PtyExitState) => void
  onRelease: (sessionId: string) => void
}

export interface EnsurePtyRuntimeInput {
  sessionId: string
  role: PtyRuntimeRole
  executable: string
  args: string[]
  cwd: string
  cols: number
  rows: number
  env?: Record<string, string>
}

export interface PtyRuntimeResourceSnapshot {
  id: string
  role: PtyRuntimeRole
  pid: number
  executable: string
  cwd: string
  running: boolean
  startedAt: number
  cols: number
  rows: number
  rssMB: number | null
  cpuPercent: number | null
  descendantCount: number | null
}

interface ProcessTableRow {
  pid: number
  ppid: number
  rssKB: number
  cpuPercent: number
}

const PROCESS_TABLE_FIELD_SEPARATOR_PATTERN = /\s+/

export class PtyRuntimeRegistry {
  private readonly sessions = new Map<string, RuntimeRecord>()

  constructor(private readonly hooks: RuntimeHooks) {}

  ensureSession(input: EnsurePtyRuntimeInput): void {
    const existing = this.sessions.get(input.sessionId)
    if (existing?.process) {
      existing.cols = input.cols
      existing.rows = input.rows
      existing.destroyed = false
      existing.role = input.role
      existing.executable = input.executable
      existing.cwd = input.cwd
      existing.process.resize(input.cols, input.rows)
      return
    }

    const record = existing ?? {
      process: null,
      cols: input.cols,
      rows: input.rows,
      destroyed: false,
      role: input.role,
      executable: input.executable,
      cwd: input.cwd,
      startedAt: Date.now(),
    }

    record.cols = input.cols
    record.rows = input.rows
    record.destroyed = false
    record.role = input.role
    record.executable = input.executable
    record.cwd = input.cwd
    record.startedAt = Date.now()
    this.sessions.set(input.sessionId, record)

    const child = pty.spawn(input.executable, input.args, {
      name: 'xterm-256color',
      cols: input.cols,
      rows: input.rows,
      cwd: input.cwd,
      env: input.env
        ? ({ ...process.env, ...input.env } as Record<string, string>)
        : (process.env as Record<string, string>),
    })

    record.process = child

    child.onData((data: string) => {
      this.hooks.onOutput(input.sessionId, record.role, data)
    })

    child.onExit(({ exitCode, signal }) => {
      record.process = null
      const exit: PtyExitState = {
        exitCode,
        signal: signal !== undefined ? String(signal) : null,
      }
      this.hooks.onExit(input.sessionId, exit)
      this.sessions.delete(input.sessionId)

      if (record.destroyed) {
        this.hooks.onRelease(input.sessionId)
      }
    })
  }

  destroy(sessionId: string): void {
    const record = this.sessions.get(sessionId)
    if (!record) {
      return
    }

    record.destroyed = true
    if (record.process) {
      record.process.kill()
      return
    }

    this.sessions.delete(sessionId)
    this.hooks.onRelease(sessionId)
  }

  destroyAll(): void {
    for (const sessionId of Array.from(this.sessions.keys())) {
      this.destroy(sessionId)
    }
  }

  write(sessionId: string, data: string): boolean {
    const record = this.sessions.get(sessionId)
    if (!record?.process) {
      return false
    }
    record.process.write(data)
    return true
  }

  resize(sessionId: string, cols: number, rows: number): boolean {
    const record = this.sessions.get(sessionId)
    if (!record?.process) {
      return false
    }

    record.cols = cols
    record.rows = rows
    record.process.resize(cols, rows)
    return true
  }

  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId)
  }

  isRunning(sessionId: string): boolean {
    return !!this.sessions.get(sessionId)?.process
  }

  async snapshotResources(): Promise<PtyRuntimeResourceSnapshot[]> {
    const entries = Array.from(this.sessions.entries()).filter(([, record]) => !!record.process)

    if (entries.length === 0) {
      return []
    }

    const processTable = await readProcessTable()

    return entries.map(([id, record]) => {
      const pid = record.process?.pid ?? 0
      const tree = processTable ? collectProcessTree(pid, processTable) : null
      const rssKB = tree?.reduce((total, row) => total + row.rssKB, 0) ?? null
      const cpuPercent = tree?.reduce((total, row) => total + row.cpuPercent, 0) ?? null

      return {
        id,
        role: record.role,
        pid,
        executable: record.executable,
        cwd: record.cwd,
        running: !!record.process,
        startedAt: record.startedAt,
        cols: record.cols,
        rows: record.rows,
        rssMB: rssKB === null ? null : Math.round((rssKB / 1024) * 100) / 100,
        cpuPercent: cpuPercent === null ? null : Math.round(cpuPercent * 100) / 100,
        descendantCount: tree === null ? null : Math.max(0, tree.length - 1),
      }
    })
  }
}

async function readProcessTable(): Promise<Map<number, ProcessTableRow> | null> {
  try {
    const { stdout } = await execFileAsync('ps', ['-axo', 'pid=,ppid=,rss=,pcpu='])
    const rows = new Map<number, ProcessTableRow>()

    for (const row of parseProcessTable(stdout)) {
      rows.set(row.pid, row)
    }

    return rows
  }
 catch {
    return null
  }
}

function parseProcessTable(stdout: string): ProcessTableRow[] {
  const rows: ProcessTableRow[] = []
  for (const rawLine of stdout.split('\n')) {
    const line = rawLine.trim()
    if (!line) {
      continue
    }

    const [pidRaw, ppidRaw, rssRaw, cpuRaw] = line.split(PROCESS_TABLE_FIELD_SEPARATOR_PATTERN)
    const pid = Number.parseInt(pidRaw ?? '', 10)
    const ppid = Number.parseInt(ppidRaw ?? '', 10)
    const rssKB = Number.parseInt(rssRaw ?? '', 10)
    const cpuPercent = Number.parseFloat(cpuRaw ?? '')
    if (
      !Number.isInteger(pid)
      || !Number.isInteger(ppid)
      || !Number.isInteger(rssKB)
      || !Number.isFinite(cpuPercent)
      || cpuPercent < 0
    ) {
      continue
    }

    rows.push({ pid, ppid, rssKB, cpuPercent })
  }
  return rows
}

function collectProcessTree(
  rootPid: number,
  rows: Map<number, ProcessTableRow>,
): ProcessTableRow[] {
  const root = rows.get(rootPid)
  if (!root) {
    return []
  }

  const result: ProcessTableRow[] = [root]
  const queue = [rootPid]

  while (queue.length > 0) {
    const parentPid = queue.shift()
    if (parentPid === undefined) {
      break
    }

    for (const row of rows.values()) {
      if (row.ppid !== parentPid) {
        continue
      }
      result.push(row)
      queue.push(row.pid)
    }
  }

  return result
}
