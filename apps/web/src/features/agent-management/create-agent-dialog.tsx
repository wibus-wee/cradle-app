import {
  CheckLine as CheckIcon,
  RandomLine as DicesIcon,
} from '@mingcute/react'
import { m } from 'motion/react'
import { Select as RadixSelect } from 'radix-ui'
import { FormProvider } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { ProviderIcon } from '~/components/common/provider-icons'
import { Button } from '~/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '~/components/ui/select'
import { Spinner } from '~/components/ui/spinner'
import type { RuntimeKind } from '~/features/agent-runtime/types'
import { cn } from '~/lib/cn'

import { SettingsDivider, SettingsRow } from '../settings/settings-row'
import {
  AgentProviderModelPicker,
  AVATAR_STYLES,
  CLI_TUI_PRESETS,
  parseCliEnvText,
  RuntimeOptionIcon,
  useAgentDetailOwner,
} from './agent-detail'

/**
 * Create-agent dialog — a focused, self-contained recruit flow.
 *
 * Reuses `useAgentDetailOwner({ agent: undefined })` so all create business logic
 * (form schema, runtime/provider wiring, configJson assembly, createAgent call)
 * stays shared with the edit page. Only the presentation shell differs: a Dialog
 * with a clean Cancel/Create escape hatch (the inline draft flow had none), a
 * calmer avatar picker, and the advanced Claude Agent SDK section omitted to keep
 * first-time creation uncluttered — configure it later from the agent's edit page.
 *
 * The body is a separate component so Radix unmounts it on close: every open
 * starts from a fresh form with a new random avatar seed.
 */
export function CreateAgentDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (agentId: string) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-4 sm:max-w-md">
        <CreateAgentDialogBody onCreated={onCreated} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  )
}

