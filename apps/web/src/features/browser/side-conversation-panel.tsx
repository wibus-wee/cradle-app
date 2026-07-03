import {
  CloseCircleLine as XCircleIcon,
  RobotLine as BotIcon,
} from '@mingcute/react'
import { useQuery } from '@tanstack/react-query'
import type { FileUIPart } from 'ai'
import { useCallback, useState } from 'react'

import { getSessionsByIdOptions } from '~/api-gen/@tanstack/react-query.gen'
import { getSkills } from '~/api-gen/sdk.gen'
import { Alert, AlertDescription, AlertTitle } from '~/components/ui/alert'
import { ChatRenderStoreProvider, MessageBubbleById } from '~/features/chat/rendering/message-bubble'
import type { SkillInventoryEntry } from '~/features/skills/types'
import { chatSelectors } from '~/store/chat'
import { useRendererChatStore } from '~/store/renderer-chat'

import { Composer } from '../chat/composer/composer'
import type { ChatContextPart } from '../chat/context/chat-context-parts'
import type { MentionItem } from '../chat/mentions/mention-panel'
import { searchPluginMentions } from '../chat/mentions/plugin-mentions'
import type { SkillMentionItem } from '../chat/mentions/skill-mention-panel'
import { searchWorkspaceFiles } from '../workspace/use-workspace-files'
import { buildSideConversationViewId, submitSideConversationMessage } from './side-conversation-message'

const rendererChatStore = useRendererChatStore

interface SideConversationPanelProps {
  sideConversationId: string
  parentSessionId: string
  title: string
}

export function SideConversationPanel({
  sideConversationId,
  parentSessionId,
  title: _title,
}: SideConversationPanelProps) {
  const viewSessionId = buildSideConversationViewId(sideConversationId)
  const messages = useRendererChatStore(chatSelectors.messages(viewSessionId))
  const latestError = useRendererChatStore(chatSelectors.latestError(viewSessionId))
  const isStreaming = useRendererChatStore(chatSelectors.isSessionGenerating(viewSessionId))
  const [error, setError] = useState<string | null>(null)
  const errorMessage = error ?? latestError?.message ?? null

  // The side conversation inherits its model, provider and runtime settings from the
  // parent session at creation time, so the composer deliberately omits the model
  // selector and permission/plan controls — those follow the main session. We only
  // need the parent's workspace to power @file and $skill mentions.
  const { data: parentWorkspaceId } = useQuery({
    ...getSessionsByIdOptions({ path: { id: parentSessionId } }),
    enabled: Boolean(parentSessionId),
    select: session => session?.workspaceId ?? null,
    staleTime: 60_000,
  })

  const searchFiles = useCallback(async (query: string, signal?: AbortSignal): Promise<MentionItem[]> => {
    if (!parentWorkspaceId) {
      return []
    }
    return searchWorkspaceFiles({ workspaceId: parentWorkspaceId, query, limit: 30, signal })
  }, [parentWorkspaceId])

  const searchSkills = useCallback(async (_query: string, signal?: AbortSignal): Promise<SkillMentionItem[]> => {
    const { data } = await getSkills({
      query: { workspaceId: parentWorkspaceId ?? undefined },
      signal,
    })
    const activeSkills: SkillMentionItem[] = []
    for (const skill of (data ?? []) as SkillInventoryEntry[]) {
      if (!skill.active) {
        continue
      }
      activeSkills.push({
        name: skill.name,
        description: skill.description,
        scope: skill.scope,
        location: skill.location,
        skillDir: skill.skillDir,
      })
    }
    return activeSkills
  }, [parentWorkspaceId])

  const handleSubmit = useCallback(async (text: string, files: FileUIPart[], contextParts: ChatContextPart[]) => {
    const trimmed = text.trim()
    if (!trimmed && files.length === 0 && contextParts.length === 0) {
      return false
    }
    setError(null)
    try {
      await submitSideConversationMessage({ sideConversationId, text, files, contextParts })
      return true
    }
    catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Side response failed')
      return false
    }
  }, [sideConversationId])

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden" data-testid="side-conversation-panel">

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {messages.length > 0
? (
          <div className="space-y-3">
            {messages.map(message => (
              <SideConversationMessage key={message.id} viewSessionId={viewSessionId} messageId={message.id} />
            ))}
          </div>
        )
: (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground/60">
            <BotIcon className="size-8 opacity-40" />
            <p className="text-[11px]">Side conversation</p>
          </div>
        )}
      </div>

      {errorMessage && (
        <Alert
          variant="destructive"
          className="mx-3 mb-2 w-auto rounded-md border-destructive/20 bg-destructive/5 px-2 py-1.5 text-xs"
          data-testid="side-conversation-error-banner"
        >
          <XCircleIcon className="size-3.5" />
          <AlertTitle className="text-xs">Side response failed</AlertTitle>
          <AlertDescription className="max-h-24 overflow-y-auto break-words text-[11px]">
            {errorMessage}
          </AlertDescription>
        </Alert>
      )}

      <div className="shrink-0 border-t border-border/50 bg-card p-2">
        <Composer
          send={{
            submit: handleSubmit,
            // No `stop`/`isStreaming`: side conversations have no server cancel
            // endpoint, so we gate sending instead of offering a stop button.
            sendDisabled: isStreaming,
          }}
          view={{
            placeholder: 'Message',
            searchFiles,
            searchPlugins: searchPluginMentions,
            searchSkills,
            textareaRows: 2,
            sessionId: viewSessionId,
            className: 'relative',
            cardClassName:
              'overflow-hidden rounded-md border border-border/60 bg-background shadow-none focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/15',
            textareaClassName:
              'min-h-9 max-h-48 px-2.5 py-2 text-xs placeholder:text-muted-foreground/60',
            actionBarClassName: 'px-1.5 py-1.5',
            sendButtonClassName: 'ml-0.5',
          }}
          accessibility={{
            textareaAriaLabel: 'Side conversation message',
            sendButtonAriaLabel: 'Send side message',
          }}
        />
      </div>
    </div>
  )
}

function SideConversationMessage({
  viewSessionId,
  messageId,
}: {
  viewSessionId: string
  messageId: string
}) {
  return (
    <ChatRenderStoreProvider store={rendererChatStore}>
      <MessageBubbleById
        sessionId={viewSessionId}
        messageId={messageId}
      />
    </ChatRenderStoreProvider>
  )
}
