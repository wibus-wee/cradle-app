import type { SimulatorExchange } from '@cradle/model-api-simulator'

import { anthropicTextExchange, anthropicToolUseExchange } from './anthropic'

const EXCLUDE_TITLE = 'You are naming a Claude Agent task session'

export const ARTIFACT_E2E_ID = 'e2e-release-readiness'
export const ARTIFACT_E2E_TITLE = 'E2E Release Readiness'
export const ARTIFACT_E2E_PROMPT = '请创建并更新发布检查 Artifact'

const REVISION_ONE_SOURCE = `
import { Artifact, Header, Metrics } from 'cradle/artifact'

export default function ReleaseReadiness() {
  return (
    <Artifact>
      <Header eyebrow="E2E Artifact" title="Release Readiness" summary="Initial review" />
      <Metrics items={[{ label: 'Checks', value: '3 of 5', caption: 'complete' }]} />
    </Artifact>
  )
}
`.trim()

const REVISION_TWO_SOURCE = `
import { Artifact, Header, Metrics } from 'cradle/artifact'

export default function ReleaseReadiness() {
  return (
    <Artifact>
      <Header eyebrow="E2E Artifact" title="Release Readiness" summary="Ready after review" />
      <Metrics items={[{ label: 'Checks', value: '5 of 5', caption: 'complete' }]} />
    </Artifact>
  )
}
`.trim()

/** Create and revise one persisted Artifact through two real Claude Agent tool turns. */
export function claudeAgentArtifactLifecycleExchanges(): SimulatorExchange[] {
  const createToolUseId = 'toolu_e2e_artifact_create'
  const updateToolUseId = 'toolu_e2e_artifact_update'

  return [
    anthropicToolUseExchange({
      label: 'artifact-create',
      toolUseId: createToolUseId,
      toolName: 'mcp__cradle__write_artifact',
      toolInput: {
        artifactId: ARTIFACT_E2E_ID,
        title: ARTIFACT_E2E_TITLE,
        source: REVISION_ONE_SOURCE,
      },
      bodyTextIncludes: ARTIFACT_E2E_PROMPT,
      bodyTextExcludes: EXCLUDE_TITLE,
    }),
    anthropicToolUseExchange({
      label: 'artifact-update',
      toolUseId: updateToolUseId,
      toolName: 'mcp__cradle__write_artifact',
      toolInput: {
        artifactId: ARTIFACT_E2E_ID,
        title: ARTIFACT_E2E_TITLE,
        source: REVISION_TWO_SOURCE,
      },
      bodyTextIncludes: createToolUseId,
      bodyTextExcludes: EXCLUDE_TITLE,
    }),
    anthropicTextExchange({
      label: 'artifact-final',
      text: 'Artifact 已更新到 revision 2 并可在侧边面板查看',
      bodyTextIncludes: updateToolUseId,
      bodyTextExcludes: EXCLUDE_TITLE,
    }),
  ]
}
