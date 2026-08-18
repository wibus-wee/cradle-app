export interface GrowingConversationLoadPatternOptions {
  readonly durationMs: number
  readonly targetContextTokens: number
  readonly followUpIntervalMs?: number
  readonly initialContextTokens?: number
  readonly responseTokensPerTurn?: number
  readonly streamChunksPerTurn?: number
  readonly streamChunkIntervalMs?: number
  readonly charactersPerToken?: number
}

export interface GrowingConversationLoadPattern {
  readonly kind: 'growing-full-history'
  readonly durationMs: number
  readonly targetContextTokens: number
  readonly followUpIntervalMs: number
  readonly initialContextTokens: number
  readonly responseTokensPerTurn: number
  readonly streamChunksPerTurn: number
  readonly streamChunkIntervalMs: number
  readonly charactersPerToken: number
  readonly turnCount: number
}

export interface ConversationLoadMessage {
  readonly id: string
  readonly role: 'assistant' | 'user'
  readonly parts: readonly [{ readonly type: 'text', readonly text: string }]
}

const DEFAULT_FOLLOW_UP_INTERVAL_MS = 5_000
const DEFAULT_INITIAL_CONTEXT_TOKENS = 16_000
const DEFAULT_RESPONSE_TOKENS_PER_TURN = 256
const DEFAULT_STREAM_CHUNKS_PER_TURN = 16
const DEFAULT_STREAM_CHUNK_INTERVAL_MS = 20
const DEFAULT_CHARACTERS_PER_TOKEN = 4

/**
 * Defines a repeatable long-conversation workload without coupling it to an
 * Electron harness or provider transport. Every turn carries the complete
 * accumulated message history and approaches the target context linearly.
 */
export function createGrowingConversationLoadPattern(
  options: GrowingConversationLoadPatternOptions,
): GrowingConversationLoadPattern {
  const durationMs = positiveInteger('durationMs', options.durationMs)
  const targetContextTokens = positiveInteger('targetContextTokens', options.targetContextTokens)
  const followUpIntervalMs = positiveInteger(
    'followUpIntervalMs',
    options.followUpIntervalMs ?? DEFAULT_FOLLOW_UP_INTERVAL_MS,
  )
  const initialContextTokens = positiveInteger(
    'initialContextTokens',
    options.initialContextTokens ?? Math.min(DEFAULT_INITIAL_CONTEXT_TOKENS, targetContextTokens),
  )
  const responseTokensPerTurn = positiveInteger(
    'responseTokensPerTurn',
    options.responseTokensPerTurn ?? DEFAULT_RESPONSE_TOKENS_PER_TURN,
  )
  const streamChunksPerTurn = positiveInteger(
    'streamChunksPerTurn',
    options.streamChunksPerTurn ?? DEFAULT_STREAM_CHUNKS_PER_TURN,
  )
  const streamChunkIntervalMs = positiveInteger(
    'streamChunkIntervalMs',
    options.streamChunkIntervalMs ?? DEFAULT_STREAM_CHUNK_INTERVAL_MS,
  )
  const charactersPerToken = positiveInteger(
    'charactersPerToken',
    options.charactersPerToken ?? DEFAULT_CHARACTERS_PER_TOKEN,
  )
  if (initialContextTokens > targetContextTokens) {
    throw new Error('initialContextTokens must not exceed targetContextTokens.')
  }
  if (streamChunksPerTurn * streamChunkIntervalMs >= followUpIntervalMs) {
    throw new Error('A streamed turn must complete before the next follow-up is scheduled.')
  }
  const minimumGrowthPerTurn = Math.floor(
    (targetContextTokens - initialContextTokens) / Math.max(1, Math.floor(durationMs / followUpIntervalMs)),
  )
  if (minimumGrowthPerTurn <= responseTokensPerTurn) {
    throw new Error('Context growth per turn must exceed the simulated assistant response size.')
  }
  return {
    kind: 'growing-full-history',
    durationMs,
    targetContextTokens,
    followUpIntervalMs,
    initialContextTokens,
    responseTokensPerTurn,
    streamChunksPerTurn,
    streamChunkIntervalMs,
    charactersPerToken,
    turnCount: Math.max(1, Math.floor(durationMs / followUpIntervalMs)),
  }
}

export function createInitialConversationHistory(
  pattern: GrowingConversationLoadPattern,
): ConversationLoadMessage[] {
  return [{
    id: 'load-user-seed',
    role: 'user',
    parts: [{ type: 'text', text: 's'.repeat(pattern.initialContextTokens * pattern.charactersPerToken) }],
  }]
}

/** Creates the next user follow-up needed to hit the turn's linear context target. */
export function createConversationFollowUp(
  pattern: GrowingConversationLoadPattern,
  turnIndex: number,
  history: readonly ConversationLoadMessage[],
): ConversationLoadMessage {
  assertTurnIndex(pattern, turnIndex)
  const targetAtTurn = pattern.initialContextTokens + Math.floor(
    (pattern.targetContextTokens - pattern.initialContextTokens) * ((turnIndex + 1) / pattern.turnCount),
  )
  const currentTokens = estimateConversationTokens(history, pattern.charactersPerToken)
  const tokenCount = Math.max(1, targetAtTurn - currentTokens)
  return {
    id: `load-user-${turnIndex + 1}`,
    role: 'user',
    parts: [{
      type: 'text',
      text: exactLengthText(
        `follow-up-${turnIndex + 1}:`,
        tokenCount * pattern.charactersPerToken,
        'u',
      ),
    }],
  }
}

export function createConversationAssistantReply(
  pattern: GrowingConversationLoadPattern,
  turnIndex: number,
): ConversationLoadMessage {
  assertTurnIndex(pattern, turnIndex)
  return {
    id: `load-assistant-${turnIndex + 1}`,
    role: 'assistant',
    parts: [{
      type: 'text',
      text: exactLengthText(
        `assistant-${turnIndex + 1}:`,
        pattern.responseTokensPerTurn * pattern.charactersPerToken,
        'a',
      ),
    }],
  }
}

export function estimateConversationTokens(
  history: readonly ConversationLoadMessage[],
  charactersPerToken = DEFAULT_CHARACTERS_PER_TOKEN,
): number {
  const characters = history.reduce((total, message) => total + message.parts[0].text.length, 0)
  return Math.ceil(characters / positiveInteger('charactersPerToken', charactersPerToken))
}

function assertTurnIndex(pattern: GrowingConversationLoadPattern, turnIndex: number): void {
  if (!Number.isSafeInteger(turnIndex) || turnIndex < 0 || turnIndex >= pattern.turnCount) {
    throw new Error(`turnIndex must be between 0 and ${pattern.turnCount - 1}.`)
  }
}

function positiveInteger(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`)
  }
  return value
}

function exactLengthText(label: string, length: number, fill: string): string {
  return label.slice(0, length).padEnd(length, fill)
}
