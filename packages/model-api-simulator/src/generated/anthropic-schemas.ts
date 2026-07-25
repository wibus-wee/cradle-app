import schema from '../../protocol/anthropic/schema.json'

export const anthropicSchemaCatalogue = schema
export type AnthropicSchemaId = keyof typeof schema.catalogues
