import { readObjectRecord as readRecord } from '../../../../helpers/json-record'
import type { RuntimeUserInputQuestion } from '../../../chat-runtime/runtime-provider-types'

/**
 * Codex app-server user-input / MCP elicitation ↔ runtime question mapping.
 * Pure projection helpers shared by the provider's requestUserInput handling.
 */

function readString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}

export function readCodexUserInputQuestions(params: unknown): RuntimeUserInputQuestion[] {
  const record = readRecord(params)
  const questions = Array.isArray(record.questions) ? record.questions : []
  return questions.map((item, index) => {
    const question = readRecord(item)
    const options = Array.isArray(question.options)
      ? question.options.map((option) => {
          const optionRecord = readRecord(option)
          return {
            label: readString(optionRecord.label, ''),
            description: readString(optionRecord.description, ''),
          }
        })
      : null
    const fallbackId = `question-${index + 1}`
    return {
      id: readString(question.id, fallbackId),
      header: readString(question.header, ''),
      question: readString(question.question, ''),
      isOther: question.isOther === true,
      isSecret: question.isSecret === true,
      multiSelect: false,
      options,
    }
  })
}

export function readCodexMcpElicitationQuestions(params: unknown): RuntimeUserInputQuestion[] {
  const record = readRecord(params)
  const mode = readString(record.mode, 'form')
  const message = readString(record.message, '')
  if (mode === 'url') {
    return [
      {
        id: 'action',
        header: readString(record.serverName, 'MCP elicitation'),
        question: message || readString(record.url, 'Open the requested URL?'),
        isOther: false,
        isSecret: false,
        multiSelect: false,
        options: [
          { label: 'accept', description: readString(record.url, '') },
          { label: 'decline', description: 'Decline this MCP elicitation' },
        ],
      },
    ]
  }

  const schema = readRecord(record.requestedSchema)
  const properties = readRecord(schema.properties)
  const entries = Object.entries(properties)
  if (entries.length === 0) {
    return [
      {
        id: 'content',
        header: readString(record.serverName, 'MCP elicitation'),
        question: message || 'MCP server requested user input.',
        isOther: false,
        isSecret: false,
        multiSelect: false,
        options: null,
      },
    ]
  }

  return entries.map(([id, value]) => {
    const property = readRecord(value)
    return {
      id,
      header: readString(property.title, id),
      question: readString(property.description, message || id),
      isOther: false,
      isSecret: readString(property.format, '') === 'password',
      multiSelect: property.type === 'array',
      options: readMcpElicitationOptions(property),
    }
  })
}

function readMcpElicitationOptions(
  property: Record<string, unknown>,
): Array<{ label: string, description: string }> | null {
  if (Array.isArray(property.enum)) {
    const names = Array.isArray(property.enumNames) ? property.enumNames : []
    return property.enum.flatMap((value, index) => {
      if (typeof value !== 'string') {
        return []
      }
      return [
        {
          label: value,
          description: typeof names[index] === 'string' ? names[index] : '',
        },
      ]
    })
  }

  if (Array.isArray(property.oneOf)) {
    return property.oneOf.flatMap((option) => {
      const optionRecord = readRecord(option)
      const value = readString(optionRecord.const, '')
      if (!value) {
        return []
      }
      return [
        {
          label: value,
          description: readString(optionRecord.title, ''),
        },
      ]
    })
  }

  const items = readRecord(property.items)
  if (Array.isArray(items.enum)) {
    return items.enum.flatMap(value =>
      typeof value === 'string' ? [{ label: value, description: '' }] : [])
  }

  if (Array.isArray(items.anyOf)) {
    return items.anyOf.flatMap((option) => {
      const optionRecord = readRecord(option)
      const value = readString(optionRecord.const, '')
      if (!value) {
        return []
      }
      return [
        {
          label: value,
          description: readString(optionRecord.title, ''),
        },
      ]
    })
  }

  if (property.type === 'boolean') {
    return [
      { label: 'true', description: 'Yes' },
      { label: 'false', description: 'No' },
    ]
  }

  return null
}

export function buildCodexMcpElicitationResponse(
  params: unknown,
  answers: Record<string, string[]>,
): unknown {
  const record = readRecord(params)
  if (record.mode === 'url') {
    const action = answers.action?.[0] === 'decline' ? 'decline' : 'accept'
    return { action, content: null, _meta: null }
  }

  return {
    action: 'accept',
    content: buildCodexMcpElicitationContent(record, answers),
    _meta: null,
  }
}

function buildCodexMcpElicitationContent(
  params: Record<string, unknown>,
  answers: Record<string, string[]>,
): Record<string, unknown> {
  const schema = readRecord(params.requestedSchema)
  const properties = readRecord(schema.properties)
  return Object.fromEntries(
    Object.entries(answers).flatMap(([key, value]) => {
      if (value.length === 0) {
        return []
      }
      return [[key, readMcpElicitationAnswerValue(readRecord(properties[key]), value)]]
    }),
  )
}

function readMcpElicitationAnswerValue(property: Record<string, unknown>, value: string[]): unknown {
  switch (property.type) {
    case 'boolean':
      return value[0] === 'true'
    case 'integer':
      return Math.trunc(Number(value[0]))
    case 'number':
      return Number(value[0])
    case 'array':
      return value
    default:
      return value.length === 1 ? value[0] : value
  }
}
