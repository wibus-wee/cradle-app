import {
  CheckLine as CheckIcon,
  CloseLine as XIcon,
} from '@mingcute/react'
import { AnimatePresence, m } from 'motion/react'

import { Spinner } from '~/components/ui/spinner'

import type {
  LiveCheckRun,
  LiveCommitStatus,
  LiveWorkflowJob,
  LiveWorkflowJobStep,
} from './use-live-await-status'

type AwaitStatusIconProps
  = | {
    kind: 'run'
    status: LiveCheckRun['status'] | LiveWorkflowJob['status']
    conclusion: string | null
  }
  | {
      kind: 'step'
      status: LiveWorkflowJobStep['status']
      conclusion: string | null
    }
    | {
      kind: 'commit'
      status: LiveCommitStatus['state']
    }

export function AwaitStatusIcon(props: AwaitStatusIconProps) {
  const status = props.status
  const conclusion = props.kind === 'commit' ? null : props.conclusion

  const icon = (() => {
    if (props.kind === 'commit') {
      if (props.status === 'pending') {
        return <Spinner className="size-3 text-amber-500" />
      }
      return (
        <svg
          viewBox="0 0 16 16"
          className={props.status === 'success' ? 'size-3 text-green-500' : 'size-3 text-red-500'}
          aria-hidden
        >
          <circle cx="8" cy="8" r="7" fill="currentColor" />
          {props.status === 'success'
            ? <path d="M5 8l2 2 4-4" stroke="white" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            : <path d="M5.5 5.5l5 5M10.5 5.5l-5 5" stroke="white" strokeWidth="1.5" strokeLinecap="round" />}
        </svg>
      )
    }

    if (status !== 'completed') {
      return <Spinner className="size-3 text-amber-500" />
    }

    if (conclusion === 'skipped' || conclusion === 'cancelled' || conclusion === 'neutral') {
      return (
        <svg viewBox="0 0 16 16" className="size-3 text-muted-foreground/70" aria-hidden>
          <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M4.75 11.25l6.5-6.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      )
    }

    if (props.kind === 'step') {
      return conclusion === 'success'
        ? <CheckIcon className="size-3 !text-green-500" strokeWidth={2.2} />
        : <XIcon className="size-3 !text-red-500" strokeWidth={2.1} />
    }

    return (
      <svg
        viewBox="0 0 16 16"
        className={conclusion === 'success' ? 'size-3 text-green-500' : 'size-3 text-red-500'}
        aria-hidden
      >
        <circle cx="8" cy="8" r="7" fill="currentColor" />
        {conclusion === 'success'
          ? <path d="M5 8l2 2 4-4" stroke="white" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          : <path d="M5.5 5.5l5 5M10.5 5.5l-5 5" stroke="white" strokeWidth="1.5" strokeLinecap="round" />}
      </svg>
    )
  })()

  return (
    <AnimatePresence mode="wait">
      <m.span
        key={`${props.kind}-${status}-${conclusion}`}
        initial={{ scale: 0.5, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.5, opacity: 0 }}
        transition={{ duration: 0.15 }}
        className="inline-flex"
      >
        {icon}
      </m.span>
    </AnimatePresence>
  )
}
