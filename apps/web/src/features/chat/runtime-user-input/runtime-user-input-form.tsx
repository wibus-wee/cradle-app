import { useState } from 'react'

import { Button } from '~/components/ui/button'
import { Checkbox } from '~/components/ui/checkbox'
import { Input } from '~/components/ui/input'
import { RadioGroup, RadioGroupItem } from '~/components/ui/radio-group'
import { Textarea } from '~/components/ui/textarea'
import { cn } from '~/lib/cn'

export interface RuntimeUserInputOption {
  label: string
  description: string
}

export interface RuntimeUserInputQuestion {
  id: string
  header: string
  question: string
  isOther: boolean
  isSecret: boolean
  multiSelect: boolean
  options: RuntimeUserInputOption[] | null
}

interface RuntimeUserInputFormProps {
  questions: RuntimeUserInputQuestion[]
  disabled?: boolean
  className?: string
  onSubmit: (answers: Record<string, string[]>) => Promise<void> | void
}

const OTHER_OPTION_VALUE = '__cradle_other__'

export function RuntimeUserInputForm({
  questions,
  disabled = false,
  className,
  onSubmit,
}: RuntimeUserInputFormProps) {
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [multiDrafts, setMultiDrafts] = useState<Record<string, string[]>>({})
  const [otherDrafts, setOtherDrafts] = useState<Record<string, string>>({})
  const [activeStep, setActiveStep] = useState(0)
  const [submitting, setSubmitting] = useState(false)

  const previewStep = questions.length
  const step = Math.min(activeStep, previewStep)
  const question = questions[step] ?? null
  const isPreview = step === previewStep
  const canGoBack = step > 0 && !submitting

  const updateDraft = (questionId: string, value: string) => {
    setDrafts(current => ({ ...current, [questionId]: value }))
  }

  const toggleMultiDraft = (questionId: string, value: string, checked: boolean) => {
    setMultiDrafts((current) => {
      const previous = current[questionId] ?? []
      const next = checked
        ? [...new Set([...previous, value])]
        : previous.filter(item => item !== value)
      return { ...current, [questionId]: next }
    })
  }

  const updateOtherDraft = (questionId: string, value: string) => {
    setOtherDrafts(current => ({ ...current, [questionId]: value }))
  }

  const readSingleAnswer = (question: RuntimeUserInputQuestion): string => {
    const selected = drafts[question.id]?.trim() ?? ''
    const other = otherDrafts[question.id]?.trim() ?? ''
    return selected === OTHER_OPTION_VALUE ? other : selected
  }

  const readAnswers = (question: RuntimeUserInputQuestion): string[] => {
    if (!question.multiSelect) {
      return [readSingleAnswer(question)].filter(Boolean)
    }

    const selected = multiDrafts[question.id] ?? []
    const other = otherDrafts[question.id]?.trim() ?? ''
    return selected.flatMap((value) => {
      if (value === OTHER_OPTION_VALUE) {
        return other ? [other] : []
      }
      return value.trim() ? [value] : []
    })
  }

  const isAnswered = (question: RuntimeUserInputQuestion): boolean => {
    return readAnswers(question).length > 0
  }

  const readPreviewAnswer = (question: RuntimeUserInputQuestion): string => {
    if (question.isSecret && isAnswered(question)) {
      return '********'
    }
    return readAnswers(question).join(', ')
  }

  const buildAnswers = (): Record<string, string[]> => {
    return Object.fromEntries(
      questions.map(question => [question.id, readAnswers(question)]),
    )
  }

  const submit = async () => {
    setSubmitting(true)
    try {
      await onSubmit(buildAnswers())
    }
 finally {
      setSubmitting(false)
    }
  }

  const goBack = () => {
    setActiveStep(current => Math.max(0, current - 1))
  }

  const goNext = () => {
    setActiveStep(current => Math.min(previewStep, current + 1))
  }

  return (
    <div
      className={cn('grid gap-3 border-t border-border/60 px-3 py-3', className)}
      data-testid="runtime-user-input-card"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] font-medium text-muted-foreground">
          {isPreview ? 'Preview' : `Question ${step + 1} of ${questions.length}`}
        </div>
        <div className="flex items-center gap-1">
          {questions.map((item, index) => (
            <span
              key={item.id}
              className={cn(
                'size-1.5 rounded-full bg-muted-foreground/25',
                index === step && 'bg-primary',
                index < step && 'bg-primary/55',
              )}
            />
          ))}
          <span
            className={cn(
              'size-1.5 rounded-full bg-muted-foreground/25',
              isPreview && 'bg-primary',
            )}
          />
        </div>
      </div>

      {isPreview
? (
        <div className="grid gap-1.5">
          {questions.map((question, index) => (
            <Button
              key={question.id}
              type="button"
              variant="outline"
              disabled={disabled || submitting}
              className="grid h-auto min-h-10 justify-stretch gap-1 rounded-md border-border/60 bg-background px-2.5 py-2 text-left whitespace-normal shadow-sm hover:border-border hover:bg-muted/35 disabled:opacity-60"
              onClick={() => setActiveStep(index)}
            >
              <span className="text-[11px] font-medium text-muted-foreground">
                {question.header || `Question ${index + 1}`}
              </span>
              <span className="text-xs text-foreground/85">{readPreviewAnswer(question)}</span>
            </Button>
          ))}
        </div>
      )
: question
? (
        <div className="grid gap-2">
          <div className="grid gap-0.5">
            {question.header && (
              <div className="text-[11px] font-medium text-muted-foreground">{question.header}</div>
            )}
            <div className="text-xs text-foreground/85">{question.question}</div>
          </div>
          {question.options && question.options.length > 0
? (
            <div className="grid gap-2">
              {question.multiSelect
? (
                <div className="grid gap-1.5">
                  {question.options.map((option) => {
                    const selected = multiDrafts[question.id]?.includes(option.label) ?? false
                    return (
                      <label
                        key={option.label}
                        className={cn(
                          'flex min-h-10 cursor-pointer items-start gap-2 rounded-md border border-border/60 bg-background px-2.5 py-2 text-left shadow-sm transition-[background-color,border-color,box-shadow]',
                          'hover:border-border hover:bg-muted/35',
                          selected
                          && 'border-primary/45 bg-primary/5 shadow-[0_0_0_1px_hsl(var(--primary)/0.16)]',
                          (disabled || submitting) && 'cursor-not-allowed opacity-60',
                        )}
                      >
                        <Checkbox
                          checked={selected}
                          disabled={disabled || submitting}
                          className="mt-0.5"
                          onCheckedChange={checked => toggleMultiDraft(question.id, option.label, checked === true)}
                        />
                        <span className="grid min-w-0 gap-0.5">
                          <span className="truncate text-xs font-medium text-foreground/90">
                            {option.label}
                          </span>
                          {option.description && (
                            <span className="text-[11px] leading-snug text-muted-foreground">
                              {option.description}
                            </span>
                          )}
                        </span>
                      </label>
                    )
                  })}
                  {question.isOther && (
                    <label
                      className={cn(
                        'flex min-h-10 cursor-pointer items-center gap-2 rounded-md border border-border/60 bg-background px-2.5 py-2 text-left shadow-sm transition-[background-color,border-color,box-shadow]',
                        'hover:border-border hover:bg-muted/35',
                        multiDrafts[question.id]?.includes(OTHER_OPTION_VALUE)
                        && 'border-primary/45 bg-primary/5 shadow-[0_0_0_1px_hsl(var(--primary)/0.16)]',
                        (disabled || submitting) && 'cursor-not-allowed opacity-60',
                      )}
                    >
                      <Checkbox
                        checked={multiDrafts[question.id]?.includes(OTHER_OPTION_VALUE) ?? false}
                        disabled={disabled || submitting}
                        onCheckedChange={checked => toggleMultiDraft(question.id, OTHER_OPTION_VALUE, checked === true)}
                      />
                      <span className="text-xs font-medium text-foreground/90">Other</span>
                    </label>
                  )}
                </div>
              )
: (
                <RadioGroup
                  value={drafts[question.id] ?? ''}
                  disabled={disabled || submitting}
                  onValueChange={value => updateDraft(question.id, value)}
                  className="gap-1.5"
                >
                  {question.options.map(option => (
                    <label
                      key={option.label}
                      className={cn(
                        'flex min-h-10 cursor-pointer items-start gap-2 rounded-md border border-border/60 bg-background px-2.5 py-2 text-left shadow-sm transition-[background-color,border-color,box-shadow]',
                        'hover:border-border hover:bg-muted/35',
                        drafts[question.id] === option.label
                        && 'border-primary/45 bg-primary/5 shadow-[0_0_0_1px_hsl(var(--primary)/0.16)]',
                        (disabled || submitting) && 'cursor-not-allowed opacity-60',
                      )}
                    >
                      <RadioGroupItem value={option.label} className="mt-0.5" />
                      <span className="grid min-w-0 gap-0.5">
                        <span className="truncate text-xs font-medium text-foreground/90">
                          {option.label}
                        </span>
                        {option.description && (
                          <span className="text-[11px] leading-snug text-muted-foreground">
                            {option.description}
                          </span>
                        )}
                      </span>
                    </label>
                  ))}
                  {question.isOther && (
                    <label
                      className={cn(
                        'flex min-h-10 cursor-pointer items-center gap-2 rounded-md border border-border/60 bg-background px-2.5 py-2 text-left shadow-sm transition-[background-color,border-color,box-shadow]',
                        'hover:border-border hover:bg-muted/35',
                        drafts[question.id] === OTHER_OPTION_VALUE
                        && 'border-primary/45 bg-primary/5 shadow-[0_0_0_1px_hsl(var(--primary)/0.16)]',
                        (disabled || submitting) && 'cursor-not-allowed opacity-60',
                      )}
                    >
                      <RadioGroupItem value={OTHER_OPTION_VALUE} />
                      <span className="text-xs font-medium text-foreground/90">Other</span>
                    </label>
                  )}
                </RadioGroup>
              )}
              {question.isOther && (
                question.multiSelect
                  ? multiDrafts[question.id]?.includes(OTHER_OPTION_VALUE)
                  : drafts[question.id] === OTHER_OPTION_VALUE
              ) && (
                <Input
                  value={otherDrafts[question.id] ?? ''}
                  disabled={disabled || submitting}
                  className="h-8 text-xs"
                  placeholder="Other"
                  onChange={event => updateOtherDraft(question.id, event.target.value)}
                />
              )}
            </div>
          )
: question.isSecret
? (
            <Input
              type="password"
              value={drafts[question.id] ?? ''}
              disabled={disabled || submitting}
              className="h-8 text-xs"
              onChange={event => updateDraft(question.id, event.target.value)}
            />
          )
: (
            <Textarea
              value={drafts[question.id] ?? ''}
              disabled={disabled || submitting}
              rows={3}
              className="min-h-9 resize-none text-xs"
              onChange={event => updateDraft(question.id, event.target.value)}
            />
          )}
        </div>
      )
: null}

      <div className="flex items-center justify-between gap-2">
        <Button type="button" variant="ghost" size="xs" disabled={!canGoBack} onClick={goBack}>
          Back
        </Button>
        {isPreview
? (
          <Button
            type="button"
            size="xs"
            disabled={disabled || submitting || questions.some(question => !isAnswered(question))}
            onClick={() => void submit()}
          >
            Submit
          </Button>
        )
: (
          <Button
            type="button"
            size="xs"
            disabled={disabled || submitting || !question || !isAnswered(question)}
            onClick={goNext}
          >
            {step === questions.length - 1 ? 'Preview' : 'Next'}
          </Button>
        )}
      </div>
    </div>
  )
}
