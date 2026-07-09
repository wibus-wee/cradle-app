import type { GetSessionsByIdResponse } from '~/api-gen/types.gen'

export type SessionExecution
  = | { kind: 'local' }
    | { kind: 'remote-host', hostId: string, remoteSessionId: string }

type SessionWithExecution = {
  // Accept API payloads and loosely typed list rows; validate at runtime.
  execution?: GetSessionsByIdResponse['execution'] | SessionExecution | null | unknown
}

export function readSessionExecution(session: SessionWithExecution | null | undefined): SessionExecution {
  const execution = session?.execution
  if (!execution || typeof execution !== 'object') {
    return { kind: 'local' }
  }
  const record = execution as { kind?: unknown, hostId?: unknown, remoteSessionId?: unknown }
  if (record.kind === 'remote-host'
    && typeof record.hostId === 'string'
    && typeof record.remoteSessionId === 'string') {
    return {
      kind: 'remote-host',
      hostId: record.hostId,
      remoteSessionId: record.remoteSessionId,
    }
  }
  return { kind: 'local' }
}

export function isRemoteHostExecution(session: SessionWithExecution | null | undefined): boolean {
  return readSessionExecution(session).kind === 'remote-host'
}

export function getRemoteHostId(session: SessionWithExecution | null | undefined): string | null {
  const execution = readSessionExecution(session)
  return execution.kind === 'remote-host' ? execution.hostId : null
}
