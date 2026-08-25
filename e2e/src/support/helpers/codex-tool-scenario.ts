import type { SimulatorExchange } from '@cradle/model-api-simulator'

import { openAiFunctionCallExchange, openAiTextExchange } from '../scenarios/openai'
import type { CradleWorld } from '../world'

export const CODEX_EXEC_CALL_ID = 'call_e2e_codex_exec'
export const CODEX_PLAN_CALL_ID = 'call_e2e_codex_plan'
export const CODEX_PATCH_CALL_ID = 'call_e2e_codex_patch'
export const CODEX_APPROVAL_CALL_ID = 'call_e2e_codex_approval'

/** Printed by the scripted exec_command so the continuation exchange can match on it. */
export const CODEX_COMMAND_OUTPUT_MARKER = 'cradle-e2e-command-output'
export const CODEX_PATCH_FILE_NAME = 'e2e-codex-file-change.txt'
export const CODEX_PATCH_FILE_CONTENT = 'created by the cradle e2e codex file change scenario'
export const CODEX_FINAL_TEXT = 'Codex 工具轮已完成'

function requireSimulator(world: CradleWorld) {
  if (!world.simulator) {
    throw new Error('Expected simulator to be configured')
  }
  return world.simulator
}

/**
 * A scripted tool-call turn plus its post-tool continuation turn. The real Codex
 * app-server executes the function call locally and replays the conversation —
 * including the `function_call_output` — so matching the follow-up on the call id
 * keeps the FIFO queue race-free.
 */
export function codexToolTurnExchanges(input: {
  label: string
  callId: string
  toolName: string
  argumentsJson: string
  finalText?: string
  continuationBodyTextExcludes?: string | readonly string[]
}): SimulatorExchange[] {
  return [
    openAiFunctionCallExchange({
      label: input.label,
      callId: input.callId,
      toolName: input.toolName,
      argumentsJson: input.argumentsJson,
    }),
    openAiTextExchange({
      label: `${input.label}-continuation`,
      text: input.finalText ?? CODEX_FINAL_TEXT,
      bodyTextIncludes: input.callId,
      bodyTextExcludes: input.continuationBodyTextExcludes,
    }),
  ]
}

function enqueueCodexToolTurn(
  world: CradleWorld,
  input: Parameters<typeof codexToolTurnExchanges>[0],
): void {
  requireSimulator(world).reset()
  for (const exchange of codexToolTurnExchanges(input)) {
    world.enqueueOpenAi(exchange)
  }
}

/** Real app-server shell round-trip: exec_command → commandExecution item → terminal tool UI. */
export async function configureCodexCommandExecutionSimulator(world: CradleWorld): Promise<void> {
  console.warn('[step] configure Codex exec_command simulator')
  await world.configureCodexChat()
  enqueueCodexToolTurn(world, {
    label: 'codex-exec-command',
    callId: CODEX_EXEC_CALL_ID,
    toolName: 'exec_command',
    argumentsJson: JSON.stringify({
      cmd: `echo ${CODEX_COMMAND_OUTPUT_MARKER}`,
      yield_time_ms: 1000,
    }),
  })
}

/** update_plan function call → plan item notifications → canonical plan tool UI. */
export async function configureCodexPlanUpdateSimulator(world: CradleWorld): Promise<void> {
  console.warn('[step] configure Codex update_plan simulator')
  await world.configureCodexChat()
  enqueueCodexToolTurn(world, {
    label: 'codex-update-plan',
    callId: CODEX_PLAN_CALL_ID,
    toolName: 'update_plan',
    argumentsJson: JSON.stringify({
      explanation: 'E2E 两步计划',
      plan: [
        { step: '扫描模块', status: 'completed' },
        { step: '输出结论', status: 'in_progress' },
      ],
    }),
  })
}

/**
 * apply_patch run through the shell tool → native fileChange items → canonical
 * file-diff tool UI. The patch writes inside the workspace so workspace-write
 * sandboxing never escalates to an approval.
 */
export async function configureCodexFileChangeSimulator(world: CradleWorld): Promise<void> {
  console.warn('[step] configure Codex apply_patch simulator')
  await world.configureCodexChat()
  const patch = [
    '*** Begin Patch',
    `*** Add File: ${CODEX_PATCH_FILE_NAME}`,
    `+${CODEX_PATCH_FILE_CONTENT}`,
    '*** End Patch',
  ].join('\n')
  enqueueCodexToolTurn(world, {
    label: 'codex-apply-patch',
    callId: CODEX_PATCH_CALL_ID,
    toolName: 'exec_command',
    argumentsJson: JSON.stringify({
      cmd: `apply_patch <<'EOF'\n${patch}\nEOF`,
      yield_time_ms: 1000,
    }),
  })
}

/**
 * A write outside the sandboxed workspace forces the real approval round-trip:
 * the tool call requests escalation (`sandbox_permissions: "require_escalated"`,
 * exactly how real models ask), the app-server surfaces
 * `item/commandExecution/requestApproval`, Cradle renders the approval card,
 * and Allow resumes execution.
 */
export async function configureCodexApprovalSimulator(world: CradleWorld): Promise<void> {
  console.warn('[step] configure Codex approval simulator')
  await world.configureCodexChat()
  enqueueCodexToolTurn(world, {
    label: 'codex-approval-command',
    callId: CODEX_APPROVAL_CALL_ID,
    toolName: 'exec_command',
    argumentsJson: JSON.stringify({
      cmd: `echo ${CODEX_COMMAND_OUTPUT_MARKER} > "$HOME/cradle-e2e-approval-probe"`,
      yield_time_ms: 1000,
      justification: 'E2E 需要在沙盒外写入探针文件',
      sandbox_permissions: 'require_escalated',
    }),
    // The command string itself contains the output marker. Requiring the
    // continuation not to contain the native failure envelope ensures this is
    // an actual allow-and-execute round trip, not a failed tool call followed
    // by a superficially successful scripted response.
    continuationBodyTextExcludes: 'exec_command failed',
  })
}
