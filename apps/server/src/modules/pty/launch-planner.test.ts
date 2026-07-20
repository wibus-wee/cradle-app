import { describe, expect, it } from 'vitest'

import {
  hasCodexPositionalArg,
  planCliTuiLaunch,
  resolveProviderSessionBinding,
} from './launch-planner'

const CODEX_SESSION_ID = '019e3c07-d7df-73d2-a3dc-dfaf5f883050'
const SESSION_ID = 'session-cli-tui'
const WORKSPACE = '/tmp/workspace'

describe('planCliTuiLaunch', () => {
  it('returns live-attach without rewriting argv when the process is already running', () => {
    const plan = planCliTuiLaunch({
      sessionId: SESSION_ID,
      executable: 'claude',
      args: ['--verbose'],
      running: true,
      ptyStartedAt: 1_700_000_000,
      workspacePath: WORKSPACE,
    })

    expect(plan).toMatchObject({
      mode: 'live-attach',
      agent: 'claude',
      args: ['--verbose'],
      needsCapture: false,
    })
  })

  it('starts Claude with --session-id and resumes with --resume after ptyStartedAt', () => {
    const fresh = planCliTuiLaunch({
      sessionId: SESSION_ID,
      executable: 'claude',
      args: [],
      running: false,
      ptyStartedAt: null,
      workspacePath: WORKSPACE,
      harnessSystemPrompt: 'workflow',
    })
    expect(fresh.mode).toBe('fresh')
    expect(fresh.args).toEqual([
      '--session-id',
      SESSION_ID,
      '--append-system-prompt',
      'workflow',
    ])

    const resume = planCliTuiLaunch({
      sessionId: SESSION_ID,
      executable: 'claude',
      args: [],
      running: false,
      ptyStartedAt: 1_700_000_000,
      workspacePath: WORKSPACE,
    })
    expect(resume.mode).toBe('resume')
    expect(resume.args).toEqual(['--resume', SESSION_ID])
  })

  it('resumes Codex from providerSession and falls back to legacy codexCliSession', () => {
    const fromProvider = planCliTuiLaunch({
      sessionId: SESSION_ID,
      executable: 'codex',
      args: ['--model', 'gpt-5.1-codex'],
      running: false,
      ptyStartedAt: 1_700_000_000,
      workspacePath: WORKSPACE,
      providerSession: {
        source: 'cradle:codex',
        agent: 'codex',
        kind: 'id',
        value: CODEX_SESSION_ID,
        workspacePath: WORKSPACE,
        capturedAt: 1_700_000_100,
        startedAt: 1_700_000_000,
        confidence: 'exact',
      },
    })
    expect(fromProvider.mode).toBe('resume')
    expect(fromProvider.args).toEqual([
      '--model',
      'gpt-5.1-codex',
      'resume',
      CODEX_SESSION_ID,
    ])
    expect(fromProvider.needsCapture).toBe(false)

    const fromLegacy = planCliTuiLaunch({
      sessionId: SESSION_ID,
      executable: 'codex',
      args: [],
      running: false,
      ptyStartedAt: 1_700_000_000,
      workspacePath: WORKSPACE,
      codexCliSession: {
        sessionId: CODEX_SESSION_ID,
        capturedAt: 1_700_000_100,
        startedAt: 1_700_000_000,
        workspacePath: WORKSPACE,
        sourcePath: '/tmp/rollout.jsonl',
      },
    })
    expect(fromLegacy.mode).toBe('resume')
    expect(fromLegacy.args).toEqual(['resume', CODEX_SESSION_ID])
  })

  it('does not resume Codex when workspace mismatches and schedules capture', () => {
    const plan = planCliTuiLaunch({
      sessionId: SESSION_ID,
      executable: 'codex',
      args: [],
      running: false,
      ptyStartedAt: null,
      workspacePath: WORKSPACE,
      codexCliSession: {
        sessionId: CODEX_SESSION_ID,
        capturedAt: 1_700_000_100,
        startedAt: 1_700_000_000,
        workspacePath: '/tmp/other',
        sourcePath: '/tmp/rollout.jsonl',
      },
    })

    expect(plan.mode).toBe('fresh')
    expect(plan.args).toEqual([])
    expect(plan.needsCapture).toBe(true)
    expect(plan.captureDriver).toBe('codex-filesystem')
  })

  it('skips Codex auto-resume/capture when positional args already select a command', () => {
    const plan = planCliTuiLaunch({
      sessionId: SESSION_ID,
      executable: 'codex',
      args: ['exec', 'do something'],
      running: false,
      ptyStartedAt: null,
      workspacePath: WORKSPACE,
      providerSession: {
        source: 'cradle:codex',
        agent: 'codex',
        kind: 'id',
        value: CODEX_SESSION_ID,
        workspacePath: WORKSPACE,
        capturedAt: 1_700_000_100,
        startedAt: 1_700_000_000,
        confidence: 'exact',
      },
    })

    expect(plan.mode).toBe('fresh')
    expect(plan.args).toEqual(['exec', 'do something'])
    expect(plan.needsCapture).toBe(false)
  })
})

