import type {
  BetaMessage,
  BetaMessageTokensCount,
  BetaRawMessageStreamEvent,
  MessageCountTokensParams as BetaMessageCountTokensParams,
  MessageCreateParams as BetaMessageCreateParams,
} from 'anthropic-sdk-0-115/resources/beta/messages'
import type {
  BetaModelInfo,
  ModelListParams as BetaModelListParams,
  ModelRetrieveParams as BetaModelRetrieveParams,
} from 'anthropic-sdk-0-115/resources/beta/models'
import type {
  Message as StableMessage,
  MessageCountTokensParams as StableMessageCountTokensParams,
  MessageCreateParams as StableMessageCreateParams,
  MessageTokensCount as StableMessageTokensCount,
  RawMessageStreamEvent as StableRawMessageStreamEvent,
} from 'anthropic-sdk-0-115/resources/messages'
import type {
  ModelInfo as StableModelInfo,
  ModelListParams as StableModelListParams,
  ModelRetrieveParams as StableModelRetrieveParams,
} from 'anthropic-sdk-0-115/resources/models'
import type { ErrorResponse as StableErrorResponse } from 'anthropic-sdk-0-115/resources/shared'

export type AnthropicMessageCreateParams = StableMessageCreateParams
export type AnthropicMessageCountTokensParams = StableMessageCountTokensParams
export type AnthropicMessage = StableMessage
export type AnthropicMessageTokensCount = StableMessageTokensCount
export type AnthropicRawMessageStreamEvent = StableRawMessageStreamEvent
export type AnthropicModelInfo = StableModelInfo
export type AnthropicModelListParams = StableModelListParams
export type AnthropicModelRetrieveParams = StableModelRetrieveParams
export type AnthropicErrorResponse = StableErrorResponse

export type AnthropicBetaMessageCreateParams = BetaMessageCreateParams
export type AnthropicBetaMessageCountTokensParams = BetaMessageCountTokensParams
export type AnthropicBetaMessage = BetaMessage
export type AnthropicBetaMessageTokensCount = BetaMessageTokensCount
export type AnthropicBetaRawMessageStreamEvent = BetaRawMessageStreamEvent
export type AnthropicBetaModelInfo = BetaModelInfo
export type AnthropicBetaModelListParams = BetaModelListParams
export type AnthropicBetaModelRetrieveParams = BetaModelRetrieveParams
