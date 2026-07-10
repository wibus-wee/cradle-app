import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { RuntimeUserInputQuestion } from './runtime-user-input-form'
import { RuntimeUserInputForm } from './runtime-user-input-form'

afterEach(() => {
  cleanup()
})

function textQuestion(id: string): RuntimeUserInputQuestion {
  return {
    id,
    header: `Header ${id}`,
    question: `Question ${id}?`,
    isOther: false,
    isSecret: false,
    multiSelect: false,
    options: null,
  }
}

function optionsQuestion(id: string): RuntimeUserInputQuestion {
  return {
    id,
    header: `Header ${id}`,
    question: `Question ${id}?`,
    isOther: false,
    isSecret: false,
    multiSelect: false,
    options: [
      { label: 'Alpha', description: 'Pick alpha' },
      { label: 'Beta', description: 'Pick beta' },
    ],
  }
}

function isDisabled(el: HTMLElement): boolean {
  return (el as HTMLButtonElement).disabled === true
}

describe('runtimeUserInputForm - skip', () => {
  it('enables Skip and disables Next/Preview when a question is unanswered', () => {
    render(<RuntimeUserInputForm questions={[optionsQuestion('question-1')]} onSubmit={vi.fn()} />)

    expect(isDisabled(screen.getByRole('button', { name: 'Preview' }))).toBe(true)
    expect(isDisabled(screen.getByRole('button', { name: 'Skip' }))).toBe(false)
  })

  it('skips a question and submits an empty answer', async () => {
    const onSubmit = vi.fn()
    render(<RuntimeUserInputForm questions={[optionsQuestion('question-1')]} onSubmit={onSubmit} />)

    fireEvent.click(screen.getByRole('button', { name: 'Skip' }))

    // Preview reflects the skip and Submit is no longer gated by "all answered".
    expect(screen.queryByText('Skipped')).not.toBeNull()
    expect(isDisabled(screen.getByRole('button', { name: 'Submit' }))).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({ 'question-1': [] })
    })
  })

  it('clears an existing draft when skipping so no answer is submitted', async () => {
    const onSubmit = vi.fn()
    render(<RuntimeUserInputForm questions={[textQuestion('question-1')]} onSubmit={onSubmit} />)

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'a thoughtful answer' } })

    // Answered now -> Preview lights up; Skip still available as the escape hatch.
    expect(isDisabled(screen.getByRole('button', { name: 'Preview' }))).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: 'Skip' }))

    expect(screen.queryByText('Skipped')).not.toBeNull()
    expect(screen.queryByText('a thoughtful answer')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({ 'question-1': [] })
    })
  })

  it('advances through multiple questions, answering some and skipping others', async () => {
    const onSubmit = vi.fn()
    render(
      <RuntimeUserInputForm
        questions={[textQuestion('question-1'), textQuestion('question-2')]}
        onSubmit={onSubmit}
      />,
    )

    // Q1: answer and go next.
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'ans1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))

    // Q2: skip instead of answering.
    expect(isDisabled(screen.getByRole('button', { name: 'Preview' }))).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }))

    expect(screen.queryByText('Skipped')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({ 'question-1': ['ans1'], 'question-2': [] })
    })
  })

  it('still submits a typed answer when the user does not skip', async () => {
    const onSubmit = vi.fn()
    render(<RuntimeUserInputForm questions={[textQuestion('question-1')]} onSubmit={onSubmit} />)

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'ans1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }))
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({ 'question-1': ['ans1'] })
    })
  })
})
