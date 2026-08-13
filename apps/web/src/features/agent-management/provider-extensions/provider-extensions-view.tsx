import { AlertLine as AlertIcon, CheckCircleLine as CheckIcon } from '@mingcute/react'

import { Spinner } from '~/components/ui/spinner'
import { Switch } from '~/components/ui/switch'
import { cn } from '~/lib/cn'

import type { ProviderExtensionViewModel } from './provider-extensions-contract'

export interface ProviderExtensionsViewProps {
  extensions: ProviderExtensionViewModel[]
  loading?: boolean
  disabled?: boolean
  pendingExtensionKey?: string | null
  onEnabledChange: (extension: ProviderExtensionViewModel, enabled: boolean) => void
}

function statusCopy(extension: ProviderExtensionViewModel): string {
  if (!extension.applicable) {
    return extension.unavailableReason ?? '当前 Provider 不支持此扩展。'
  }
  if (extension.status === 'enabling') {
    return '正在启用并准备运行时路由…'
  }
  if (extension.status === 'disabling') {
    return '正在关闭并清理运行时路由…'
  }
  if (extension.status === 'suspended') {
    return '扩展暂不可用；重新启用插件后会自动恢复。'
  }
  if (extension.status === 'error') {
    return extension.lastError ?? '扩展状态异常，请先关闭后重试。'
  }
  if (extension.status === 'enabled') {
    return extension.credentialOwner === 'extension'
      ? '已启用；登录状态由扩展安全托管。'
      : '已启用；原 Provider 与凭据保持不变。'
  }
  return extension.description ?? '为这个 Provider 增加更多运行时协议支持。'
}

function statusTone(extension: ProviderExtensionViewModel): string {
  if (extension.status === 'error' || !extension.applicable) {
    return 'text-destructive'
  }
  if (extension.status === 'enabled') {
    return 'text-success'
  }
  return 'text-muted-foreground'
}

export function ProviderExtensionsView({
  extensions,
  loading = false,
  disabled = false,
  pendingExtensionKey = null,
  onEnabledChange,
}: ProviderExtensionsViewProps) {
  if (loading) {
    return (
      <div className="flex min-h-16 items-center justify-center rounded-xl bg-card shadow-[var(--shadow-xs)]">
        <Spinner className="size-4" />
      </div>
    )
  }

  if (extensions.length === 0) {
    return null
  }

  return (
    <section className="flex flex-col gap-3" aria-label="Provider extensions">
      <div className="px-0.5">
        <h5 className="text-balance text-[13px] font-medium text-foreground">Provider 扩展</h5>
        <p className="mt-0.5 text-pretty text-[11.5px] text-muted-foreground">
          只扩展当前 Provider；不会创建新的 Provider，也不会应用到其他 Provider。
        </p>
      </div>

      <div className="overflow-hidden rounded-xl bg-card shadow-[var(--shadow-xs)]">
        {extensions.map((extension, index) => {
          const pending = pendingExtensionKey === extension.extensionKey
            || extension.status === 'enabling'
            || extension.status === 'disabling'
          const unavailable = !extension.applicable || extension.status === 'suspended'
          return (
            <div
              key={extension.extensionKey}
              className={cn(
                'flex min-h-16 items-center justify-between gap-5 px-4 py-3',
                index > 0 && 'border-t border-border/60',
              )}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  {extension.status === 'enabled'
                    ? <CheckIcon className="size-3.5 shrink-0 !text-success" />
                    : extension.status === 'error'
                      ? <AlertIcon className="size-3.5 shrink-0 !text-destructive" />
                      : null}
                  <span className="text-[12.5px] font-medium text-foreground">
                    通过
                    {' '}
                    {extension.label}
                    {' '}
                    扩展
                  </span>
                </div>
                <p className={cn('mt-0.5 text-pretty text-[11.5px]', statusTone(extension))}>
                  {statusCopy(extension)}
                </p>
              </div>

              <div className="flex min-h-10 min-w-10 items-center justify-center">
                <Switch
                  checked={extension.desiredEnabled}
                  disabled={disabled || pending || (!extension.desiredEnabled && unavailable)}
                  aria-busy={pending}
                  aria-label={`${extension.desiredEnabled ? 'Disable' : 'Enable'} ${extension.label}`}
                  onCheckedChange={enabled => onEnabledChange(extension, enabled)}
                />
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
