import type { ProviderThreadEvent } from '../../chat-runtime/runtime-provider-types'
import { KimiEventToChunkMapper } from './event-to-chunk-mapper'
import type { KimiSessionEvent } from './websocket/client'

export function getKimiEventAgentId(event: KimiSessionEvent): string | null {
  return event.payload.agentId ?? event.agent_id ?? null
}

export class KimiProviderThreadEventProjector {
  private readonly mappers = new Map<string, KimiEventToChunkMapper>()

  project(event: KimiSessionEvent): ProviderThreadEvent | null {
    const providerThreadId = getKimiEventAgentId(event)
    if (!providerThreadId || providerThreadId === 'main') {
      return null
    }
    let mapper = this.mappers.get(providerThreadId)
    if (!mapper) {
      mapper = new KimiEventToChunkMapper()
      this.mappers.set(providerThreadId, mapper)
    }
    const chunks = mapper.map(event)
    if (chunks.length === 0) {
      return null
    }
    return {
      providerThreadId,
      providerTurnId: 'turnId' in event.payload ? String(event.payload.turnId) : null,
      notification: event,
      chunks,
    }
  }
}
