import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { anthropicScenario, anthropicTextExchange, anthropicToolUseExchange } from '../scenarios/anthropic'
import type { CradleWorld } from '../world'

const TITLE_PROMPT = 'You are naming a Claude Agent task session'
const FIXTURE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../../fixtures/plugins/personal-panel')

export const PERSONAL_PLUGIN_INSTALL_PROMPT = '请创建并安装个人 Plugin'
export const PERSONAL_PLUGIN_FAILED_UPDATE_PROMPT = '请验证个人 Plugin 更新失败时保留旧版本'
export const PERSONAL_PLUGIN_SUCCESSFUL_UPDATE_PROMPT = '请将个人 Plugin 更新到 v2'
const INSTALL_SUCCESS_MARKER = 'CRADLE_E2E_PERSONAL_PLUGIN_INSTALL_OK'
const UPDATE_SUCCESS_MARKER = 'CRADLE_E2E_PERSONAL_PLUGIN_UPDATE_OK'

function shellQuote(value: string): string {
  return `'${value.replaceAll('\'', `'\\''`)}'`
}

function sourceIdCommand(): string {
  return 'source_id="$(node "$plugin_dir/resolve-source-id.mjs" "$CRADLE_SERVER_URL" "$plugin_dir")"'
}

export async function configurePersonalPluginLifecycleSimulator(world: CradleWorld): Promise<void> {
  await world.configureClaudeAgentChat({ mode: 'text' })
  const simulator = await world.ensureSimulator()
  simulator.reset()

  const installToolId = 'toolu_e2e_personal_plugin_install'
  const failedUpdateToolId = 'toolu_e2e_personal_plugin_failed_update'
  const successfulUpdateToolId = 'toolu_e2e_personal_plugin_successful_update'
  world.enqueue(anthropicScenario([
    anthropicToolUseExchange({
      label: 'personal-plugin-install',
      toolUseId: installToolId,
      toolName: 'Bash',
      toolInput: {
        command: [
          'set -eu',
          'plugin_dir="$CRADLE_WORKSPACE_PATH/e2e-personal-plugin"',
          'mkdir -p "$plugin_dir"',
          `cp -R ${shellQuote(`${FIXTURE_DIR}/`)}. "$plugin_dir"`,
          'cradle plugin install --package-dir "$plugin_dir" --label "E2E personal Plugin"',
          `printf '%s\\n' ${INSTALL_SUCCESS_MARKER}`,
        ].join('\n'),
        description: 'Create, build, and install the personal Plugin snapshot',
      },
      bodyTextIncludes: PERSONAL_PLUGIN_INSTALL_PROMPT,
      bodyTextExcludes: TITLE_PROMPT,
    }),
    anthropicTextExchange({
      label: 'personal-plugin-install-final',
      text: '个人 Plugin 已构建并安装，正在原会话等待权限审查。',
      bodyTextIncludes: [
        installToolId,
        INSTALL_SUCCESS_MARKER,
      ],
      bodyTextExcludes: TITLE_PROMPT,
    }),
    anthropicToolUseExchange({
      label: 'personal-plugin-failed-update',
      toolUseId: failedUpdateToolId,
      toolName: 'Bash',
      toolInput: {
        command: [
          'set -eu',
          'plugin_dir="$CRADLE_WORKSPACE_PATH/e2e-personal-plugin"',
          sourceIdCommand(),
          'printf "%s\\n" broken > "$plugin_dir/version.txt"',
          'cradle plugin update "$source_id" --package-dir "$plugin_dir"',
        ].join('\n'),
        description: 'Attempt an invalid personal Plugin update',
      },
      bodyTextIncludes: PERSONAL_PLUGIN_FAILED_UPDATE_PROMPT,
      bodyTextExcludes: TITLE_PROMPT,
    }),
    anthropicTextExchange({
      label: 'personal-plugin-failed-update-final',
      text: '无效更新被拒绝，已安装的 v1 快照保持可用。',
      bodyTextIncludes: [
        failedUpdateToolId,
        'Unsupported E2E personal Plugin version: broken',
      ],
      bodyTextExcludes: TITLE_PROMPT,
    }),
    anthropicToolUseExchange({
      label: 'personal-plugin-successful-update',
      toolUseId: successfulUpdateToolId,
      toolName: 'Bash',
      toolInput: {
        command: [
          'set -eu',
          'plugin_dir="$CRADLE_WORKSPACE_PATH/e2e-personal-plugin"',
          sourceIdCommand(),
          'printf "%s\\n" v2 > "$plugin_dir/version.txt"',
          'cradle plugin update "$source_id" --package-dir "$plugin_dir"',
          `printf '%s\\n' ${UPDATE_SUCCESS_MARKER}`,
        ].join('\n'),
        description: 'Build and publish personal Plugin revision v2',
      },
      bodyTextIncludes: PERSONAL_PLUGIN_SUCCESSFUL_UPDATE_PROMPT,
      bodyTextExcludes: TITLE_PROMPT,
    }),
    anthropicTextExchange({
      label: 'personal-plugin-successful-update-final',
      text: '个人 Plugin v2 已发布为新快照，正在原会话等待重新审查。',
      bodyTextIncludes: [
        successfulUpdateToolId,
        UPDATE_SUCCESS_MARKER,
      ],
      bodyTextExcludes: TITLE_PROMPT,
    }),
  ]))
}
