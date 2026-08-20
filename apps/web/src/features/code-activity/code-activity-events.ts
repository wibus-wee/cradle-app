import { z } from 'zod'

import { getServerUrl } from '~/lib/electron'
import { openServerEventSource } from '~/lib/server-transport'

const workspaceSchema = z.object({
  id: z.string(),
  name: z.string(),
})

export const CodeActivitySourceEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('ready'),
    sessionId: z.string(),
    workspace: workspaceSchema,
    occurredAt: z.number(),
  }),
  z.object({
    type: z.literal('file-changed'),
    sessionId: z.string(),
    workspace: workspaceSchema,
    file: z.object({ relativePath: z.string() }),
    occurredAt: z.number(),
  }),
])

export function openCodeActivityEvents(sessionId: string) {
  const url = new URL(
    `/code-activity/sessions/${encodeURIComponent(sessionId)}/events`,
    getServerUrl(),
  ).toString()
  return openServerEventSource(url)
}
