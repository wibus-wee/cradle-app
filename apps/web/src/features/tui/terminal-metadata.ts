export interface TerminalMetadata {
  title: string | null
  cwd: string | null
}

const OSC_TERMINATOR_RE = /\u0007|\u001B\\/
const OSC_SEQUENCE_RE = /\u001B\](\d+);([^\u0007\u001B]*(?:\u001B(?!\\)[^\u0007\u001B]*)*)(?:\u0007|\u001B\\)/g
const TITLE_OSC_CODES = new Set(['0', '2'])
const CWD_OSC_CODES = new Set(['7'])

export function readTerminalMetadata(input: string): TerminalMetadata {
  const metadata: TerminalMetadata = { title: null, cwd: null }
  OSC_SEQUENCE_RE.lastIndex = 0
  let match: RegExpExecArray | null = OSC_SEQUENCE_RE.exec(input)

  while (match !== null) {
    const code = match[1]!
    const value = decodeOscValue(match[2] ?? '').trim()

    if (value) {
      if (TITLE_OSC_CODES.has(code)) {
        metadata.title = value
      }
      if (CWD_OSC_CODES.has(code)) {
        metadata.cwd = normalizeTerminalPath(value)
      }
    }

    match = OSC_SEQUENCE_RE.exec(input)
  }

  return metadata
}

export function mergeTerminalMetadata(current: TerminalMetadata, next: TerminalMetadata): TerminalMetadata {
  return {
    title: next.title ?? current.title,
    cwd: next.cwd ?? current.cwd,
  }
}

export function getTerminalPathLabel(workspacePath: string, cwd: string | null): string | null {
  if (!cwd) {
    return null
  }

  const workspace = trimTrailingPathSeparator(workspacePath)
  const current = trimTrailingPathSeparator(cwd)

  if (!workspace || !current || current === workspace) {
    return null
  }

  const workspacePrefix = `${workspace}/`
  if (current.startsWith(workspacePrefix)) {
    const relative = current.slice(workspacePrefix.length)
    const firstSegment = relative.split('/').find(Boolean)
    return firstSegment ?? null
  }

  return current.split('/').filter(Boolean).at(-1) ?? current
}

function decodeOscValue(value: string): string {
  return value.replace(OSC_TERMINATOR_RE, '')
}

function normalizeTerminalPath(value: string): string | null {
  if (value.startsWith('file://')) {
    try {
      return decodeURIComponent(new URL(value).pathname)
    }
    catch {
      return value.slice('file://'.length)
    }
  }

  return value || null
}

function trimTrailingPathSeparator(value: string): string {
  if (value === '/') {
    return value
  }
  return value.replace(/\/+$/, '')
}
