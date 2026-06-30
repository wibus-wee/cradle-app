import { Refresh1Line as RefreshIcon, WifiLine as WifiIcon } from '@mingcute/react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '~/components/ui/select'
import { Spinner } from '~/components/ui/spinner'
import { Switch } from '~/components/ui/switch'

import { SettingsGroup } from './settings-container'
import { SettingsRow } from './settings-row'
import type { NetworkPreferences, NetworkProxyMode, NetworkProxyStatus } from './use-network-preferences'
import { useNetworkPreferences } from './use-network-preferences'

type SettingsKey = keyof typeof import('~/locales/default').default.settings

const PROXY_MODE_OPTIONS: Array<{ value: NetworkProxyMode, labelKey: SettingsKey }> = [
  { value: 'system', labelKey: 'network.mode.system.label' },
  { value: 'custom', labelKey: 'network.mode.custom.label' },
  { value: 'environment', labelKey: 'network.mode.environment.label' },
]

function normalizeProxyUrl(value: string): string | null {
  const raw = value.trim()
  if (!raw) {
    return null
  }
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`
  try {
    const url = new URL(withScheme)
    if (!['http:', 'https:', 'socks:', 'socks5:'].includes(url.protocol) || !url.hostname) {
      return null
    }
    return url.toString()
  }
  catch {
    return null
  }
}

function statusBadgeLabel(status: NetworkProxyStatus | null, t: (key: SettingsKey) => string): string {
  if (!status) {
    return t('network.status.loading')
  }
  if (!status.enabled) {
    return t('network.status.off')
  }
  if (status.source === 'none') {
    return t('network.status.direct')
  }
  if (status.source === 'system') {
    return t('network.status.system')
  }
  if (status.source === 'custom') {
    return t('network.status.custom')
  }
  return t('network.status.environment')
}

function statusDescription(
  status: NetworkProxyStatus | null,
  t: (key: SettingsKey) => string,
  formatProxyUrl: (url: string) => string,
): string {
  if (!status) {
    return t('network.status.loadingDescription')
  }
  if (status.proxyUrl) {
    return formatProxyUrl(status.proxyUrl)
  }
  if (!status.enabled) {
    return t('network.status.offDescription')
  }
  const reason = status.reason ?? 'direct'
  if (reason.startsWith('systemProxyReadFailed:')) {
    return t('network.status.reason.systemProxyReadFailed')
  }
  const reasonKey = `network.status.reason.${reason}` as SettingsKey
  return t(reasonKey)
}

/**
 * Compact outbound-proxy settings, embedded inside the Network settings page.
 * One grouped card: enable toggle, source dropdown, conditional custom URL,
 * and the resolved route status — Apple-density, no per-option prose.
 */
export function ProxySettingsGroup() {
  const { t } = useTranslation('settings')
  const {
    prefs,
    status,
    isLoading,
    isStatusLoading,
    savePrefs,
    isSaving,
    refetchStatus,
  } = useNetworkPreferences()
  const [customProxyDraft, setCustomProxyDraft] = useState('')
  const [customProxyError, setCustomProxyError] = useState<string | null>(null)

  useEffect(() => {
    setCustomProxyDraft(prefs?.customProxyUrl ?? '')
    setCustomProxyError(null)
  }, [prefs?.customProxyUrl])

  const statusLabel = useMemo(() => statusBadgeLabel(status, t), [status, t])
  const currentStatusDescription = useMemo(
    () => statusDescription(status, t, url => t('network.status.proxyUrl', { url })),
    [status, t],
  )

  const savePreference = (updates: Partial<NetworkPreferences>) => {
    if (!prefs) {
      return
    }
    void savePrefs(updates)
  }

  const saveCustomProxyDraft = () => {
    if (!prefs) {
      return
    }
    const trimmed = customProxyDraft.trim()
    if (!trimmed) {
      setCustomProxyError(null)
      void savePrefs({ customProxyUrl: null })
      return
    }
    const normalized = normalizeProxyUrl(trimmed)
    if (!normalized) {
      setCustomProxyError(t('network.custom.error.invalid' as SettingsKey))
      return
    }
    setCustomProxyError(null)
    setCustomProxyDraft(normalized)
    void savePrefs({ customProxyUrl: normalized })
  }

  const disabled = !prefs || isSaving
  const modeDisabled = disabled || !prefs?.proxyEnabled
  const customDisabled = modeDisabled || prefs?.proxyMode !== 'custom'

  return (
    <SettingsGroup>
      {isLoading || !prefs
        ? (
          <div className="flex items-center gap-2 px-4 py-3 text-xs text-muted-foreground">
            <Spinner className="size-3.5" />
            {t('network.loading' as SettingsKey)}
          </div>
        )
        : (
          <>
            <SettingsRow
              label={t('network.enabled.label' as SettingsKey)}
              description={t('network.enabled.description' as SettingsKey)}
            >
              <Switch
                size="sm"
                checked={prefs.proxyEnabled}
                disabled={disabled}
                onCheckedChange={proxyEnabled => savePreference({ proxyEnabled })}
                aria-label={t('network.enabled.label' as SettingsKey)}
              />
            </SettingsRow>

            <SettingsRow label={t('network.mode.label' as SettingsKey)}>
              <Select
                value={prefs.proxyMode}
                onValueChange={value => savePreference({ proxyMode: value as NetworkProxyMode })}
                disabled={modeDisabled}
              >
                <SelectTrigger size="sm" className="w-[200px]" aria-label={t('network.mode.label' as SettingsKey)}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROXY_MODE_OPTIONS.map(option => (
                    <SelectItem key={option.value} value={option.value}>
                      {t(option.labelKey)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </SettingsRow>

            {prefs.proxyMode === 'custom' && (
              <SettingsRow
                label={t('network.custom.url.label' as SettingsKey)}
                description={customProxyError ?? t('network.custom.url.description' as SettingsKey)}
                vertical
              >
                <Input
                  value={customProxyDraft}
                  onChange={(event) => {
                    setCustomProxyDraft(event.target.value)
                    setCustomProxyError(null)
                  }}
                  onBlur={saveCustomProxyDraft}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.currentTarget.blur()
                    }
                  }}
                  disabled={customDisabled}
                  placeholder={t('network.custom.url.placeholder' as SettingsKey)}
                  aria-invalid={customProxyError ? true : undefined}
                  aria-label={t('network.custom.url.label' as SettingsKey)}
                />
              </SettingsRow>
            )}

            <SettingsRow
              label={t('network.status.label' as SettingsKey)}
              description={currentStatusDescription}
            >
              <div className="flex items-center justify-end gap-2">
                <Badge variant="outline" className="gap-1.5 font-mono text-[11px]">
                  <WifiIcon className="size-3" aria-hidden="true" />
                  {statusLabel}
                </Badge>
                <Button
                  type="button"
                  size="icon-xs"
                  variant="ghost"
                  onClick={() => void refetchStatus()}
                  disabled={isStatusLoading}
                  aria-label={t('network.status.refresh' as SettingsKey)}
                >
                  {isStatusLoading
                    ? <Spinner className="size-3" />
                    : <RefreshIcon className="size-3" aria-hidden="true" />}
                </Button>
              </div>
            </SettingsRow>
          </>
        )}
    </SettingsGroup>
  )
}