describe('resolveProviderSessionBinding', () => {
  it('prefers providerSession and rejects workspace mismatches', () => {
    expect(resolveProviderSessionBinding({
      providerSession: {
        source: 'cradle:codex',
        agent: 'codex',
        kind: 'id',
        value: CODEX_SESSION_ID,
        workspacePath: WORKSPACE,
        capturedAt: 1,
        startedAt: 1,
        confidence: 'exact',
      },
      workspacePath: WORKSPACE,
    })?.value).toBe(CODEX_SESSION_ID)

    expect(resolveProviderSessionBinding({
      providerSession: {
        source: 'cradle:codex',
        agent: 'codex',
        kind: 'id',
        value: CODEX_SESSION_ID,
        workspacePath: '/tmp/other',
        capturedAt: 1,
        startedAt: 1,
        confidence: 'exact',
      },
      workspacePath: WORKSPACE,
    })).toBeNull()
  })
})

describe('hasCodexPositionalArg', () => {
  it('treats value-taking flags as non-positional', () => {
    expect(hasCodexPositionalArg(['--model', 'gpt-5.1-codex'])).toBe(false)
    expect(hasCodexPositionalArg(['resume', CODEX_SESSION_ID])).toBe(true)
    expect(hasCodexPositionalArg(['--', 'prompt'])).toBe(true)
  })
})

describe('bound provider resume matrix', () => {
  it.each([
    ['opencode', 'opencode', ['--session', CODEX_SESSION_ID]],
    ['cursor-agent', 'cursor', ['--resume', CODEX_SESSION_ID]],
    ['gemini', 'gemini', ['--resume', CODEX_SESSION_ID]],
    ['pi', 'pi', ['--session', CODEX_SESSION_ID]],
    ['omp', 'omp', [`--resume=${CODEX_SESSION_ID}`]],
    ['droid', 'droid', ['--resume', CODEX_SESSION_ID]],
    ['grok', 'grok', ['--resume', CODEX_SESSION_ID]],
    ['copilot', 'copilot', [`--resume=${CODEX_SESSION_ID}`]],
    ['kilo', 'kilo', ['--session', CODEX_SESSION_ID]],
    ['hermes', 'hermes', ['--resume', CODEX_SESSION_ID]],
  ] as const)('resumes %s from providerSession', (executable, agent, resumeArgs) => {
    const plan = planCliTuiLaunch({
      sessionId: SESSION_ID,
      executable,
      args: [],
      running: false,
      ptyStartedAt: 1_700_000_000,
      workspacePath: WORKSPACE,
      providerSession: {
        source: `cradle:${agent}`,
        agent,
        kind: 'id',
        value: CODEX_SESSION_ID,
        workspacePath: WORKSPACE,
        capturedAt: 1_700_000_100,
        startedAt: 1_700_000_000,
        confidence: 'exact',
      },
    })

    expect(plan.mode).toBe('resume')
    expect(plan.agent).toBe(agent)
    expect(plan.args).toEqual(resumeArgs)
  })
})
