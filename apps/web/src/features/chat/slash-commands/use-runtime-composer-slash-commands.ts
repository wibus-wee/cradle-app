import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'

import type { RuntimeKind } from '~/features/agent-runtime/types'
import type { RuntimeCatalogComposer } from '~/features/agent-runtime/use-runtime-catalog'
import { runtimeComposerSupportsSlashCommands } from '~/features/agent-runtime/use-runtime-catalog'

import { draftRuntimeCapabilitiesQueryKey, getDraftChatRuntimeCapabilities } from '../capabilities/chat-capabilities'
import type { ChatComposerSlashCommand } from './chat-slash-commands'
import {
  projectRuntimeComposerSlashCommands,
} from './chat-slash-commands'

const EMPTY_CRADLE_COMMANDS: ChatComposerSlashCommand[] = []

export function useRuntimeComposerSlashCommands(
  runtimeKind: RuntimeKind | string | null | undefined,
  runtimeComposer: RuntimeCatalogComposer,
  cradleCommands: ChatComposerSlashCommand[] = EMPTY_CRADLE_COMMANDS,
): ChatComposerSlashCommand[] {
  const supportsRuntimeSlashCommands = runtimeComposerSupportsSlashCommands(runtimeComposer)
  const { data: draftCapabilities } = useQuery({
    queryKey: draftRuntimeCapabilitiesQueryKey(runtimeKind),
    queryFn: ({ signal }) => getDraftChatRuntimeCapabilities(runtimeKind!, signal),
    enabled: Boolean(runtimeKind) && supportsRuntimeSlashCommands,
    staleTime: 60_000,
    retry: false,
  })

  return useMemo(() => {
    return projectRuntimeComposerSlashCommands({
      capabilities: draftCapabilities,
      mode: 'draft',
      cradleCommands,
    })
  }, [cradleCommands, draftCapabilities])
}
