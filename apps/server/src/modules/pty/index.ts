import type { Elysia } from 'elysia'
import { z } from 'zod'

import { createUnauthorizedError, verifyWebSocketRequestToken } from '../../http/auth'
import { PtyModel } from './model'
import * as Pty from './service'

function rejectUnauthorizedSocketRequest(request: Request): void {
  const audience = new URL(request.url).pathname
  if (!verifyWebSocketRequestToken(request, { audience })) {
    throw createUnauthorizedError()
  }
}

const SocketClientEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('input'),
    data: z.string(),
  }),
  z.object({
    type: z.literal('resize'),
    cols: z.number().int().positive(),
    rows: z.number().int().positive(),
  }),
  z.object({
    type: z.literal('ping'),
  }),
])

const SocketMessageSchema = z.union([
  z.string().transform(raw => JSON.parse(raw)),
  z.unknown(),
]).pipe(SocketClientEventSchema)

export function registerPtyRoutes(app: Elysia): Elysia {
  app
    .get(
      '/terminal-sessions/resources',
      () => {
        return Pty.listResources()
      },
      {
        detail: { summary: 'List terminal resource usage', tags: ['pty'] },
        response: { 200: PtyModel.resourcesResponse },
      },
    )
    .post(
      '/terminal-sessions/:sessionId/start-or-attach',
      ({ params, body }) => {
        return Pty.startOrAttach({ sessionId: params.sessionId, cols: body.cols, rows: body.rows })
      },
      {
        detail: { summary: 'Start or attach terminal session', tags: ['pty'] },
        params: PtyModel.sessionIdParams,
        body: PtyModel.startOrAttachBody,
        response: { 200: PtyModel.startOrAttachResponse },
      },
    )
    .ws('/terminal-sessions/:sessionId/socket', {
      detail: { summary: 'Open chat terminal live channel via WebSocket', tags: ['pty'] },
      params: PtyModel.sessionIdParams,
      query: PtyModel.liveChannelQuery,
      body: PtyModel.clientEvent,
      response: PtyModel.serverEvent,
      parse: (_ws, message) => SocketMessageSchema.parse(message),
      beforeHandle({ request }) {
        rejectUnauthorizedSocketRequest(request)
      },
      open(ws) {
        try {
          Pty.openChatSocket({
            sessionId: ws.data.params.sessionId,
            fromSeq: ws.data.query.fromSeq,
            ws,
          })
        }
 catch (error) {
          Pty.rejectSocket(ws, error)
        }
      },
      message(ws, message) {
        Pty.handleSocketMessage(ws, message)
      },
      close(ws) {
        Pty.closeSocket(ws)
      },
    })
    .delete(
      '/terminal-sessions/:sessionId',
      ({ params }) => {
        Pty.stop(params.sessionId)
        return { ok: true as const }
      },
      {
        detail: { summary: 'Stop terminal session', tags: ['pty'] },
        params: PtyModel.sessionIdParams,
        response: { 200: PtyModel.okResponse },
      },
    )
    .get(
      '/terminal-sessions/:sessionId/host',
      ({ params }) => {
        return Pty.getHost(params.sessionId)
      },
      {
        detail: { summary: 'Get CLI TUI host snapshot and restore state', tags: ['pty'] },
        params: PtyModel.sessionIdParams,
        response: { 200: PtyModel.hostResponse },
      },
    )
    .get(
      '/terminal-sessions/:sessionId/provider-session',
      ({ params }) => {
        return Pty.getProviderSession(params.sessionId)
      },
      {
        detail: { summary: 'Get provider session binding for CLI TUI resume', tags: ['pty'] },
        params: PtyModel.sessionIdParams,
        response: { 200: PtyModel.providerSessionResponse },
      },
    )
    .post(
      '/terminal-sessions/:sessionId/provider-session',
      ({ params, body }) => {
        return Pty.reportProviderSession({
          sessionId: params.sessionId,
          source: body.source,
          agent: body.agent,
          kind: body.kind,
          value: body.value,
          sourcePath: body.sourcePath,
          confidence: body.confidence,
        })
      },
      {
        detail: { summary: 'Report provider session binding for CLI TUI resume', tags: ['pty'] },
        params: PtyModel.sessionIdParams,
        body: PtyModel.providerSessionBody,
        response: { 200: PtyModel.providerSessionResponse },
      },
    )
    .delete(
      '/terminal-sessions/:sessionId/provider-session',
      ({ params }) => {
        return Pty.clearProviderSession(params.sessionId)
      },
      {
        detail: { summary: 'Clear provider session binding for CLI TUI resume', tags: ['pty'] },
        params: PtyModel.sessionIdParams,
        response: { 200: PtyModel.providerSessionResponse },
      },
    )
    .post(
      '/terminal-sessions/shell/start',
      ({ body }) => {
        return Pty.startShell({
          ptyId: body.ptyId,
          cwd: body.cwd,
          cols: body.cols,
          rows: body.rows,
        })
      },
      {
        detail: { summary: 'Start or attach a generic shell', tags: ['pty'] },
        body: PtyModel.startShellBody,
        response: { 200: PtyModel.startShellResponse },
      },
    )
    .ws('/terminal-sessions/shell/:ptyId/socket', {
      detail: { summary: 'Open shell PTY live channel via WebSocket', tags: ['pty'] },
      params: PtyModel.ptyIdParams,
      query: PtyModel.liveChannelQuery,
      body: PtyModel.clientEvent,
      response: PtyModel.serverEvent,
      parse: (_ws, message) => SocketMessageSchema.parse(message),
      beforeHandle({ request }) {
        rejectUnauthorizedSocketRequest(request)
      },
      open(ws) {
        try {
          Pty.openShellSocket({
            ptyId: ws.data.params.ptyId,
            fromSeq: ws.data.query.fromSeq,
            ws,
          })
        }
 catch (error) {
          Pty.rejectSocket(ws, error)
        }
      },
      message(ws, message) {
        Pty.handleSocketMessage(ws, message)
      },
      close(ws) {
        Pty.closeSocket(ws)
      },
    })
    .delete(
      '/terminal-sessions/shell/:ptyId',
      ({ params }) => {
        Pty.shellStop(params.ptyId)
        return { ok: true as const }
      },
      {
        detail: { summary: 'Stop shell session', tags: ['pty'] },
        params: PtyModel.ptyIdParams,
        response: { 200: PtyModel.okResponse },
      },
    )

  app.onStop(() => {
    Pty.shutdownPtyModule()
  })

  return app
}
