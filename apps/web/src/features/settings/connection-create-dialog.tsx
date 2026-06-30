// Create-connection dialog. Replaces the old Checkbox-as-radio secret mode
// picker with a ToggleGroup, and segments the Slack credential rows into a
// labelled SettingsGroup instead of one undifferentiated muted block.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  getSecrets,
  postConversationBridgeConnections,
  postSecrets,
} from '~/api-gen/sdk.gen'
import { Button } from '~/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '~/components/ui/dialog'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '~/components/ui/select'
import { Spinner } from '~/components/ui/spinner'
import { Switch } from '~/components/ui/switch'
import { toastManager } from '~/components/ui/toast'
import { ToggleGroup, ToggleGroupItem } from '~/components/ui/toggle-group'
import { cn } from '~/lib/cn'

import type { Adapter, Secret } from './integrations-primitives'
import { queryKeys } from './integrations-primitives'
import { SettingsGroup } from './settings-container'

type SecretMode = 'select' | 'create'

interface SecretFieldState {
  mode: SecretMode
  selectedId: string
  newValue: string
  newLabel: string
}

function useSecretField(initial: SecretMode = 'create') {
  const [state, setState] = useState<SecretFieldState>({
    mode: initial,
    selectedId: '',
    newValue: '',
    newLabel: '',
  })
  const set = (patch: Partial<SecretFieldState>) => setState(prev => ({ ...prev, ...patch }))
  return [state, set] as const
}

