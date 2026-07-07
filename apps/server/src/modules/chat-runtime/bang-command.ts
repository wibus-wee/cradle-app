// Executes standard-runtime Composer bang commands and persists their transcript snapshots.
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'

import { sessions } from '@cradle/db'
import type { UIMessage } from 'ai'
import { eq } from 'drizzle-orm'

import { AppError } from '../../errors/app-error'
import { currentUnixSeconds } from '../../helpers/time'
import { db } from '../../infra'
import * as Workspace from '../workspace/service'
import { commitSessionEvents } from './es/commands'
import {
  annotateBangCommandMessage,
  annotateBangResultMessage,
  createUserMessage,
  extractMessageText,
} from './ui-message'

const BANG_COMMAND_TIMEOUT_MS = 30_000
const BANG_COMMAND_FORCE_KILL_GRACE_MS = 2_000
const BANG_COMMAND_OUTPUT_MAX_BYTES = 100 * 1024

type ChatBangMessage = Omit<UIMessage, 'role'> & { role: 'user' | 'assistant' }

export interface BangCommandExecutionResult {
  command: string
  stdout: string
  stderr: string
  exitCode: number | null
  durationMs: number
  timedOut: boolean
  truncated: boolean
  userMessageId: string
  resultMessageId: string
  userMessage: ChatBangMessage
  resultMessage: ChatBangMessage
}

interface BoundedBuffer {
  chunks: Buffer[]
  bytes: number
  truncated: boolean
}

function createBoundedBuffer(): BoundedBuffer {
  return {
    chunks: [],
    bytes: 0,
    truncated: false,
  }
}

function appendBoundedChunk(target: BoundedBuffer, chunk: Buffer | string): void {
  if (target.bytes >= BANG_COMMAND_OUTPUT_MAX_BYTES) {
    target.truncated = true
    return
  }

  const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
  const remaining = BANG_COMMAND_OUTPUT_MAX_BYTES - target.bytes
  if (buffer.byteLength > remaining) {
    target.chunks.push(buffer.subarray(0, remaining))
    target.bytes += remaining
    target.truncated = true
    return
  }

  target.chunks.push(buffer)
  target.bytes += buffer.byteLength
}

function readBoundedBuffer(target: BoundedBuffer): string {
  return Buffer.concat(target.chunks, target.bytes).toString('utf8')
}

function readBangCommandCwd(sessionId: string): string {
  const session = db().select().from(sessions).where(eq(sessions.id, sessionId)).get()
  if (!session) {
    throw new AppError({
      code: 'chat_session_not_found',
      status: 404,
      message: 'Chat session was not found',
      details: { sessionId },
    })
  }
  if (!session.workspaceId) {
    throw new AppError({
      code: 'chat_session_workspace_required',
      status: 400,
      message: 'Bang commands require a workspace-backed chat session',
      details: { sessionId },
    })
  }

  const workspacePath = Workspace.getLocalWorkspacePath(session.workspaceId)
  if (!workspacePath) {
    throw new AppError({
      code: 'chat_session_local_workspace_required',
      status: 409,
      message: 'Bang commands require a local workspace-backed chat session',
      details: { sessionId, workspaceId: session.workspaceId },
    })
  }

  return workspacePath
}

function readProviderVisibleResultText(input: {
  stdout: string
  stderr: string
  exitCode: number | null
  timedOut: boolean
  truncated: boolean
}): string {
  const text
    = input.stdout.length > 0
      ? input.stdout
      : input.stderr.length > 0
        ? input.stderr
        : input.timedOut
          ? 'Command timed out with no output.'
          : `Command exited with code ${input.exitCode ?? 'unknown'} and no output.`

  return input.truncated ? `${text}\n\n[Output truncated]` : text
}

