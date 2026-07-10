import {
  CheckLine as CheckIcon,
  CopyLine as CopyIcon,
  UploadLine as UploadIcon,
} from '@mingcute/react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Slider } from '~/components/ui/slider'
import { Switch } from '~/components/ui/switch'
import { cn } from '~/lib/cn'
import type { ThemeOverrides, ThemeProfile, ThemeVariant } from '~/store/theme-customization'
import {
  parseThemeImport,
  resolveThemePreview,
  selectActiveThemeProfile,
  useThemeCustomizationStore,
} from '~/store/theme-customization'

import { SettingsGroup } from './settings-container'
import { SettingsRow } from './settings-row'
import { ThemePreview } from './theme-preview'

export const ThemeCustomizationSettings = () => {
  const { t } = useTranslation('settings')
  const profiles = useThemeCustomizationStore(state => state.profiles)
  const activeProfileIds = useThemeCustomizationStore(state => state.activeProfileIds)
  const setActiveProfile = useThemeCustomizationStore(state => state.setActiveProfile)
  const updateProfile = useThemeCustomizationStore(state => state.updateProfile)
  const updateOverrides = useThemeCustomizationStore(state => state.updateOverrides)
  const duplicateProfile = useThemeCustomizationStore(state => state.duplicateProfile)
  const importProfile = useThemeCustomizationStore(state => state.importProfile)
  const [variant, setVariant] = useState<ThemeVariant>('light')
  const [importError, setImportError] = useState(false)
  const importInputRef = useRef<HTMLInputElement>(null)

  const activeProfile = selectActiveThemeProfile({ profiles, activeProfileIds }, variant)
  const variantProfiles = profiles.filter(profile => profile.variant === variant)
  const preview = resolveThemePreview(activeProfile)

  const changeOverride = <Key extends keyof ThemeOverrides>(
    key: Key,
    value: ThemeOverrides[Key],
  ): void => {
    updateOverrides(activeProfile.id, { [key]: value })
  }

  const importTheme = async (file: File | undefined): Promise<void> => {
    if (!file) {
      return
    }
    try {
      const profile = parseThemeImport(await file.text())
      importProfile(profile)
      setVariant(profile.variant)
      setImportError(false)
    }
    catch {
      setImportError(true)
    }
    finally {
      if (importInputRef.current) {
        importInputRef.current.value = ''
      }
    }
  }

  return (
    <SettingsGroup
      label={t('appearance.customization.title')}
      description={t('appearance.customization.description')}
      action={(
        <div className="flex items-center gap-2">
          <input
            ref={importInputRef}
            type="file"
            accept="application/json,.json"
            className="sr-only"
            onChange={event => void importTheme(event.currentTarget.files?.[0])}
          />
          <Button
            variant="outline"
            size="sm"
            className="h-10"
            data-testid="appearance-theme-import"
            onClick={() => importInputRef.current?.click()}
          >
            <UploadIcon data-icon="inline-start" />
            {t('appearance.customization.import')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-10"
            data-testid="appearance-theme-duplicate"
            onClick={() => duplicateProfile(activeProfile.id)}
          >
            <CopyIcon data-icon="inline-start" />
            {t('appearance.customization.duplicate')}
          </Button>
        </div>
      )}
      bare
    >
      <div className="p-4">
        <div className="mb-4 flex w-fit gap-1 rounded-lg bg-muted p-1">
          {(['light', 'dark'] as const).map(option => (
            <button
              key={option}
              type="button"
              onClick={() => setVariant(option)}
              className={cn(
                'min-h-10 rounded-md px-3 text-xs font-medium transition-[background-color,color,box-shadow]',
                variant === option
                  ? 'bg-background text-foreground shadow-xs'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {t(`appearance.theme.${option}`)}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {variantProfiles.map(profile => (
            <ThemeProfileCard
              key={profile.id}
              profile={profile}
              selected={profile.id === activeProfile.id}
              onSelect={() => setActiveProfile(variant, profile.id)}
            />
          ))}
        </div>

        {importError && (
          <p role="alert" className="mt-3 text-xs text-destructive text-pretty">
            {t('appearance.customization.importError')}
          </p>
        )}
      </div>

      <div className="border-t border-border/60 px-4">
        <SettingsRow
          label={t('appearance.customization.livePreview')}
          description={t('appearance.customization.livePreviewDescription')}
          vertical
        >
          <ThemePreview profile={activeProfile} className="h-36 shadow-[var(--shadow-xs)]" />
        </SettingsRow>

        <SettingsRow label={t('appearance.customization.name')}>
          <Input
            value={activeProfile.name}
            aria-label={t('appearance.customization.name')}
            data-testid="appearance-theme-name"
            onChange={event =>
              updateProfile(activeProfile.id, { name: event.currentTarget.value })}
            className="w-56"
          />
        </SettingsRow>

        <SettingsRow label={t('appearance.customization.colors')} vertical>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <ThemeColorInput
              label={t('appearance.customization.accent')}
              value={preview.accentColor}
              onChange={value => changeOverride('accentColor', value)}
            />
            <ThemeColorInput
              label={t('appearance.customization.background')}
              value={preview.backgroundColor}
              onChange={value => changeOverride('backgroundColor', value)}
            />
            <ThemeColorInput
              label={t('appearance.customization.foreground')}
              value={preview.foregroundColor}
              onChange={value => changeOverride('foregroundColor', value)}
            />
          </div>
        </SettingsRow>

        <SettingsRow label={t('appearance.customization.uiFont')} vertical>
          <Input
            value={activeProfile.overrides.uiFont ?? ''}
            placeholder={preview.uiFont}
            aria-label={t('appearance.customization.uiFont')}
            data-testid="appearance-theme-ui-font"
            onChange={event =>
              changeOverride('uiFont', event.currentTarget.value.trimStart() || null)}
            className="font-mono text-xs"
          />
        </SettingsRow>

        <SettingsRow label={t('appearance.customization.codeFont')} vertical>
          <Input
            value={activeProfile.overrides.codeFont ?? ''}
            placeholder={preview.codeFont}
            aria-label={t('appearance.customization.codeFont')}
            data-testid="appearance-theme-code-font"
            onChange={event =>
              changeOverride('codeFont', event.currentTarget.value.trimStart() || null)}
            className="font-mono text-xs"
          />
        </SettingsRow>

        <SettingsRow
          label={t('appearance.customization.translucentSidebar')}
          description={t('appearance.customization.translucentSidebarDescription')}
        >
          <Switch
            checked={preview.translucentSidebar}
            onCheckedChange={value => changeOverride('translucentSidebar', value)}
            aria-label={t('appearance.customization.translucentSidebar')}
            data-testid="appearance-theme-translucent-sidebar"
          />
        </SettingsRow>

        <SettingsRow
          label={t('appearance.customization.contrast')}
          description={t('appearance.customization.contrastDescription')}
        >
          <div className="flex w-56 items-center gap-3">
            <Slider
              value={[preview.contrast]}
              min={0}
              max={100}
              step={1}
              onValueChange={value => changeOverride('contrast', value[0] ?? 50)}
              aria-label={t('appearance.customization.contrast')}
              data-testid="appearance-theme-contrast"
            />
            <span className="w-8 text-right text-xs tabular-nums text-muted-foreground">
              {preview.contrast}
            </span>
          </div>
        </SettingsRow>
      </div>
    </SettingsGroup>
  )
}

const ThemeProfileCard = ({
  profile,
  selected,
  onSelect,
}: {
  profile: ThemeProfile
  selected: boolean
  onSelect: () => void
}) => (
  <button
    type="button"
    onClick={onSelect}
    aria-pressed={selected}
    data-testid={`appearance-theme-profile-${profile.id}`}
    className="group min-w-0 text-left"
  >
    <div
      className={cn(
        'relative aspect-4/3 overflow-hidden rounded-xl p-1 shadow-[var(--shadow-xs)] transition-[box-shadow,scale] group-active:scale-[0.96]',
        selected
          ? 'ring-2 ring-ring ring-offset-2 ring-offset-background'
          : 'hover:shadow-[var(--shadow-sm)]',
      )}
    >
      <ThemePreview profile={profile} />
      {selected && (
        <span className="absolute right-2 bottom-2 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <CheckIcon className="size-3" aria-hidden="true" />
        </span>
      )}
    </div>
    <span
      className={cn(
        'mt-2 block truncate text-xs',
        selected ? 'font-medium text-foreground' : 'text-muted-foreground',
      )}
    >
      {profile.name}
    </span>
  </button>
)

const ThemeColorInput = ({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (value: string) => void
}) => (
  <label className="flex min-w-0 items-center gap-2 rounded-lg border border-input bg-background px-2 py-1.5 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
    <input
      type="color"
      value={value}
      onChange={event => onChange(event.currentTarget.value)}
      className="size-6 shrink-0 cursor-pointer rounded-md border-0 bg-transparent p-0"
      aria-label={label}
    />
    <span className="min-w-0">
      <span className="block truncate text-[10px] text-muted-foreground">{label}</span>
      <span className="block font-mono text-[11px] uppercase text-foreground">{value}</span>
    </span>
  </label>
)
