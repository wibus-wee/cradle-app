import type { ReactElement } from 'react'
import { Activity, useLayoutEffect, useMemo, useState } from 'react'
import { shallow } from 'zustand/shallow'

import type { RuntimeKind } from '~/features/agent-runtime/types'
import type { SendMessageOptions } from '~/features/chat/session/use-chat-session'
import { cn } from '~/lib/utils'
import { SurfaceActivityProvider } from '~/navigation/surface-activity-context'
import { chatSelectors, useChatStore } from '~/store/chat'

import { ChatRuntimeView } from '../chat-runtime-view'
import { ChatSessionSyncBoundary } from './chat-session-sync-boundary'

type ChatStoreSnapshot = ReturnType<typeof useChatStore.getState>

export interface ChatSessionFrameDescriptor {
  sessionId: string
  sessionProviderTargetId: string | null
  sessionModelId: string | null
  sessionThinkingEffort: SendMessageOptions['thinkingEffort'] | null
  runtimeKind: RuntimeKind | undefined
  workspaceId: string | null
  agentId: string | null
}

export function ChatSessionFrameHost({
  activeSession,
  active,
}: {
  activeSession: ChatSessionFrameDescriptor
  active: boolean
}): ReactElement {
  const [retainedFrames, setRetainedFrames] = useState<ChatSessionFrameDescriptor[]>(() => [activeSession])
  const candidateFrames = mergeActiveFrame(retainedFrames, activeSession)
  const candidateSessionIds = candidateFrames.map(frame => frame.sessionId)
  const streamingSessionIds = useChatStore(
    (state: ChatStoreSnapshot) => candidateSessionIds.filter(sessionId => chatSelectors.isSessionStreaming(sessionId)(state)),
    shallow,
  )
  const streamingSessionIdSet = useMemo(() => new Set(streamingSessionIds), [streamingSessionIds])
  const frameDescriptors = trimRetainedFrames(candidateFrames, activeSession, streamingSessionIdSet)

  useLayoutEffect(() => {
    setRetainedFrames((currentFrames) => {
      const nextFrames = trimRetainedFrames(
        mergeActiveFrame(currentFrames, activeSession),
        activeSession,
        streamingSessionIdSet,
      )
      return areFrameListsEqual(currentFrames, nextFrames) ? currentFrames : nextFrames
    })
  }, [activeSession, streamingSessionIdSet])

  return (
    <div className="relative h-full w-full min-h-0 min-w-0 overflow-hidden" data-chat-session-frame-host="">
      {frameDescriptors.map(frame => (
        <ChatSessionSyncBoundary
          key={`sync:${frame.sessionId}`}
          sessionId={frame.sessionId}
          active={(active && frame.sessionId === activeSession.sessionId) || streamingSessionIdSet.has(frame.sessionId)}
        />
      ))}
      {frameDescriptors.map((frame) => {
        const visible = active && frame.sessionId === activeSession.sessionId
        return (
          <Activity
            key={frame.sessionId}
            name={`chat-session:${frame.sessionId}`}
            mode={visible ? 'visible' : 'hidden'}
          >
            <ChatSessionFrame
              descriptor={frame}
              visible={visible}
            />
          </Activity>
        )
      })}
    </div>
  )
}

const ChatSessionFrame = ({
  descriptor,
  visible,
}: {
  descriptor: ChatSessionFrameDescriptor
  visible: boolean
}) => {
  return (
    <div
      className={cn(
        'absolute inset-0 h-full w-full min-h-0 min-w-0 overflow-hidden',
        visible
          ? 'z-10 pointer-events-auto'
          : 'z-0 pointer-events-none',
      )}
      style={{
        contain: 'layout paint style',
      }}
      aria-hidden={visible ? undefined : 'true'}
      data-chat-session-frame={descriptor.sessionId}
      data-chat-session-visible={visible ? 'true' : 'false'}
    >
      <SurfaceActivityProvider active={visible}>
        <ChatRuntimeView
          active={visible}
          sessionId={descriptor.sessionId}
          sessionProviderTargetId={descriptor.sessionProviderTargetId}
          sessionModelId={descriptor.sessionModelId}
          sessionThinkingEffort={descriptor.sessionThinkingEffort}
          runtimeKind={descriptor.runtimeKind}
          workspaceId={descriptor.workspaceId}
          agentId={descriptor.agentId}
        />
      </SurfaceActivityProvider>
    </div>
  )
}
ChatSessionFrame.displayName = 'ChatSessionFrame'

function mergeActiveFrame(
  currentFrames: ChatSessionFrameDescriptor[],
  activeSession: ChatSessionFrameDescriptor,
): ChatSessionFrameDescriptor[] {
  const nextFrames = [activeSession]

  for (const frame of currentFrames) {
    if (frame.sessionId !== activeSession.sessionId) {
      nextFrames.push(frame)
    }
  }

  return nextFrames
}

function trimRetainedFrames(
  currentFrames: ChatSessionFrameDescriptor[],
  activeSession: ChatSessionFrameDescriptor,
  streamingSessionIds: ReadonlySet<string>,
): ChatSessionFrameDescriptor[] {
  const nextFrames: ChatSessionFrameDescriptor[] = []
  const usedSessionIds = new Set<string>()

  const appendFrame = (frame: ChatSessionFrameDescriptor) => {
    if (usedSessionIds.has(frame.sessionId)) {
      return
    }
    usedSessionIds.add(frame.sessionId)
    nextFrames.push(frame.sessionId === activeSession.sessionId ? activeSession : frame)
  }

  appendFrame(activeSession)

  for (const frame of currentFrames) {
    if (streamingSessionIds.has(frame.sessionId)) {
      appendFrame(frame)
    }
  }

  return nextFrames
}

function areFrameListsEqual(
  currentFrames: ChatSessionFrameDescriptor[],
  nextFrames: ChatSessionFrameDescriptor[],
): boolean {
  if (currentFrames.length !== nextFrames.length) {
    return false
  }

  return currentFrames.every((frame, index) => {
    const nextFrame = nextFrames[index]
    return nextFrame
      && frame.sessionId === nextFrame.sessionId
      && frame.sessionProviderTargetId === nextFrame.sessionProviderTargetId
      && frame.sessionModelId === nextFrame.sessionModelId
      && frame.sessionThinkingEffort === nextFrame.sessionThinkingEffort
      && frame.runtimeKind === nextFrame.runtimeKind
      && frame.workspaceId === nextFrame.workspaceId
      && frame.agentId === nextFrame.agentId
  })
}
