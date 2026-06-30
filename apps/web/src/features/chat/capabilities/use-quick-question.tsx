import { useState } from 'react'

export interface UseQuickQuestionOptions {
  sessionId: string
  apiBaseUrl?: string
}

export interface QuickQuestionController {
  open: boolean
  question: string
  sessionId: string
  apiBaseUrl?: string
  openQuickQuestion: (question: string) => void
  closeQuickQuestion: () => void
}

export function useQuickQuestion({ sessionId, apiBaseUrl }: UseQuickQuestionOptions): QuickQuestionController {
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
    apiBaseUrl,
    openQuickQuestion,
    closeQuickQuestion,
  }
}
