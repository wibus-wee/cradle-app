import { z } from 'zod'

import { ClaudeAgentConfigSchema } from './claude-agent-config'

export const ProfileConfigSchema = z.object({
  baseUrl: z.string().default(''),
  openaiBaseUrl: z.string().default(''),
  anthropicBaseUrl: z.string().default(''),
  model: z.string().default(''),
  api: z.string().default(''),
  authMode: z.enum([
    'apikey',
    'chatgpt',
    'chatgptAuthTokens',
    'agentIdentity',
    'personalAccessToken',
    'bedrockApiKey',
    // Claude Agent auth modes (providerKind: 'anthropic')
    'apiKey',
    'claudeAi',
  ]).optional(),
  bedrock: z.object({
    region: z.string().default(''),
  }).optional(),
  claudeAgent: ClaudeAgentConfigSchema.optional(),
  enabledModels: z.array(z.string().min(1)).default([]),
}).passthrough()

export const ProfileConfigJsonSchema = z.string()
  .transform(raw => JSON.parse(raw))
  .pipe(ProfileConfigSchema)
