import {
  ClockwiseLine as RestartIcon,
  ServerLine as ServerIcon,
} from '@mingcute/react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge } from '~/components/ui/badge'
import { Input } from '~/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '~/components/ui/select'
import { Spinner } from '~/components/ui/spinner'
import { SettingsGroup } from '~/features/settings/settings-container'
import { SettingsRow } from '~/features/settings/settings-row'
import type {
  NetworkInboundAccessMode,
  NetworkInboundPreferences,
  NetworkRelaySource,
} from '~/features/settings/use-network-preferences'
import { useNetworkPreferences } from '~/features/settings/use-network-preferences'

import { useFabricMembership, useUpdateFabricRelayUrl } from './use-nodes'

const ACCESS_OPTIONS: Array<{ value: NetworkInboundAccessMode, labelKey: 'settings.fabric.access.local' | 'settings.fabric.access.network' }> = [
  { value: 'local', labelKey: 'settings.fabric.access.local' },
  { value: 'network', labelKey: 'settings.fabric.access.network' },
]
const SOURCE_OPTIONS: Array<{ value: NetworkRelaySource, labelKey: 'settings.fabric.source.thisComputer' | 'settings.fabric.source.external' }> = [
  { value: 'managed', labelKey: 'settings.fabric.source.thisComputer' },
  { value: 'external', labelKey: 'settings.fabric.source.external' },
]

