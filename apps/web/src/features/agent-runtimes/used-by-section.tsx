import { AddLine as PlusIcon, RobotLine as BotIcon } from '@mingcute/react'
import { useTranslation } from 'react-i18next'

import { Button } from '~/components/ui/button'
import { buildAvatarUrl } from '~/features/agent-runtime/avatar-url'
import type { Agent } from '~/features/agent-runtime/use-agents'
import { useSettingsOverlayStore } from '~/store/settings-overlay'

/**
 * Cross-link from the Runtimes page into Agent Management: records the pending
 * create-agent intent (runtime kind + optional ACP binding) and switches the
 * settings overlay to the Agents section, where `agent-list.tsx` consumes it.
 */
export function useCreateAgentCrossLink() {
  const setAgentCreateIntent = useSettingsOverlayStore(state => state.setAgentCreateIntent)
  const setSettingsSection = useSettingsOverlayStore(state => state.setSettingsSection)

  return (runtimeKind: string, acpAgentId?: string) => {
    setAgentCreateIntent({ runtimeKind, acpAgentId })
    setSettingsSection('agents')
  }
}

export function UsedBySection({ agents }: { agents: Agent[] }) {
  const { t } = useTranslation('runtimes')

  if (agents.length === 0) {
    return null
  }

  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-[13px] font-medium text-foreground">{t('detail.usedBy.title')}</h3>
      <div className="flex flex-col">
        {agents.map((agent) => {
          const avatarUrl = agent.avatarUrl || buildAvatarUrl(agent.avatarStyle, agent.avatarSeed)
          return (
            <div key={agent.id} className="flex items-center gap-2.5 py-1.5">
              {avatarUrl
                ? <img src={avatarUrl} alt="" className="size-5 rounded-full" />
                : (
                    <span className="flex size-5 items-center justify-center rounded-full bg-fill">
                      <BotIcon className="size-3 text-text-tertiary" aria-hidden="true" />
                    </span>
                  )}
              <span className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground">
                {agent.name}
              </span>
            </div>
          )
        })}
      </div>
    </section>
  )
}

export function CreateAgentButton({
  runtimeKind,
  acpAgentId,
}: {
  runtimeKind: string
  acpAgentId?: string
}) {
  const { t } = useTranslation('runtimes')
  const createAgent = useCreateAgentCrossLink()

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => createAgent(runtimeKind, acpAgentId)}
      data-testid="runtime-create-agent"
    >
      <PlusIcon />
      {t('detail.action.createAgent')}
    </Button>
  )
}
