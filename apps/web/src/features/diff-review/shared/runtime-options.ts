import { useMemo } from 'react'

import type { RuntimeKind } from '~/features/agent-runtime/types'
import {
  runtimeCatalogItemRequiresProviderTarget,
  useRuntimeCatalog,
} from '~/features/agent-runtime/use-runtime-catalog'
import type { RuntimeKindOption } from '~/features/composer-toolbar/constants'

export function useProviderBackedDiffRuntimeSelection(runtimeOptions: RuntimeKindOption[]) {
  const { runtimes } = useRuntimeCatalog()

  const runtimeKindSet = useMemo(() => {
    const values = new Set<RuntimeKind>()
    for (const runtime of runtimes) {
      if (runtime.surfaces.includes('chat') && runtimeCatalogItemRequiresProviderTarget(runtime)) {
        values.add(runtime.runtimeKind)
      }
    }
    return values
  }, [runtimes])

  const filteredRuntimeOptions = useMemo(
    () => runtimeOptions.filter(option => runtimeKindSet.has(option.value)),
    [runtimeKindSet, runtimeOptions],
  )

  return {
    runtimeKindSet,
    runtimeOptions: filteredRuntimeOptions,
  }
}
