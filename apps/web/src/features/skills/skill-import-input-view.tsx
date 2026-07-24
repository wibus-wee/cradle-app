import {
  CloseLine as XIcon,
  LinkLine as LinkIcon,
  RightSmallLine as ChevronRightIcon,
} from '@mingcute/react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '~/components/ui/button'
import { Spinner } from '~/components/ui/spinner'
import { cn } from '~/lib/cn'

interface SkillImportInputViewProps {
  isFetching: boolean
  error: string | null
  onFetch: (source: string) => void
}

export function SkillImportInputView({
  isFetching,
  error,
  onFetch,
}: SkillImportInputViewProps) {
  const { t } = useTranslation('skills')
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const timeout = setTimeout(() => inputRef.current?.focus(), 60)
    return () => clearTimeout(timeout)
  }, [])

  const handleSubmit = () => {
    const source = value.trim()
    if (source && !isFetching) {
      onFetch(source)
    }
  }

  return (
    <div className="flex h-full flex-col gap-8 p-6 sm:p-8">
      <div className="flex flex-col gap-1.5">
        <h2 className="text-balance text-[18px] font-semibold tracking-tight text-foreground">
          {t('import.title')}
        </h2>
        <p className="text-pretty text-[13px] leading-relaxed text-muted-foreground/60">
          {t('import.formDescription')}
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <div
          className={cn(
            'flex items-center gap-3 rounded-xl border border-foreground/8 bg-foreground/3 px-4 py-3',
            'transition-[background-color,border-color] duration-150 focus-within:border-foreground/20 focus-within:bg-foreground/4',
            error && 'border-destructive/30',
          )}
        >
          <LinkIcon className="size-4 shrink-0 !text-muted-foreground/25" />
          <input
            ref={inputRef}
            type="text"
            aria-label="Skill source"
            value={value}
            onChange={event => setValue(event.target.value)}
            onKeyDown={event => event.key === 'Enter' && handleSubmit()}
            placeholder={t('import.sourcePlaceholder')}
            className="min-w-0 flex-1 bg-transparent font-mono text-[13px] text-foreground outline-none placeholder:font-sans placeholder:text-muted-foreground/25"
            disabled={isFetching}
            spellCheck={false}
            autoComplete="off"
            data-testid="skill-import-source-input"
          />
          {value && !isFetching && (
            <button
              type="button"
              onClick={() => setValue('')}
              className="flex size-5 items-center justify-center rounded text-muted-foreground/25 transition-colors hover:text-muted-foreground"
              aria-label="Clear source"
            >
              <XIcon className="size-3" />
            </button>
          )}
        </div>
        {error && <p className="px-1 text-[12px] leading-relaxed text-destructive">{error}</p>}
      </div>

      <Button
        onClick={handleSubmit}
        disabled={!value.trim() || isFetching}
        className="h-10 w-full"
        data-testid="skill-import-fetch-btn"
      >
        {isFetching
          ? (
              <>
                <Spinner className="size-3.5" />
                {t('import.fetching')}
              </>
            )
          : (
              <>
                {t('import.fetchSkills')}
                <ChevronRightIcon className="size-4" />
              </>
            )}
      </Button>
    </div>
  )
}
