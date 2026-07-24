import {
  ArrowLeftLine as BackIcon,
  ArrowRightLine as ForwardIcon,
  CameraLine as ScreenshotIcon,
  Chat1Line as AnnotationIcon,
  GlobeLine as BrowserIcon,
  Refresh1Line as ReloadIcon,
} from '@mingcute/react'
import type { FormEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { cn } from '~/lib/cn'
import type { BrowserWebTab } from '~/store/browser-panel'

import type { BrowserAddressSuggestion } from './browser-panel.logic'
import { BROWSER_NATIVE_SURFACE_OCCLUSION_PROPS } from './native-surface-occlusion'

type ChromeKey = keyof typeof import('~/locales/default').default.chrome

export interface BrowserNavigationToolbarViewProps {
  activeTab: BrowserWebTab
  addressValue: string
  suggestions: BrowserAddressSuggestion[]
  suggestionsOpen: boolean
  nativeBrowserAvailable: boolean
  annotationActive: boolean
  onBack: () => void
  onForward: () => void
  onReload: () => void
  onAddressChange: (value: string) => void
  onAddressFocus: () => void
  onAddressBlur: () => void
  onAddressSubmit: (event: FormEvent<HTMLFormElement>) => void
  onSuggestionSelect: (suggestion: BrowserAddressSuggestion) => void
  onCaptureScreenshot: () => void
  onToggleAnnotation: () => void
}

export function BrowserNavigationToolbarView({
  activeTab,
  addressValue,
  suggestions,
  suggestionsOpen,
  nativeBrowserAvailable,
  annotationActive,
  onBack,
  onForward,
  onReload,
  onAddressChange,
  onAddressFocus,
  onAddressBlur,
  onAddressSubmit,
  onSuggestionSelect,
  onCaptureScreenshot,
  onToggleAnnotation,
}: BrowserNavigationToolbarViewProps) {
  const { t } = useTranslation('chrome')

  return (
    <div className="relative flex h-10 shrink-0 items-center gap-2 border-b border-border/50 bg-card px-2">
      <div className="flex shrink-0 items-center gap-0.5">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="size-7 rounded-md text-muted-foreground/70 hover:bg-foreground/5 hover:text-foreground disabled:opacity-30"
          disabled={!activeTab.canGoBack}
          onClick={onBack}
          aria-label="Go back"
        >
          <BackIcon className="size-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="size-7 rounded-md text-muted-foreground/70 hover:bg-foreground/5 hover:text-foreground disabled:opacity-30"
          disabled={!activeTab.canGoForward}
          onClick={onForward}
          aria-label="Go forward"
        >
          <ForwardIcon className="size-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="size-7 rounded-md text-muted-foreground/70 hover:bg-foreground/5 hover:text-foreground disabled:opacity-30"
          disabled={!nativeBrowserAvailable}
          onClick={onReload}
          aria-label="Reload"
        >
          <ReloadIcon
            className={cn('size-3.5', activeTab.isLoading && 'animate-spin')}
          />
        </Button>
      </div>

      <form className="relative min-w-0 flex-1" onSubmit={onAddressSubmit}>
        <Input
          type="text"
          value={addressValue}
          placeholder="Search or enter address"
          aria-label="Search or enter address"
          disabled={!nativeBrowserAvailable}
          className="h-7 w-full rounded-md border-0 bg-foreground/5 px-3 text-xs shadow-none placeholder:text-muted-foreground/50 focus:bg-foreground/8 focus-visible:ring-0 md:text-xs"
          onFocus={onAddressFocus}
          onBlur={onAddressBlur}
          onChange={event => onAddressChange(event.target.value)}
        />
        {suggestionsOpen && suggestions.length > 0
          ? (
              <div
                className="absolute left-0 right-0 top-8 z-20 overflow-hidden rounded-md border border-border bg-popover py-1 shadow-lg"
                {...BROWSER_NATIVE_SURFACE_OCCLUSION_PROPS}
              >
                {suggestions.map(suggestion => (
                  <Button
                    key={suggestion.id}
                    type="button"
                    variant="ghost"
                    className="h-auto w-full min-w-0 justify-start gap-2 rounded-none px-2 py-1.5 text-left text-xs font-normal hover:bg-foreground/5"
                    onMouseDown={event => event.preventDefault()}
                    onClick={() => onSuggestionSelect(suggestion)}
                  >
                    {suggestion.faviconUrl
                      ? (
                          <img
                            src={suggestion.faviconUrl}
                            alt=""
                            className="size-3.5 shrink-0 rounded-sm"
                          />
                        )
                      : (
                          <BrowserIcon
                            className="size-3.5 shrink-0 !text-muted-foreground/60"
                            aria-hidden="true"
                          />
                        )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-foreground">{suggestion.title}</span>
                      <span className="block truncate text-[10px] text-muted-foreground">
                        {suggestion.detail}
                      </span>
                    </span>
                  </Button>
                ))}
              </div>
            )
          : null}
      </form>

      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="size-7 shrink-0 rounded-md text-muted-foreground/70 hover:bg-foreground/5 hover:text-foreground disabled:opacity-30"
        disabled={!nativeBrowserAvailable}
        onClick={onCaptureScreenshot}
        aria-label="Attach screenshot to composer"
      >
        <ScreenshotIcon className="size-3.5" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className={cn(
          'h-7 shrink-0 gap-1 rounded-md px-2 text-xs disabled:opacity-30',
          annotationActive
            ? 'bg-primary/12 text-primary hover:bg-primary/16'
            : 'text-muted-foreground/70 hover:bg-foreground/5 hover:text-foreground',
        )}
        disabled={!nativeBrowserAvailable}
        onClick={onToggleAnnotation}
        aria-label={
          annotationActive
            ? t('browser.annotation.cancel' as ChromeKey)
            : t('browser.annotation.comment' as ChromeKey)
        }
        title={t('browser.annotation.toggleTitle' as ChromeKey)}
      >
        <AnnotationIcon className="size-3.5" />
        <span>{t('browser.annotation.comment' as ChromeKey)}</span>
      </Button>
    </div>
  )
}
