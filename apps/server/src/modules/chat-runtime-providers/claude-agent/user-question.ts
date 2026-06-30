/**
 * Output: Claude Agent AskUserQuestion tool input/output projected to Runtime user input.
 * Input: Claude Agent SDK AskUserQuestion tool payloads and Runtime user input answers.
 * Position: Claude Agent provider-owned bridge between SDK-native question tools and Chat Runtime pending input.
 */

import type { AskUserQuestionInput, AskUserQuestionOutput } from '@anthropic-ai/claude-agent-sdk/sdk-tools'

import type { RuntimeUserInputQuestion } from '../../chat-runtime/runtime-provider-types'

type ClaudeAgentAskUserQuestion = AskUserQuestionInput['questions'][number]
type ClaudeAgentAskUserQuestionOption = ClaudeAgentAskUserQuestion['options'][number]

export const CLAUDE_AGENT_ASK_USER_QUESTION_METHOD = 'askUserQuestion'

export function readClaudeAgentAskUserQuestionInput(input: unknown): AskUserQuestionInput | null {
  if (!isRecord(input) || !Array.isArray(input.questions) || input.questions.length === 0) {
    return null
  }

  const questions = input.questions.flatMap(readClaudeAgentQuestion)
  if (questions.length === 0) {
    return null
  }

  return {
    ...input,
    questions: questions as AskUserQuestionInput['questions'],
  }
}

export function projectClaudeAgentUserInputQuestions(
  input: AskUserQuestionInput,
): RuntimeUserInputQuestion[] {
  return input.questions.map((question, index) => ({
    id: readClaudeAgentQuestionId(index),
    header: question.header,
    question: question.question,
    isOther: true,
    isSecret: false,
    multiSelect: question.multiSelect,
    options: question.options.map(option => ({
      label: option.label,
      description: option.description,
    })),
  }))
}

export function buildClaudeAgentAskUserQuestionOutput(input: {
  request: AskUserQuestionInput
  answers: Record<string, string[]>
}): AskUserQuestionOutput {
  return {
    questions: input.request.questions,
    answers: Object.fromEntries(
      input.request.questions.map((question, index) => [
        question.question,
        readClaudeAgentQuestionAnswer(input.answers[readClaudeAgentQuestionId(index)] ?? []),
      ]),
    ),
    annotations: buildClaudeAgentQuestionAnnotations(input.request, input.answers),
  }
}

function readClaudeAgentQuestion(item: unknown): ClaudeAgentAskUserQuestion[] {
  if (!isRecord(item) || typeof item.question !== 'string' || typeof item.header !== 'string') {
    return []
  }
  if (!Array.isArray(item.options) || item.options.length < 2) {
    return []
  }

  const options = item.options.flatMap(readClaudeAgentQuestionOption)
  if (options.length < 2) {
    return []
  }

  return [
    {
      ...item,
      question: item.question,
      header: item.header,
      options: options as ClaudeAgentAskUserQuestion['options'],
      multiSelect: item.multiSelect === true,
    },
  ]
}

function readClaudeAgentQuestionOption(item: unknown): ClaudeAgentAskUserQuestionOption[] {
  if (!isRecord(item) || typeof item.label !== 'string' || typeof item.description !== 'string') {
    return []
  }

  return [
    {
      ...item,
      label: item.label,
      description: item.description,
      ...(typeof item.preview === 'string' ? { preview: item.preview } : {}),
    },
  ]
}

function buildClaudeAgentQuestionAnnotations(
  request: AskUserQuestionInput,
  answers: Record<string, string[]>,
): AskUserQuestionOutput['annotations'] {
  const annotations = Object.fromEntries(
    request.questions.flatMap((question, index) => {
      const selected = answers[readClaudeAgentQuestionId(index)] ?? []
      const preview = question.options.find(option => selected.includes(option.label))?.preview
      return preview ? [[question.question, { preview }]] : []
    }),
  )
  return Object.keys(annotations).length > 0 ? annotations : undefined
}

function readClaudeAgentQuestionAnswer(answers: string[]): string {
  return answers.join(', ')
}

function readClaudeAgentQuestionId(index: number): string {
  return `question-${index + 1}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
