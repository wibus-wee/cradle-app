import { createBoundedTextCollector } from '../../bounded-text-collector'
import type { CodexAppServerMessage } from '../app-server/client'
import type {
  CodexAppServerClientLike,
  CodexThreadItem,
  CommandExecutionOutputDeltaNotificationParams,
  ItemNotificationParams,
} from '../types'
import { CodexProviderError } from './stream-diagnostics'

const CODEX_SHELL_COMMAND_RESULT_TIMEOUT_MS = 60_000

export async function waitForCodexShellCommandCompletion(
  client: CodexAppServerClientLike,
  input: {
    threadId: string
    command: string
    signal?: AbortSignal
  },
): Promise<{ item: CodexThreadItem, output: string }> {
  const output = createBoundedTextCollector()
  const controller = new AbortController()
  let timedOut = false
  let commandItemId: string | null = null

  const timeout = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, CODEX_SHELL_COMMAND_RESULT_TIMEOUT_MS)
  const abort = () => controller.abort()
  input.signal?.addEventListener('abort', abort, { once: true })

  try {
    while (true) {
      const notification = await readCodexShellCommandNotification(client, controller.signal, () => {
        if (input.signal?.aborted) {
          throw new DOMException('Codex shell command aborted', 'AbortError')
        }
        if (timedOut) {
          throw new CodexProviderError(
            'codex_shell_command_timeout',
            'Timed out waiting for Codex shell command completion',
            {
              threadId: input.threadId,
              command: input.command,
              timeoutMs: CODEX_SHELL_COMMAND_RESULT_TIMEOUT_MS,
            },
          )
        }
      })
      if (!notification) {
        throw new CodexProviderError(
          'codex_shell_command_stream_closed',
          'Codex app-server stream closed before shell command completed',
          {
            threadId: input.threadId,
            command: input.command,
          },
        )
      }
      if (notification.method === 'item/started') {
        const params = notification.params as ItemNotificationParams | undefined
        const item = params?.item
        if (params?.threadId === input.threadId && isMatchingUserShellCommandItem(item, input.command)) {
          commandItemId = item.id ?? null
        }
        continue
      }
      if (notification.method === 'item/commandExecution/outputDelta') {
        const params = notification.params as CommandExecutionOutputDeltaNotificationParams | undefined
        if (params?.threadId === input.threadId && params.itemId === commandItemId && params.delta) {
          output.append(params.delta)
        }
        continue
      }
      if (notification.method === 'item/completed') {
        const params = notification.params as ItemNotificationParams | undefined
        const item = params?.item
        if (
          params?.threadId === input.threadId
          && item?.type === 'commandExecution'
          && ((commandItemId !== null && item.id === commandItemId)
            || isMatchingUserShellCommandItem(item, input.command))
        ) {
          return { item, output: output.read() ?? '' }
        }
      }
    }
  }
 finally {
    clearTimeout(timeout)
    input.signal?.removeEventListener('abort', abort)
  }
}

async function readCodexShellCommandNotification(
  client: CodexAppServerClientLike,
  signal: AbortSignal,
  onAbort: () => void,
): Promise<CodexAppServerMessage | null> {
  try {
    return await client.nextNotification(signal)
  }
 catch (error) {
    if (signal.aborted) {
      onAbort()
    }
    throw error
  }
}

function isMatchingUserShellCommandItem(
  item: CodexThreadItem | undefined,
  command: string,
): item is CodexThreadItem {
  return (
    item?.type === 'commandExecution'
    && typeof item.id === 'string'
    && (item.source === 'userShell' || item.command === command)
  )
}
