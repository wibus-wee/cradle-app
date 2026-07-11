import type { Elysia } from 'elysia'
import { t } from 'elysia'
import { z } from 'zod'

import { createUnauthorizedError, verifyWebSocketRequestToken } from '../../http/auth'
import {
  closeSyncSocket,
  handleSyncSocketMessage,
  openSyncSocket,
} from './connection'
import { SyncClientFrameSchema } from './protocol'

const SyncSocketMessageSchema = z.preprocess((message) => {
  if (typeof message === 'string') {
    return JSON.parse(message)
  }
  if (message instanceof Uint8Array) {
    return JSON.parse(new TextDecoder().decode(message))
  }
  return message
}, SyncClientFrameSchema)

export function registerSyncGatewayRoutes(app: Elysia): Elysia {
  app.ws('/sync', {
    detail: { summary: 'Multiplexed realtime sync channel', tags: ['sync'] },
    body: t.Any(),
    beforeHandle({ request }) {
      if (!verifyWebSocketRequestToken(request, { audience: '/sync' })) {
        throw createUnauthorizedError()
      }
    },
    open(ws) {
      openSyncSocket(ws)
    },
    message(ws, message) {
      try {
        const frame = SyncSocketMessageSchema.parse(message)
        handleSyncSocketMessage(ws, frame)
      }
      catch {
        // Ignore invalid client frames.
      }
    },
    close(ws) {
      closeSyncSocket(ws)
    },
  })
  return app
}