export async function persistBangCommandMessages(input: {
  sessionId: string
  command: string
  stdout: string
  stderr: string
  exitCode: number | null
  durationMs: number
  timedOut: boolean
  truncated: boolean
}): Promise<{
  userMessageId: string
  resultMessageId: string
  userMessage: ChatBangMessage
  resultMessage: ChatBangMessage
}> {
  const userMessageId = randomUUID()
  const resultMessageId = randomUUID()
  const userMessage = annotateBangCommandMessage(
    createUserMessage(userMessageId, `!${input.command}`),
    input.command,
  )
  const resultText = readProviderVisibleResultText(input)
  const resultMessage = annotateBangResultMessage(createUserMessage(resultMessageId, resultText), {
    command: input.command,
    stdout: input.stdout,
    stderr: input.stderr,
    exitCode: input.exitCode,
    durationMs: input.durationMs,
    timedOut: input.timedOut,
    truncated: input.truncated,
  })
  const now = currentUnixSeconds()

  await commitSessionEvents(input.sessionId, [
    {
      type: 'UserMessageAppended',
      payload: {
        message: {
          id: userMessageId,
          sessionId: input.sessionId,
          parentMessageId: null,
          parentToolCallId: null,
          taskId: null,
          depth: 0,
          role: 'user',
          status: 'complete',
          content: extractMessageText(userMessage),
          messageJson: JSON.stringify(userMessage),
          createdAt: now,
          updatedAt: now,
        },
      },
    },
    {
      type: 'UserMessageAppended',
      payload: {
        message: {
          id: resultMessageId,
          sessionId: input.sessionId,
          parentMessageId: null,
          parentToolCallId: null,
          taskId: null,
          depth: 0,
          role: 'user',
          status: 'complete',
          content: extractMessageText(resultMessage),
          messageJson: JSON.stringify(resultMessage),
          createdAt: now,
          updatedAt: now,
        },
      },
    },
  ])

  return {
    userMessageId,
    resultMessageId,
    userMessage: userMessage as ChatBangMessage,
    resultMessage: resultMessage as ChatBangMessage,
  }
}

export async function executeLocalBangCommand(input: {
  sessionId: string
  command: string
  signal?: AbortSignal
}): Promise<BangCommandExecutionResult> {
  const command = input.command.trim()
  if (!command) {
    throw new AppError({
      code: 'chat_bang_command_empty',
      status: 400,
      message: 'Bang command must not be empty',
    })
  }
  if (command.includes('\n') || command.includes('\r')) {
    throw new AppError({
      code: 'chat_bang_command_multiline_unsupported',
      status: 400,
      message: 'Bang command must be a single line',
    })
  }

  const cwd = readBangCommandCwd(input.sessionId)
  const stdout = createBoundedBuffer()
  const stderr = createBoundedBuffer()
  const startedAt = Date.now()
  let timedOut = false

  const result = await new Promise<{
    exitCode: number | null
  }>((resolve, reject) => {
    const child = spawn(command, {
      shell: true,
      cwd,
      env: process.env,
    })
    let settled = false
    let forceKillTimer: ReturnType<typeof setTimeout> | null = null

    const clearTimers = () => {
      clearTimeout(killTimer)
      if (forceKillTimer) {
        clearTimeout(forceKillTimer)
        forceKillTimer = null
      }
    }

    const killTimer = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
      forceKillTimer = setTimeout(() => {
        child.kill('SIGKILL')
      }, BANG_COMMAND_FORCE_KILL_GRACE_MS)
    }, BANG_COMMAND_TIMEOUT_MS)
    const abort = () => {
      if (settled) {
        return
      }
      settled = true
      clearTimers()
      input.signal?.removeEventListener('abort', abort)
      child.kill('SIGTERM')
      reject(new DOMException('Bang command aborted', 'AbortError'))
    }

    child.stdout?.on('data', chunk => appendBoundedChunk(stdout, chunk as Buffer | string))
    child.stderr?.on('data', chunk => appendBoundedChunk(stderr, chunk as Buffer | string))
    input.signal?.addEventListener('abort', abort, { once: true })
    child.once('error', (error) => {
      if (settled) {
        return
      }
      settled = true
      clearTimers()
      input.signal?.removeEventListener('abort', abort)
      reject(error)
    })
    child.once('close', (exitCode) => {
      if (settled) {
        return
      }
      settled = true
      clearTimers()
      input.signal?.removeEventListener('abort', abort)
      resolve({ exitCode })
    })
  })

  const durationMs = Math.max(0, Date.now() - startedAt)
  const output = {
    command,
    stdout: readBoundedBuffer(stdout),
    stderr: readBoundedBuffer(stderr),
    exitCode: result.exitCode,
    durationMs,
    timedOut,
    truncated: stdout.truncated || stderr.truncated,
  }
  const persisted = await persistBangCommandMessages({
    sessionId: input.sessionId,
    ...output,
  })

  return {
    ...output,
    ...persisted,
  }
}
