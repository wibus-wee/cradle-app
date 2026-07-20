import { basename } from 'node:path'

import type {
  CodexCliSessionBinding,
  ProviderSessionBinding,
} from '../../helpers/agent-runtime-config'

export type CliTuiLaunchMode = 'live-attach' | 'resume' | 'fresh'

export type CliTuiAgent
  = | 'claude'
    | 'codex'
    | 'opencode'
    | 'cursor'
    | 'gemini'
    | 'pi'
    | 'omp'
    | 'droid'
    | 'grok'
    | 'copilot'
    | 'kilo'
    | 'hermes'
    | 'generic'

export interface PlanCliTuiLaunchInput {
  sessionId: string
  executable: string
  args: string[]
  env?: Record<string, string>
  running: boolean
  ptyStartedAt: number | null
  workspacePath: string
  providerSession?: ProviderSessionBinding | null
  /** @deprecated Prefer providerSession; kept for stored session config. */
  codexCliSession?: CodexCliSessionBinding | null
  harnessSystemPrompt?: string | null
}

export interface CliTuiLaunchPlan {
  mode: CliTuiLaunchMode
  executable: string
  args: string[]
  env?: Record<string, string>
  agent: CliTuiAgent
  needsCapture: boolean
  captureDriver?: 'codex-filesystem'
  dedupeKey?: string
}

const CODEX_VALUE_OPTIONS = new Set([
  '-a',
  '-c',
  '-C',
  '-i',
  '-m',
  '-p',
  '-s',
  '--add-dir',
  '--ask-for-approval',
  '--cd',
  '--config',
  '--image',
  '--local-provider',
  '--model',
  '--profile',
  '--remote',
  '--remote-auth-token-env',
  '--sandbox',
])

const OFFICIAL_SOURCES = new Set([
  'cradle:claude',
  'cradle:codex',
  'cradle:opencode',
  'cradle:cursor',
  'cradle:gemini',
  'cradle:pi',
  'cradle:omp',
  'cradle:droid',
  'cradle:grok',
  'cradle:copilot',
  'cradle:kilo',
  'cradle:hermes',
])

export function planCliTuiLaunch(input: PlanCliTuiLaunchInput): CliTuiLaunchPlan {
  const executable = input.executable
  const baseArgs = [...input.args]
  const agent = detectAgent(executable)

  if (input.running) {
    return {
      mode: 'live-attach',
      executable,
      args: baseArgs,
      env: input.env,
      agent,
      needsCapture: false,
    }
  }

  if (agent === 'claude') {
    return planClaudeLaunch(input, baseArgs)
  }

  if (agent === 'codex') {
    return planCodexLaunch(input, baseArgs)
  }

  return planBoundProviderResume(input, baseArgs, agent)
}

export function detectAgent(executable: string): CliTuiAgent {
  const command = executableCommandName(executable)
  if (command === 'claude' || command.startsWith('claude-')) {
    return 'claude'
  }
  if (command === 'codex' || command.startsWith('codex-')) {
    return 'codex'
  }
  if (command === 'opencode' || command.startsWith('opencode-')) {
    return 'opencode'
  }
  if (command === 'cursor-agent' || command === 'cursor' || command.startsWith('cursor-')) {
    return 'cursor'
  }
  if (command === 'gemini' || command.startsWith('gemini-')) {
    return 'gemini'
  }
  if (command === 'pi') {
    return 'pi'
  }
  if (command === 'omp') {
    return 'omp'
  }
  if (command === 'droid' || command.startsWith('droid-')) {
    return 'droid'
  }
  if (command === 'grok' || command.startsWith('grok-')) {
    return 'grok'
  }
  if (command === 'copilot' || command.startsWith('copilot-')) {
    return 'copilot'
  }
  if (command === 'kilo' || command.startsWith('kilo-')) {
    return 'kilo'
  }
  if (command === 'hermes' || command.startsWith('hermes-')) {
    return 'hermes'
  }
  return 'generic'
}

export function resolveProviderSessionBinding(input: {
  providerSession?: ProviderSessionBinding | null
  codexCliSession?: CodexCliSessionBinding | null
  workspacePath: string
  expectedAgent?: CliTuiAgent
}): ProviderSessionBinding | null {
  if (input.providerSession) {
    if (input.providerSession.workspacePath !== input.workspacePath) {
      return null
    }
    if (input.expectedAgent && input.expectedAgent !== 'generic' && input.providerSession.agent !== input.expectedAgent) {
      return null
    }
    return input.providerSession
  }

  const legacy = input.codexCliSession
  if (!legacy || legacy.workspacePath !== input.workspacePath) {
    return null
  }
  if (input.expectedAgent && input.expectedAgent !== 'codex' && input.expectedAgent !== 'generic') {
    return null
  }

  return {
    source: 'cradle:codex',
    agent: 'codex',
    kind: 'id',
    value: legacy.sessionId,
    workspacePath: legacy.workspacePath,
    capturedAt: legacy.capturedAt,
    startedAt: legacy.startedAt,
    sourcePath: legacy.sourcePath,
    confidence: 'exact',
  }
}

