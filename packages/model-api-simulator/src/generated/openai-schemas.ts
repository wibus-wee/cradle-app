import openapi from '../../protocol/openai/openapi.json'

export const openaiSchemaCatalogue = openapi.components.schemas
export type OpenAiSchemaId = keyof typeof openapi.components.schemas
