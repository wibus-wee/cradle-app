import {
  createRemoteAgentError,
  REMOTE_AGENT_PROTOCOL_VERSION,
  type RemoteAgentFrame,
} from '@cradle/remote-agent-protocol'

import type { AgentdDaemon } from './daemon'

export type RemoteAgentFrameSender = (frame: RemoteAgentFrame) => void | Promise<void>

export function invalidRemoteAgentFrame(details: unknown): RemoteAgentFrame {
  return {
    protocolVersion: REMOTE_AGENT_PROTOCOL_VERSION,
    kind: 'notification',
    method: 'protocol/error',
    params: createRemoteAgentError('invalid_frame', 'Invalid remote agent frame', String(details)),
  }
}

export async function dispatchRemoteAgentFrame(
  daemon: AgentdDaemon,
  frame: RemoteAgentFrame,
  send: RemoteAgentFrameSender,
): Promise<void> {
  try {
    if (frame.kind === 'rpc.request') {
      const result = await daemon.handleUnary(frame.method, frame.params)
      await send({
        protocolVersion: REMOTE_AGENT_PROTOCOL_VERSION,
        kind: 'rpc.response',
        id: frame.id,
        result,
      })
      return
    }

    if (frame.kind === 'stream.open') {
      for await (const value of daemon.handleStream(frame.method, frame.params)) {
        await send({
          protocolVersion: REMOTE_AGENT_PROTOCOL_VERSION,
          kind: 'stream.next',
          streamId: frame.streamId,
          value,
        })
      }
      await send({
        protocolVersion: REMOTE_AGENT_PROTOCOL_VERSION,
        kind: 'stream.close',
        streamId: frame.streamId,
      })
    }
  }
  catch (error) {
    const payload = createRemoteAgentError(
      'request_failed',
      error instanceof Error ? error.message : String(error),
    )
    if (frame.kind === 'rpc.request') {
      await send({
        protocolVersion: REMOTE_AGENT_PROTOCOL_VERSION,
        kind: 'rpc.error',
        id: frame.id,
        error: payload,
      })
      return
    }
    if (frame.kind === 'stream.open') {
      await send({
        protocolVersion: REMOTE_AGENT_PROTOCOL_VERSION,
        kind: 'stream.error',
        streamId: frame.streamId,
        error: payload,
      })
    }
  }
}
