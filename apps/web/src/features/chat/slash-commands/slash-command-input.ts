import type { FuzzyRankField } from '~/lib/fuzzy-rank'
import { rankFuzzyItems } from '~/lib/fuzzy-rank'

import type { ChatComposerSlashCommand } from './chat-slash-commands'
import { getSlashCommandSourceLabel } from './chat-slash-commands'

export const RE_SIMPLE_SLASH_COMMAND = /^[ \t]*\/[^/\s]*$/
export const CHAT_SLASH_COMMAND_LISTBOX_ID = 'chat-slash-command-listbox'
const MAX_SLASH_COMMAND_RESULTS = 24
const LEADING_INLINE_WHITESPACE_RE = /^[ \t]+/

export interface SlashTriggerState {
  start: number
  query: string
  selectedCommand: ChatComposerSlashCommand | null
}

export function isSlashCommandAvailable(command: ChatComposerSlashCommand): boolean {
  return command.availability?.enabled !== false
}

export function getSlashCommandPrefix(command: ChatComposerSlashCommand): string {
  return command.action.kind === 'insertText' ? command.action.text : `/${command.name} `
}

export function isSlashCommandAwaitingRequiredArgument(inputValue: string, command: ChatComposerSlashCommand): boolean {
  const argumentHint = command.argumentHint.trim()
  if (!argumentHint.startsWith('<')) {
    return false
  }

  const inputWithoutLeadingInlineWhitespace = inputValue.replace(LEADING_INLINE_WHITESPACE_RE, '')
  const commandPrefix = getSlashCommandPrefix(command)
  return inputWithoutLeadingInlineWhitespace === commandPrefix || inputWithoutLeadingInlineWhitespace === commandPrefix.trimEnd()
}

export function getActiveSlashCommand(inputValue: string, selectedCommand: ChatComposerSlashCommand | null, commands: ChatComposerSlashCommand[]): ChatComposerSlashCommand | null {
  const inputWithoutLeadingInlineWhitespace = inputValue.replace(LEADING_INLINE_WHITESPACE_RE, '')
  if (
    selectedCommand
    && (
      inputWithoutLeadingInlineWhitespace.startsWith(getSlashCommandPrefix(selectedCommand))
      || inputWithoutLeadingInlineWhitespace === getSlashCommandPrefix(selectedCommand).trimEnd()
    )
  ) {
    return selectedCommand
  }

  return commands.find((command) => {
    const commandPrefix = getSlashCommandPrefix(command)
    return inputWithoutLeadingInlineWhitespace.startsWith(commandPrefix)
      || inputWithoutLeadingInlineWhitespace === commandPrefix.trimEnd()
  }) ?? null
}

export function replaceSlashTrigger(inputValue: string, cursor: number, start: number, replacement: string): { value: string, cursor: number } {
  const safeStart = start >= 0 ? start : 0
  const before = inputValue.slice(0, safeStart)
  const after = inputValue.slice(cursor)
  return {
    value: `${before}${replacement}${after}`,
    cursor: before.length + replacement.length,
  }
}

export function getVisibleSlashCommands(commands: ChatComposerSlashCommand[], hasUiActionHandler: boolean): ChatComposerSlashCommand[] {
  return commands.filter(command => command.action.kind !== 'uiAction' || hasUiActionHandler)
}

export function formatSlashCommandSearchText(command: ChatComposerSlashCommand): string {
  return [
    command.name,
    command.label,
    ...(command.aliases ?? []),
    command.description,
    command.argumentHint,
    getSlashCommandSourceLabel(command),
  ].join(' ')
}

function getSlashCommandRankFields(command: ChatComposerSlashCommand): FuzzyRankField[] {
  return [
    { value: command.name, role: 'primary' },
    { value: command.label, role: 'primary' },
    ...(command.aliases ?? []).map(alias => ({ value: alias, role: 'primary' as const })),
    { value: command.description, role: 'secondary' },
    { value: command.argumentHint, role: 'secondary' },
    { value: getSlashCommandSourceLabel(command), role: 'secondary' },
  ]
}

export function getSlashCommandPanelItems(commands: ChatComposerSlashCommand[], query: string): ChatComposerSlashCommand[] {
  if (!query) {
    return commands.slice(0, MAX_SLASH_COMMAND_RESULTS)
  }
  return rankFuzzyItems(commands, query, {
    fields: getSlashCommandRankFields,
    searchText: formatSlashCommandSearchText,
    limit: MAX_SLASH_COMMAND_RESULTS,
  }).map(result => result.item)
}

export function readSlashTriggerState(inputValue: string, cursor: number, commands: ChatComposerSlashCommand[], selectedCommand: ChatComposerSlashCommand | null): SlashTriggerState | null {
  const textBefore = inputValue.slice(0, cursor)
  if (!commands.length || !RE_SIMPLE_SLASH_COMMAND.test(textBefore)) {
    return null
  }

  const start = textBefore.lastIndexOf('/')
  return {
    start,
    query: textBefore.slice(start + 1),
    selectedCommand: getActiveSlashCommand(inputValue, selectedCommand, commands),
  }
}
