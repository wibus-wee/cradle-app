import type { GetSessionsByIdResponse } from '~/api-gen/types.gen'

export type SessionExecution
  = | { kind: 'local' }
    | { kind: 'node', nodeId: string, remoteSessionId: string }

type SessionWithExecution = {
  // Accept API payloads and loosely typed list rows; validate at runtime.
  execution?: GetSessionsByIdResponse['execution'] | SessionExecution | null | unknown
}

export function readSessionExecution(session: SessionWithExecution | null | undefined): SessionExecution {
  const execution = session?.execution
  if (!execution || typeof execution !== 'object') {
    return { kind: 'local' }
  }
  const record = execution as { kind?: unknown, nodeId?: unknown, remoteSessionId?: unknown }
  if (record.kind === 'node'
    && typeof record.nodeId === 'string'
    && typeof record.remoteSessionId === 'string') {
    return {
      kind: 'node',
      nodeId: record.nodeId,
      remoteSessionId: record.remoteSessionId,
    }
  }
  return { kind: 'local' }
}

export function isNodeExecution(session: SessionWithExecution | null | undefined): boolean {
  return readSessionExecution(session).kind === 'node'
}

export function getSessionNodeId(session: SessionWithExecution | null | undefined): string | null {
  const execution = readSessionExecution(session)
  return execution.kind === 'node' ? execution.nodeId : null
}
