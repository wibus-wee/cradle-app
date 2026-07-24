import type { ChatPluginContextMessagePart } from '../../context/chat-context-parts'
import { readPluginContextLabel, readPluginContextPart } from '../../context/chat-context-parts'
import { PluginMentionIcon } from '../../mentions/plugin-mention-icon'

export interface PluginContextViewProps { part: ChatPluginContextMessagePart }

export function PluginContextView({ part }: PluginContextViewProps) {
  const plugin = readPluginContextPart(part)
  return plugin
? (
<span className="mx-0.5 inline-flex items-center gap-0.5 align-baseline text-[0.8125em] font-medium text-sky-600 dark:text-sky-400">
<PluginMentionIcon iconUrl={plugin.iconUrl} className="size-3" />
@
{readPluginContextLabel(plugin)}
</span>
)
: null
}