function CreateAgentDialogBody({
  onCreated,
  onClose,
}: {
  onCreated: (agentId: string) => void
  onClose: () => void
}) {
  const { t } = useTranslation('agentManagement')
  const owner = useAgentDetailOwner({ agent: undefined, onCreated })
  const draft = owner.draft
  const cliEnvParseResult = parseCliEnvText(draft.cliTuiEnvText)
  const invalidEnvLineSummary = cliEnvParseResult.invalidLineNumbers.join(', ')
  const selectedRuntimeOption = owner.runtimeOptions.find(option => option.value === draft.runtimeKind)
    ?? { value: draft.runtimeKind, label: draft.runtimeKind }

  return (
    <FormProvider {...owner.form}>
      <DialogHeader>
        <DialogTitle>{t('create.dialog.title')}</DialogTitle>
        <DialogDescription>{t('create.dialog.description')}</DialogDescription>
      </DialogHeader>

      <div className="flex min-h-0 flex-1 flex-col gap-0 overflow-y-auto pr-1">
        {/* Identity hero */}
        <div className="flex items-start gap-4 py-3">
          <div className="flex shrink-0 flex-col items-center gap-2">
            <m.button
              type="button"
              onClick={owner.shuffleAvatar}
              data-testid="agent-avatar-preview"
              className="group relative size-14 cursor-pointer overflow-hidden rounded-2xl bg-foreground/5"
              title={t('detail.avatar.shuffle')}
              whileTap={{ scale: 0.91 }}
            >
              {owner.avatarIconSlug
                ? (
                    <m.div
                      key={`${owner.avatarSpinKey}:${owner.avatarIconSlug}`}
                      className="flex size-full items-center justify-center p-3"
                      initial={{ scale: 0.82, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={{ type: 'spring', stiffness: 380, damping: 22 }}
                    >
                      <ProviderIcon iconSlug={owner.avatarIconSlug} presetId={null} className="size-full" />
                    </m.div>
                  )
                : owner.avatarUrl && (
                  <m.img
                    key={owner.avatarSpinKey}
                    src={owner.avatarUrl}
                    alt={draft.name || t('detail.avatar.alt')}
                    className="size-full object-cover"
                    crossOrigin="anonymous"
                    initial={{ scale: 0.82, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: 'spring', stiffness: 380, damping: 22 }}
                  />
                )}
              <div className="absolute inset-0 flex items-center justify-center bg-black/20 opacity-0 transition-opacity group-hover:opacity-100">
                <DicesIcon className="size-4 !text-white" />
              </div>
            </m.button>

            <Select
              value={draft.avatarStyle}
              onValueChange={value => owner.form.setValue('avatarStyle', value, { shouldDirty: true })}
            >
              <SelectTrigger
                size="sm"
                data-testid="agent-avatar-style"
                className="h-6 w-28 text-[11px]"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {AVATAR_STYLES.map(style => (
                  <SelectItem key={style.id} value={style.id} className="text-xs">
                    {t(style.labelKey)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex min-w-0 flex-1 flex-col gap-1 pt-1">
            <input
              type="text"
              {...owner.form.register('name')}
              placeholder={t('detail.identity.name.placeholder')}
              data-testid="agent-detail-name"
              className="bg-transparent text-[16px] font-semibold leading-tight text-foreground outline-none placeholder:text-muted-foreground/25"
            />
            <input
              type="text"
              {...owner.form.register('description')}
              placeholder={t('detail.identity.description.placeholder')}
              data-testid="agent-detail-description"
              className="bg-transparent text-[12px] text-muted-foreground outline-none placeholder:text-muted-foreground/25"
            />
          </div>
        </div>

        {/* Runtime */}
        <SettingsDivider />
        <SettingsRow label={t('detail.runtime.label')} description={t('detail.runtime.description')}>
          <Select
            value={draft.runtimeKind}
            onValueChange={value => owner.form.setValue('runtimeKind', value as RuntimeKind, { shouldDirty: true })}
          >
            <SelectTrigger size="sm" className="h-8 w-48 text-[12.5px]" data-testid="agent-runtime-select">
              <div className="flex items-center gap-2">
                <RuntimeOptionIcon option={selectedRuntimeOption} className="size-4 shrink-0" />
                <span className="truncate">{selectedRuntimeOption.label}</span>
              </div>
            </SelectTrigger>
            <SelectContent className="w-64">
              {owner.runtimeOptions.map(opt => (
                <RadixSelect.Item
                  key={opt.value}
                  value={opt.value}
                  className={cn(
                    'relative flex w-full cursor-default items-start gap-2.5 rounded-md py-2 pr-8 pl-2 text-sm outline-hidden select-none',
                    'focus:bg-accent focus:text-accent-foreground',
                    'data-disabled:pointer-events-none data-disabled:opacity-50',
                  )}
                >
                  <span className="pointer-events-none absolute right-2 flex size-4 items-center justify-center">
                    <RadixSelect.ItemIndicator>
                      <CheckIcon className="pointer-events-none size-3" />
                    </RadixSelect.ItemIndicator>
                  </span>
                  <span className="mt-0.5 shrink-0">
                    <RuntimeOptionIcon option={opt} className="size-4" />
                  </span>
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <RadixSelect.ItemText className="text-[12.5px] font-medium">
                      {opt.label}
                    </RadixSelect.ItemText>
                    {opt.description && (
                      <span className="text-[11px] leading-snug text-muted-foreground">
                        {opt.description}
                      </span>
                    )}
                  </div>
                </RadixSelect.Item>
              ))}
            </SelectContent>
          </Select>
        </SettingsRow>

        {owner.draftUsesCliLaunchConfig
          ? (
              <>
                <SettingsDivider />
                <SettingsRow label={t('detail.cliTui.preset.label')} description={t('detail.cliTui.preset.description')}>
                  <Select
                    value={draft.cliTuiPreset}
                    onValueChange={(value) => {
                      owner.form.setValue('cliTuiPreset', value, { shouldDirty: true })
                      const preset = CLI_TUI_PRESETS.find(preset => preset.id === value)
                      if (value !== 'custom') {
                        owner.form.setValue('cliTuiExecutable', preset?.executable ?? '', { shouldDirty: true })
                        owner.form.setValue('cliTuiArguments', preset?.args ?? '', { shouldDirty: true })
                      }
                    }}
                  >
                    <SelectTrigger size="sm" className="h-8 w-48 text-[12.5px]" data-testid="agent-cli-preset-select">
                      <SelectValue placeholder={t('detail.cliTui.preset.placeholder')} />
                    </SelectTrigger>
                    <SelectContent>
                      {CLI_TUI_PRESETS.map(preset => (
                        <SelectItem key={preset.id} value={preset.id} className="text-xs">
                          {preset.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </SettingsRow>

                <SettingsDivider />
                <SettingsRow label={t('detail.cliTui.executable.label')} description={t('detail.cliTui.executable.description')}>
                  <input
                    type="text"
                    {...owner.form.register('cliTuiExecutable')}
                    data-testid="agent-cli-executable"
                    placeholder="claude"
                    className="h-8 w-56 rounded-md bg-foreground/4 px-3 text-[12.5px] text-foreground outline-none placeholder:text-muted-foreground/35"
                  />
                </SettingsRow>

                <SettingsDivider />
                <SettingsRow label={t('detail.cliTui.arguments.label')} description={t('detail.cliTui.arguments.description')}>
                  <input
                    type="text"
                    {...owner.form.register('cliTuiArguments')}
                    data-testid="agent-cli-arguments"
                    placeholder="--dangerously-skip-permissions"
                    className="h-8 w-72 rounded-md bg-foreground/4 px-3 text-[12.5px] text-foreground outline-none placeholder:text-muted-foreground/35"
                  />
                </SettingsRow>

                <SettingsDivider />
                <SettingsRow label={t('detail.cliTui.environment.label')} description={t('detail.cliTui.environment.description')} vertical>
                  <div className="flex w-full flex-col gap-1.5">
                    <textarea
                      {...owner.form.register('cliTuiEnvText')}
                      rows={4}
                      data-testid="agent-cli-env"
                      aria-invalid={cliEnvParseResult.invalidLineNumbers.length > 0}
                      placeholder={'ANTHROPIC_API_KEY=...\nNO_COLOR=1'}
                      className={cn(
                        'w-full resize-none rounded-md bg-foreground/4 px-3 py-2.5 text-[12px] outline-none',
                        'text-foreground placeholder:text-muted-foreground/30',
                        'transition-colors focus:bg-foreground/5',
                        cliEnvParseResult.invalidLineNumbers.length > 0 && 'bg-destructive/5 ring-1 ring-destructive/25 focus:bg-destructive/5',
                      )}
                    />
                    {cliEnvParseResult.invalidLineNumbers.length > 0 && (
                      <p className="text-[11px] leading-snug text-destructive/85" data-testid="agent-cli-env-warning">
                        {t('detail.cliTui.environment.invalidLines', { lineNumbers: invalidEnvLineSummary })}
                      </p>
                    )}
                  </div>
                </SettingsRow>
              </>
            )
          : (
              <>
                <SettingsDivider />
                <SettingsRow label={t('detail.model.label')} description={t('detail.model.description')}>
                  <div className="flex flex-col items-end gap-1.5">
                    <AgentProviderModelPicker
                      providerTargets={owner.selectableProviderTargets}
                      providerTargetId={draft.providerTargetId}
                      modelId={draft.modelId}
                      thinkingEffort={draft.thinkingEffort}
                    />
                    {owner.providerDisabledReason && (
                      <p
                        className="max-w-72 text-right text-[11px] leading-snug text-amber-700 dark:text-amber-300"
                        data-testid="agent-provider-disabled-reason"
                      >
                        {owner.providerDisabledReason}
                      </p>
                    )}
                  </div>
                </SettingsRow>
              </>
            )}

        {/* System prompt */}
        <SettingsDivider />
        <SettingsRow label={t('detail.systemPrompt.label')} description={t('detail.systemPrompt.description')} vertical>
          <textarea
            {...owner.form.register('systemPrompt')}
            placeholder={t('detail.systemPrompt.placeholder')}
            rows={4}
            data-testid="agent-detail-system-prompt"
            className={cn(
              'w-full resize-none rounded-md bg-foreground/4 px-3 py-2.5 text-[12px] outline-none',
              'text-foreground placeholder:text-muted-foreground/30',
              'transition-colors focus:bg-foreground/5',
            )}
          />
        </SettingsRow>
      </div>

      <DialogFooter>
        {owner.saveError && <p className="mr-auto text-[11px] text-destructive">{owner.saveError}</p>}
        {!owner.saveError && owner.createDisabledReason && (
          <p className="mr-auto text-[11px] text-muted-foreground" data-testid="agent-create-disabled-reason">
            {t(owner.createDisabledReason)}
          </p>
        )}
        <Button variant="outline" size="sm" onClick={onClose}>
          {t('detail.action.cancel')}
        </Button>
        <Button
          size="sm"
          onClick={() => void owner.handleCreate()}
          disabled={owner.createDisabled}
          data-testid="agent-detail-save"
        >
          {owner.createSaving && <Spinner className="size-3.5" />}
          {t('detail.create.action')}
        </Button>
      </DialogFooter>
    </FormProvider>
  )
}
