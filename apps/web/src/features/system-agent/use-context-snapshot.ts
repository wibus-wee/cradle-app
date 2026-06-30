import type { ContextEnvelope } from '~/features/context/context-items'
import { rendererContextRegistry } from '~/features/context/context-registry'

export function collectContextEnvelope(): ContextEnvelope {
  return rendererContextRegistry.collectEnvelope()
}
