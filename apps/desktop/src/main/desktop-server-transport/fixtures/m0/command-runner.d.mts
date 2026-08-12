export interface CommandOutcome {
  pid: number | null
  code: number | null
  signal: NodeJS.Signals | 'SIGKILL' | null
  timedOut: boolean
  startedAt: string
  settledAt: string
  elapsedMs: number
  stdout: string
  stderr: string
}

export interface CommandOptions {
  cwd?: string
  env?: NodeJS.ProcessEnv
  timeoutMs?: number
  terminationGraceMs?: number
  forceSettleMs?: number
  forwardOutput?: boolean
}

export function runCommand(command: string, args: string[], options?: CommandOptions): Promise<CommandOutcome>
