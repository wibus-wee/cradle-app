import { useQuery, useQueryClient } from '@tanstack/react-query'

import {
  getProviderTargetsByProviderTargetIdModelSettingsOptions,
  getProviderTargetsCodexConfigSchemaOptions,
  getProviderTargetsQueryKey,
} from '~/api-gen/@tanstack/react-query.gen'
import { patchProviderTargetsByProviderTargetIdCodexConfig } from '~/api-gen/sdk.gen'
import { Button } from '~/components/ui/button'
import { Spinner } from '~/components/ui/spinner'
import { ProfileConfigJsonSchema } from '~/features/agent-runtime/profile-config-schema'
import { apiErrorMessage } from '~/lib/api-error'
import { useResolvedThemeMode } from '~/store/theme'

import { CodexConfigView } from './codex-config-view'

export function CodexConfigContainer({
  providerTargetId,
  onSaved,
  onSavingChange,
  disabled,
}: {
  providerTargetId: string
  onSaved: (configJson: string) => void
  onSavingChange: (saving: boolean) => void
  disabled?: boolean
}) {
  const queryClient = useQueryClient()
  const mode = useResolvedThemeMode()
  const schema = useQuery(getProviderTargetsCodexConfigSchemaOptions())
  const settings = useQuery(
    getProviderTargetsByProviderTargetIdModelSettingsOptions({ path: { providerTargetId } }),
  )
  if (schema.error || settings.error) {
    return (
      <div role="alert" className="text-xs text-destructive">
        {apiErrorMessage(schema.error ?? settings.error)}
        <Button
          variant="ghost"
          onClick={() => {
            void schema.refetch()
            void settings.refetch()
          }}
        >
          Retry
        </Button>
      </div>
    )
  }
  if (!schema.data || !settings.data) {
    return <Spinner />
  }
  const config = ProfileConfigJsonSchema.parse(settings.data.connectionConfigJson)
  return (
    <CodexConfigView
      key={providerTargetId}
      schema={schema.data}
      initialValue={JSON.stringify(config.codex ?? {}, null, 2)}
      theme={mode === 'dark' ? 'vs-dark' : 'vs'}
      disabled={disabled}
      onSave={async (value) => {
        onSavingChange(true)
        try {
          const { data } = await patchProviderTargetsByProviderTargetIdCodexConfig({
            path: { providerTargetId },
            body: { codex: JSON.parse(value) },
            throwOnError: true,
          })
          queryClient.setQueryData(
            getProviderTargetsByProviderTargetIdModelSettingsOptions({ path: { providerTargetId } })
              .queryKey,
            data,
          )
          await queryClient.invalidateQueries({ queryKey: getProviderTargetsQueryKey() })
          onSaved(data.configJson)
        }
        catch (error) {
          throw new Error(apiErrorMessage(error))
        }
        finally {
          onSavingChange(false)
        }
      }}
    />
  )
}
