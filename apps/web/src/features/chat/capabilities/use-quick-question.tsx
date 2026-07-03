import { useState } from 'react'

export interface UseQuickQuestionOptions {
  sessionId: string
}

export interface QuickQuestionController {
  open: boolean
  question: string
  sessionId: string
  openQuickQuestion: (question: string) => void
  closeQuickQuestion: () => void
}

export function useQuickQuestion({ sessionId }: UseQuickQuestionOptions): QuickQuestionController {
  const [open, setOpen] = useState(false)
  const [question, setQuestion] = useState('')

  const openQuickQuestion = (q: string) => {
    setQuestion(q)
    setOpen(true)
  }

  const closeQuickQuestion = () => {
    setOpen(false)
  }

  return {
    open,
    question,
    sessionId,
    openQuickQuestion,
    closeQuickQuestion,
  }
}
