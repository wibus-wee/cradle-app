export interface TurnCheckpointHooks {
  captureStart: (input: {
    sessionId: string
    runId: string
    assistantMessageId: string | null
    workspaceId: string | null
    workspacePath: string | null
  }) => Promise<void>
  captureEnd: (input: { sessionId: string, runId: string }) => Promise<void>
}

const EMPTY_HOOKS: TurnCheckpointHooks = {
  captureStart: async () => {},
  captureEnd: async () => {},
}

let hooks = EMPTY_HOOKS

export function registerTurnCheckpointHooks(next: TurnCheckpointHooks): void {
  hooks = next
}

export function captureTurnCheckpointStart(input: Parameters<TurnCheckpointHooks['captureStart']>[0]): Promise<void> {
  return hooks.captureStart(input)
}

export function captureTurnCheckpointEnd(input: Parameters<TurnCheckpointHooks['captureEnd']>[0]): Promise<void> {
  return hooks.captureEnd(input)
}
