import { postTerminalSessionsBySessionIdStartOrAttach } from '~/api-gen'

export function startOrAttachTerminalSession(
  sessionId: string,
  dimensions: { cols: number, rows: number },
) {
  return postTerminalSessionsBySessionIdStartOrAttach({
    path: { sessionId },
    body: dimensions,
  })
}
