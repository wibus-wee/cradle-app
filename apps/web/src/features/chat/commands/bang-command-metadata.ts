// Reads Cradle-owned bang command metadata from trusted chat UIMessage snapshots.
import type { UIMessage } from 'ai'

export interface BangResultMetadata {
  command: string
  stdout: string
  stderr: string
  exitCode: number | null
  durationMs: number
  timedOut: boolean
  truncated: boolean
}

export interface BangCommandMetadata {
  command: string
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

export function readBangCommandMetadata(message: UIMessage): BangCommandMetadata | null {
  const metadata = readRecord((message as { metadata?: unknown }).metadata)
  const cradleMetadata = readRecord(metadata.cradle)
  const bangCommand = readRecord(cradleMetadata.bangCommand)
  const command = typeof bangCommand.command === 'string' ? bangCommand.command.trim() : ''
  return command ? { command } : null
}

export function annotateBangCommandMessage(message: UIMessage, command: string): UIMessage {
  const metadata = readRecord((message as { metadata?: unknown }).metadata)
  const cradleMetadata = readRecord(metadata.cradle)
  return {
    ...message,
    metadata: {
      ...metadata,
      cradle: {
        ...cradleMetadata,
        bangCommand: { command },
      },
    },
  } as UIMessage
}

export function annotateBangResultMessage(message: UIMessage, result: BangResultMetadata): UIMessage {
  const metadata = readRecord((message as { metadata?: unknown }).metadata)
  const cradleMetadata = readRecord(metadata.cradle)
  return {
    ...message,
    metadata: {
      ...metadata,
      cradle: {
        ...cradleMetadata,
        bangResult: result,
      },
    },
  } as UIMessage
}

export function readBangResultMetadata(message: UIMessage): BangResultMetadata | null {
  const metadata = readRecord((message as { metadata?: unknown }).metadata)
  const cradleMetadata = readRecord(metadata.cradle)
  const bangResult = readRecord(cradleMetadata.bangResult)
  const command = typeof bangResult.command === 'string' ? bangResult.command.trim() : ''
  if (!command) {
    return null
  }

  return {
    command,
    stdout: typeof bangResult.stdout === 'string' ? bangResult.stdout : '',
    stderr: typeof bangResult.stderr === 'string' ? bangResult.stderr : '',
    exitCode: typeof bangResult.exitCode === 'number' ? bangResult.exitCode : null,
    durationMs: typeof bangResult.durationMs === 'number' ? bangResult.durationMs : 0,
    timedOut: bangResult.timedOut === true,
    truncated: bangResult.truncated === true,
  }
}
