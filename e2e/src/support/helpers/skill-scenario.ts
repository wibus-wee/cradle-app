import { anthropicTextExchange } from '../scenarios/anthropic'
import type { CradleWorld } from '../world'

export const WORKSPACE_SKILL_NAME = 'release-verdict'
export const WORKSPACE_SKILL_DESCRIPTION = 'Apply the workspace release verdict policy.'
export const WORKSPACE_SKILL_SENTINEL = 'CRADLE_SKILL_RELEASE_VERDICT_7F3A'
export const WORKSPACE_SKILL_PROMPT = '请使用选中的发布判断 Skill 回答'
export const WORKSPACE_SKILL_REPLY = '已通过 Workspace Skill 完成发布判断'

export async function configureWorkspaceSkillSimulator(world: CradleWorld): Promise<void> {
  await world.configureClaudeAgentChat({ text: WORKSPACE_SKILL_REPLY })
  world.simulator?.reset()
  world.enqueueAnthropic(anthropicTextExchange({
    label: 'workspace-skill-invocation',
    text: WORKSPACE_SKILL_REPLY,
    bodyTextIncludes: [WORKSPACE_SKILL_PROMPT, WORKSPACE_SKILL_SENTINEL],
  }))
}