function SecretFieldEditor({
  field,
  set,
  label,
  placeholder,
  description,
  secrets,
  secretKind,
}: {
  field: SecretFieldState
  set: (patch: Partial<SecretFieldState>) => void
  label: string
  placeholder: string
  description: string
  secrets: Secret[]
  secretKind: 'slack-bot-token' | 'slack-app-token' | 'slack-signing-secret'
}) {
  const { t } = useTranslation('settings')

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <Label className="text-xs">{label}</Label>
        <ToggleGroup
          type="single"
          value={field.mode}
          onValueChange={value => value && set({ mode: value as SecretMode })}
          variant="outline"
          size="sm"
        >
          <ToggleGroupItem value="select" className="h-6 px-2 text-[11px]">
            {t('integrations.slack.secret.selectExisting')}
          </ToggleGroupItem>
          <ToggleGroupItem value="create" className="h-6 px-2 text-[11px]">
            {t('integrations.slack.secret.createNew')}
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
      {field.mode === 'select'
? (
        <Select value={field.selectedId} onValueChange={id => set({ selectedId: id })}>
          <SelectTrigger className="h-8 text-xs">
            <SelectValue placeholder={t('integrations.slack.secret.selectExisting')} />
          </SelectTrigger>
          <SelectContent>
            {secrets
              .filter(s => s.kind === secretKind)
              .map(secret => (
                <SelectItem key={secret.id} value={secret.id} className="text-xs">
                  {secret.label}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
      )
: (
        <div className="space-y-2">
          <Input
            value={field.newLabel}
            onChange={e => set({ newLabel: e.target.value })}
            placeholder={t('integrations.slack.secret.labelPlaceholder')}
            className="h-8 text-xs"
          />
          <Input
            value={field.newValue}
            onChange={e => set({ newValue: e.target.value })}
            placeholder={placeholder}
            type="password"
            className="h-8 text-xs"
          />
        </div>
      )}
      <p className="text-[11px] text-muted-foreground">{description}</p>
    </div>
  )
}

export function CreateConnectionDialog({
  open,
  onOpenChange,
  adapters,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  adapters: Adapter[]
  onCreated: () => void
}) {
  const { t } = useTranslation('settings')
  const queryClient = useQueryClient()

  const secretsQuery = useQuery({
    queryKey: queryKeys.secrets,
    queryFn: async () => {
      const { data, error } = await getSecrets()
      if (error) { throw new Error(String(error)) }
      return data ?? []
    },
  })
  const secrets = useMemo(() => secretsQuery.data ?? [], [secretsQuery.data])

  const [selectedAdapterId, setSelectedAdapterId] = useState<string>('')
  const [displayName, setDisplayName] = useState('')
  const [enabled, setEnabled] = useState(true)

  const [botToken, setBotToken] = useSecretField('create')
  const [appToken, setAppToken] = useSecretField('create')
  const [signingSecret, setSigningSecret] = useSecretField('create')
  const [logLevel, setLogLevel] = useState<'debug' | 'info' | 'warn' | 'error'>('info')

  const selectedAdapter = useMemo(() => adapters.find(a => a.id === selectedAdapterId), [adapters, selectedAdapterId])
  const isSlack = selectedAdapter?.platform === 'slack'

  const resetForm = () => {
    setSelectedAdapterId('')
    setDisplayName('')
    setEnabled(true)
    setBotToken({ mode: 'create', selectedId: '', newValue: '', newLabel: '' })
    setAppToken({ mode: 'create', selectedId: '', newValue: '', newLabel: '' })
    setSigningSecret({ mode: 'create', selectedId: '', newValue: '', newLabel: '' })
    setLogLevel('info')
  }

  const resolveSecretId = async (field: SecretFieldState, kind: 'slack-bot-token' | 'slack-app-token' | 'slack-signing-secret'): Promise<string | null> => {
    if (field.mode === 'select') { return field.selectedId || null }
    if (!field.newValue || !field.newLabel) { return null }
    const { data, error } = await postSecrets({ body: { kind, label: field.newLabel, secret: field.newValue } })
    if (error) { throw new Error(String(error)) }
    return data?.id ?? null
  }

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!selectedAdapter) { throw new Error('No adapter selected') }

      const secretRefs: Record<string, string> = {}
      if (isSlack) {
        const botId = await resolveSecretId(botToken, 'slack-bot-token')
        const appId = await resolveSecretId(appToken, 'slack-app-token')
        const signingId = await resolveSecretId(signingSecret, 'slack-signing-secret')
        if (botId) { secretRefs.botToken = botId }
        if (appId) { secretRefs.appToken = appId }
        if (signingId) { secretRefs.signingSecret = signingId }
      }

      const { data, error } = await postConversationBridgeConnections({
        body: {
          platform: selectedAdapter.platform,
          adapterOwner: selectedAdapter.owner,
          adapterId: selectedAdapter.id,
          displayName,
          enabled,
          secretRefs: Object.keys(secretRefs).length > 0 ? secretRefs : undefined,
          config: isSlack ? { logLevel } : undefined,
        },
      })
      if (error) { throw new Error(String(error)) }
      return data
    },
    onSuccess: () => {
      toastManager.add({ type: 'success', title: t('integrations.connection.toast.created') })
      void queryClient.invalidateQueries({ queryKey: queryKeys.connections })
      void queryClient.invalidateQueries({ queryKey: queryKeys.secrets })
      resetForm()
      onCreated()
    },
    onError: () => {
      toastManager.add({ type: 'error', title: t('integrations.connection.toast.createFailed') })
    },
  })

  const isSlackFormValid
    = ((botToken.mode === 'create' && botToken.newValue && botToken.newLabel) || (botToken.mode === 'select' && botToken.selectedId))
      && ((appToken.mode === 'create' && appToken.newValue && appToken.newLabel) || (appToken.mode === 'select' && appToken.selectedId))
      && ((signingSecret.mode === 'create' && signingSecret.newValue && signingSecret.newLabel) || (signingSecret.mode === 'select' && signingSecret.selectedId))

  const isFormValid = Boolean(selectedAdapter && displayName && (isSlack ? isSlackFormValid : true))

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) { resetForm() }
        onOpenChange(next)
      }}
    >
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('integrations.connection.create')}</DialogTitle>
          <DialogDescription>{t('integrations.categories.connections.description')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          <SettingsGroup label={t('integrations.connection.configTitle')} bare className="[&>*+*]:border-t [&>*+*]:border-border/60">
            <div className="space-y-2 p-4">
              <Label htmlFor="adapter" className="text-xs">{t('integrations.connection.adapter')}</Label>
              <Select value={selectedAdapterId} onValueChange={setSelectedAdapterId}>
                <SelectTrigger id="adapter" className="h-8 text-xs">
                  <SelectValue placeholder={t('integrations.connection.adapter')} />
                </SelectTrigger>
                <SelectContent>
                  {adapters.map(adapter => (
                    <SelectItem key={`${adapter.owner}-${adapter.id}`} value={adapter.id} className="text-xs">
                      {adapter.label}
{' '}
(
{adapter.platform}
)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 p-4">
              <Label htmlFor="displayName" className="text-xs">{t('integrations.connection.displayName')}</Label>
              <Input
                id="displayName"
                value={displayName}
                onChange={e => setDisplayName(e.target.value)}
                placeholder={t('integrations.connection.displayNamePlaceholder')}
                className="h-8 text-xs"
              />
            </div>
            <div className="flex items-center justify-between gap-4 p-4">
              <div className="space-y-1">
                <Label className="text-xs">{t('integrations.connection.enabled')}</Label>
                <p className="text-[11px] text-muted-foreground">{t('integrations.connection.enabledDescription')}</p>
              </div>
              <Switch checked={enabled} onCheckedChange={setEnabled} size="sm" />
            </div>
          </SettingsGroup>

          {isSlack && (
            <SettingsGroup label={t('integrations.slack.title')} description={t('integrations.slack.description')} bare className="[&>*+*]:border-t [&>*+*]:border-border/60">
              <div className="space-y-4 p-4">
                <SecretFieldEditor
                  field={botToken}
                  set={setBotToken}
                  label={t('integrations.slack.botToken')}
                  placeholder={t('integrations.slack.botTokenPlaceholder')}
                  description={t('integrations.slack.botTokenDescription')}
                  secrets={secrets}
                  secretKind="slack-bot-token"
                />
                <SecretFieldEditor
                  field={appToken}
                  set={setAppToken}
                  label={t('integrations.slack.appToken')}
                  placeholder={t('integrations.slack.appTokenPlaceholder')}
                  description={t('integrations.slack.appTokenDescription')}
                  secrets={secrets}
                  secretKind="slack-app-token"
                />
                <SecretFieldEditor
                  field={signingSecret}
                  set={setSigningSecret}
                  label={t('integrations.slack.signingSecret')}
                  placeholder={t('integrations.slack.signingSecretPlaceholder')}
                  description={t('integrations.slack.signingSecretDescription')}
                  secrets={secrets}
                  secretKind="slack-signing-secret"
                />
                <div className="space-y-2">
                  <Label htmlFor="logLevel" className="text-xs">{t('integrations.slack.logLevel')}</Label>
                  <Select value={logLevel} onValueChange={v => setLogLevel(v as typeof logLevel)}>
                    <SelectTrigger id="logLevel" className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="debug" className="text-xs">{t('integrations.slack.logLevelDebug')}</SelectItem>
                      <SelectItem value="info" className="text-xs">{t('integrations.slack.logLevelInfo')}</SelectItem>
                      <SelectItem value="warn" className="text-xs">{t('integrations.slack.logLevelWarn')}</SelectItem>
                      <SelectItem value="error" className="text-xs">{t('integrations.slack.logLevelError')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </SettingsGroup>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} className="h-7 text-xs">
            {t('registry.action.cancel')}
          </Button>
          <Button
            size="sm"
            onClick={() => createMutation.mutate()}
            disabled={!isFormValid || createMutation.isPending}
            className="h-7 text-xs"
          >
            {createMutation.isPending && <Spinner className={cn('size-3.5 mr-1')} />}
            {t('integrations.connection.create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