function normalizeFabricUrl(value: string): string | null {
  const raw = value.trim()
  if (!raw) {
    return null
  }
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`
  try {
    const url = new URL(withScheme)
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) {
      return null
    }
    return url.toString().replace(/\/$/, '')
  }
  catch {
    return null
  }
}

/** Fabric connection settings owned by the Devices surface. */
export function FabricSettingsGroup() {
  const { t } = useTranslation('nodes')
  const { prefs, isLoading, savePrefs, isSaving } = useNetworkPreferences()
  const membershipQuery = useFabricMembership()
  const updateFabricRelayUrl = useUpdateFabricRelayUrl()
  const [externalUrlDraft, setExternalUrlDraft] = useState('')
  const [externalUrlError, setExternalUrlError] = useState(false)
  const [publicUrlDraft, setPublicUrlDraft] = useState('')
  const [publicUrlError, setPublicUrlError] = useState(false)
  const [memberRelayUrlDraft, setMemberRelayUrlDraft] = useState('')
  const [memberRelayUrlError, setMemberRelayUrlError] = useState(false)

  useEffect(() => {
    setExternalUrlDraft(prefs?.inbound.relayUrl ?? '')
    setExternalUrlError(false)
  }, [prefs?.inbound.relayUrl])

  useEffect(() => {
    setPublicUrlDraft(prefs?.inbound.managedRelayPublicUrl ?? '')
    setPublicUrlError(false)
  }, [prefs?.inbound.managedRelayPublicUrl])

  useEffect(() => {
    setMemberRelayUrlDraft(membershipQuery.data?.relayUrl ?? '')
    setMemberRelayUrlError(false)
  }, [membershipQuery.data?.relayUrl])

  const saveInboundPreference = (updates: Partial<NetworkInboundPreferences>) => {
    if (!prefs) {
      return
    }
    void savePrefs({ inbound: { ...prefs.inbound, ...updates } })
  }

  const saveUrl = (value: string, kind: 'external' | 'public') => {
    const normalized = normalizeFabricUrl(value)
    if (value.trim() && !normalized) {
      if (kind === 'external') {
        setExternalUrlError(true)
      }
      else {
        setPublicUrlError(true)
      }
      return
    }
    if (kind === 'external') {
      setExternalUrlError(false)
      saveInboundPreference({ relayUrl: normalized })
    }
    else {
      setPublicUrlError(false)
      saveInboundPreference({ managedRelayPublicUrl: normalized })
    }
  }

  const saveMemberRelayUrl = (value: string) => {
    const normalized = normalizeFabricUrl(value)
    if (!normalized) {
      setMemberRelayUrlError(true)
      return
    }
    setMemberRelayUrlError(false)
    updateFabricRelayUrl.mutate({ body: { relayUrl: normalized } }, {
      onError: () => setMemberRelayUrlError(true),
    })
  }

  const disabled = !prefs || isSaving

  return (
    <SettingsGroup
      label={t('settings.fabric.title')}
      description={t('settings.fabric.description')}
    >
      {isLoading || !prefs
        ? (
          <div className="flex items-center gap-2 py-3 text-xs text-muted-foreground">
            <Spinner className="size-3.5" />
            {t('settings.loading')}
          </div>
        )
        : (
          <>
            {membershipQuery.data && (
              <SettingsRow
                label={t('settings.fabric.memberRelay.label')}
                description={memberRelayUrlError
                  ? t('settings.fabric.memberRelay.invalid')
                  : t('settings.fabric.memberRelay.description')}
                vertical
              >
                <Input
                  value={memberRelayUrlDraft}
                  onChange={(event) => {
                    setMemberRelayUrlDraft(event.target.value)
                    setMemberRelayUrlError(false)
                  }}
                  onBlur={() => saveMemberRelayUrl(memberRelayUrlDraft)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.currentTarget.blur()
                    }
                  }}
                  disabled={updateFabricRelayUrl.isPending}
                  placeholder="http://100.64.0.1:8787"
                  aria-invalid={memberRelayUrlError ? true : undefined}
                  aria-label={t('settings.fabric.memberRelay.label')}
                />
              </SettingsRow>
            )}
            <SettingsRow
              label={t('settings.fabric.source.label')}
              description={t('settings.fabric.source.description')}
            >
              <Select
                value={prefs.inbound.relaySource}
                onValueChange={value => saveInboundPreference({ relaySource: value as NetworkRelaySource })}
                disabled={disabled}
              >
                <SelectTrigger size="sm" className="w-[180px]" aria-label={t('settings.fabric.source.label')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SOURCE_OPTIONS.map(option => (
                    <SelectItem key={option.value} value={option.value}>
                      {t(option.labelKey)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </SettingsRow>

            {prefs.inbound.relaySource === 'external' && (
              <SettingsRow
                label={t('settings.fabric.external.label')}
                description={externalUrlError
                  ? t('settings.fabric.external.invalid')
                  : t('settings.fabric.external.description')}
                vertical
              >
                <Input
                  value={externalUrlDraft}
                  onChange={(event) => {
                    setExternalUrlDraft(event.target.value)
                    setExternalUrlError(false)
                  }}
                  onBlur={() => saveUrl(externalUrlDraft, 'external')}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.currentTarget.blur()
                    }
                  }}
                  disabled={disabled}
                  placeholder="https://fabric.example.com"
                  aria-invalid={externalUrlError ? true : undefined}
                  aria-label={t('settings.fabric.external.label')}
                />
              </SettingsRow>
            )}

            {prefs.inbound.relaySource === 'managed' && (
              <>
                <SettingsRow
                  label={t('settings.fabric.access.label')}
                  description={t('settings.fabric.access.description')}
                >
                  <Select
                    value={prefs.inbound.managedRelayAccessMode}
                    onValueChange={value => saveInboundPreference({ managedRelayAccessMode: value as NetworkInboundAccessMode })}
                    disabled={disabled}
                  >
                    <SelectTrigger size="sm" className="w-[180px]" aria-label={t('settings.fabric.access.label')}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ACCESS_OPTIONS.map(option => (
                        <SelectItem key={option.value} value={option.value}>
                          {t(option.labelKey)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </SettingsRow>

                <SettingsRow
                  label={t('settings.fabric.public.label')}
                  description={publicUrlError
                    ? t('settings.fabric.public.invalid')
                    : t('settings.fabric.public.description')}
                  vertical
                >
                  <Input
                    value={publicUrlDraft}
                    onChange={(event) => {
                      setPublicUrlDraft(event.target.value)
                      setPublicUrlError(false)
                    }}
                    onBlur={() => saveUrl(publicUrlDraft, 'public')}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.currentTarget.blur()
                      }
                    }}
                    disabled={disabled}
                    placeholder="https://fabric.example.com"
                    aria-invalid={publicUrlError ? true : undefined}
                    aria-label={t('settings.fabric.public.label')}
                  />
                </SettingsRow>
              </>
            )}

            <SettingsRow
              label={t('settings.fabric.apply.label')}
              description={t('settings.fabric.apply.description')}
            >
              <Badge variant="outline" className="gap-1.5 text-[11px]">
                <RestartIcon className="size-3" aria-hidden="true" />
                {t('settings.fabric.apply.badge')}
              </Badge>
            </SettingsRow>

            <div className="grid grid-cols-[auto_1fr] gap-2 py-3 text-[12px] leading-5 text-muted-foreground">
              <ServerIcon className="mt-0.5 size-3.5 shrink-0 !text-amber-700 dark:!text-amber-300" aria-hidden="true" />
              <p className="text-pretty">{t('settings.fabric.warning')}</p>
            </div>
          </>
        )}
    </SettingsGroup>
  )
}
