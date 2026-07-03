import type { ChatContextPart } from '../context/chat-context-parts'
import type { ChatComposerSlashCommand } from '../slash-commands/chat-slash-commands'

export interface ComposerState {
  inputValue: string
  mentionActive: boolean
  mentionQuery: string
  slashActive: boolean
  slashQuery: string
  skillActive: boolean
  skillQuery: string
  contextParts: ChatContextPart[]
  selectedSlashCommand: ChatComposerSlashCommand | null
}

export type ComposerAction
  = | { type: 'input/changed', state: ComposerState }
    | { type: 'input/cleared' }
    | { type: 'mention/closed' }
    | { type: 'mention/selected' }
    | { type: 'slash/closed' }
    | { type: 'slash/selected', inputValue: string, command: ChatComposerSlashCommand | null }
    | { type: 'skill/closed' }
    | { type: 'skill/selected' }
    | { type: 'pickers/closed' }

export const INITIAL_COMPOSER_STATE: ComposerState = {
  inputValue: '',
  mentionActive: false,
  mentionQuery: '',
  slashActive: false,
  slashQuery: '',
  skillActive: false,
  skillQuery: '',
  contextParts: [],
  selectedSlashCommand: null,
}

function areStringArraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function areContextPartsEqual(left: ChatContextPart[], right: ChatContextPart[]): boolean {
  if (left === right) {
    return true
  }
  if (left.length !== right.length) {
    return false
  }

  return left.every((leftPart, index) => {
    const rightPart = right[index]
    if (!rightPart || leftPart.type !== rightPart.type || leftPart.position !== rightPart.position) {
      return false
    }

    if (leftPart.type === 'data-cradle-skill') {
      return rightPart.type === 'data-cradle-skill'
        && leftPart.name === rightPart.name
        && leftPart.path === rightPart.path
        && leftPart.scope === rightPart.scope
        && leftPart.description === rightPart.description
    }

    if (rightPart.type !== 'data-cradle-plugin') {
      return false
    }

    const leftNativeMention = leftPart.nativeMention ?? null
    const rightNativeMention = rightPart.nativeMention ?? null
    const nativeMentionEqual = leftNativeMention === rightNativeMention
      || (
        leftNativeMention !== null
        && rightNativeMention !== null
        && leftNativeMention.name === rightNativeMention.name
        && leftNativeMention.path === rightNativeMention.path
      )

    return nativeMentionEqual
      && leftPart.provider === rightPart.provider
      && leftPart.pluginName === rightPart.pluginName
      && leftPart.displayName === rightPart.displayName
      && leftPart.description === rightPart.description
      && leftPart.iconUrl === rightPart.iconUrl
      && leftPart.routeSegment === rightPart.routeSegment
      && areStringArraysEqual(leftPart.mcpServers, rightPart.mcpServers)
      && leftPart.capabilities.length === rightPart.capabilities.length
      && leftPart.capabilities.every((capability, capabilityIndex) => {
        const rightCapability = rightPart.capabilities[capabilityIndex]
        return Boolean(rightCapability)
          && capability.id === rightCapability.id
          && capability.type === rightCapability.type
          && capability.layer === rightCapability.layer
          && capability.label === rightCapability.label
      })
  })
}

function areComposerStatesEqual(left: ComposerState, right: ComposerState): boolean {
  return left.inputValue === right.inputValue
    && left.mentionActive === right.mentionActive
    && left.mentionQuery === right.mentionQuery
    && left.slashActive === right.slashActive
    && left.slashQuery === right.slashQuery
    && left.skillActive === right.skillActive
    && left.skillQuery === right.skillQuery
    && left.selectedSlashCommand === right.selectedSlashCommand
    && areContextPartsEqual(left.contextParts, right.contextParts)
}

export function composerReducer(state: ComposerState, action: ComposerAction): ComposerState {
  switch (action.type) {
    case 'input/changed':
      return areComposerStatesEqual(state, action.state) ? state : action.state
    case 'input/cleared':
      return { ...INITIAL_COMPOSER_STATE }
    case 'mention/closed':
      return { ...state, mentionActive: false }
    case 'mention/selected':
      return {
        ...state,
        mentionActive: false,
        mentionQuery: '',
        slashActive: false,
        slashQuery: '',
        skillActive: false,
        skillQuery: '',
      }
    case 'slash/closed':
      return { ...state, slashActive: false }
    case 'slash/selected':
      return {
        ...state,
        inputValue: action.inputValue,
        slashActive: false,
        slashQuery: '',
        mentionActive: false,
        mentionQuery: '',
        skillActive: false,
        skillQuery: '',
        selectedSlashCommand: action.command,
      }
    case 'skill/closed':
      return { ...state, skillActive: false }
    case 'skill/selected':
      return {
        ...state,
        mentionActive: false,
        mentionQuery: '',
        slashActive: false,
        slashQuery: '',
        skillActive: false,
        skillQuery: '',
        selectedSlashCommand: null,
      }
    case 'pickers/closed':
      return {
        ...state,
        mentionActive: false,
        slashActive: false,
        skillActive: false,
      }
    default:
      return state
  }
}