export function providerSessionDedupeKey(binding: ProviderSessionBinding): string {
  return `${binding.source}\0${binding.agent}\0${binding.kind}\0${binding.value}`
}

export function isOfficialProviderSource(source: string, agent: string): boolean {
  return OFFICIAL_SOURCES.has(source) && source === `cradle:${agent}`
}

export function hasCodexPositionalArg(args: string[]): boolean {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (!arg) {
      continue
    }
    if (arg === '--') {
      return index < args.length - 1
    }
    if (!arg.startsWith('-')) {
      return true
    }
    if (arg.includes('=')) {
      continue
    }
    if (CODEX_VALUE_OPTIONS.has(arg)) {
      index += 1
    }
  }
  return false
}

export function buildProviderResumeArgs(agent: CliTuiAgent, binding: ProviderSessionBinding): string[] | null {
  if (binding.agent !== agent && !(agent === 'cursor' && binding.agent === 'cursor')) {
    return null
  }

  switch (agent) {
    case 'codex':
      return binding.kind === 'id' ? ['resume', binding.value] : null
    case 'opencode':
    case 'kilo':
      return ['--session', binding.value]
    case 'cursor':
      return ['--resume', binding.value]
    case 'gemini':
    case 'droid':
    case 'grok':
    case 'hermes':
    case 'claude':
      return ['--resume', binding.value]
    case 'pi':
      return ['--session', binding.value]
    case 'omp':
      return [`--resume=${binding.value}`]
    case 'copilot':
      return [`--resume=${binding.value}`]
    default:
      return null
  }
}

function planClaudeLaunch(
  input: PlanCliTuiLaunchInput,
  baseArgs: string[],
): CliTuiLaunchPlan {
  const args = [...baseArgs]
  const mode: CliTuiLaunchMode = input.ptyStartedAt ? 'resume' : 'fresh'

  if (mode === 'resume') {
    args.push('--resume', input.sessionId)
  }
  else {
    args.push('--session-id', input.sessionId)
  }

  if (input.harnessSystemPrompt) {
    args.push('--append-system-prompt', input.harnessSystemPrompt)
  }

  const binding: ProviderSessionBinding = {
    source: 'cradle:claude',
    agent: 'claude',
    kind: 'id',
    value: input.sessionId,
    workspacePath: input.workspacePath,
    capturedAt: Math.floor(Date.now() / 1000),
    startedAt: input.ptyStartedAt ?? Math.floor(Date.now() / 1000),
    confidence: 'exact',
  }

  return {
    mode,
    executable: input.executable,
    args,
    env: input.env,
    agent: 'claude',
    needsCapture: false,
    dedupeKey: providerSessionDedupeKey(binding),
  }
}

function planCodexLaunch(
  input: PlanCliTuiLaunchInput,
  baseArgs: string[],
): CliTuiLaunchPlan {
  const args = [...baseArgs]
  const autoResumeAllowed = !hasCodexPositionalArg(args)
  const binding = resolveProviderSessionBinding({
    providerSession: input.providerSession,
    codexCliSession: input.codexCliSession,
    workspacePath: input.workspacePath,
    expectedAgent: 'codex',
  })
  const canResume = autoResumeAllowed
    && binding?.agent === 'codex'
    && binding.kind === 'id'

  if (canResume && binding) {
    args.push(...(buildProviderResumeArgs('codex', binding) ?? []))
    return {
      mode: 'resume',
      executable: input.executable,
      args,
      env: input.env,
      agent: 'codex',
      needsCapture: false,
      dedupeKey: providerSessionDedupeKey(binding),
    }
  }

  return {
    mode: 'fresh',
    executable: input.executable,
    args,
    env: input.env,
    agent: 'codex',
    needsCapture: autoResumeAllowed,
    captureDriver: autoResumeAllowed ? 'codex-filesystem' : undefined,
  }
}

function planBoundProviderResume(
  input: PlanCliTuiLaunchInput,
  baseArgs: string[],
  agent: CliTuiAgent,
): CliTuiLaunchPlan {
  const binding = resolveProviderSessionBinding({
    providerSession: input.providerSession,
    codexCliSession: input.codexCliSession,
    workspacePath: input.workspacePath,
    expectedAgent: agent,
  })

  if (binding && agent !== 'generic') {
    const resumeArgs = buildProviderResumeArgs(agent, binding)
    if (resumeArgs) {
      return {
        mode: 'resume',
        executable: input.executable,
        args: [...baseArgs, ...resumeArgs],
        env: input.env,
        agent,
        needsCapture: false,
        dedupeKey: providerSessionDedupeKey(binding),
      }
    }
  }

  return {
    mode: 'fresh',
    executable: input.executable,
    args: baseArgs,
    env: input.env,
    agent,
    needsCapture: false,
  }
}

function executableCommandName(executablePath: string): string {
  return basename(executablePath).replace(/\.(cmd|exe|ps1|bat)$/i, '')
}
