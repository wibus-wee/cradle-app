import { Elysia, t } from 'elysia'

import { readClaudeAgentAuthDiagnostics } from '../chat-runtime-providers/claude-agent/account-diagnostics'
import {
  consumeCodexRateLimitResetCredit,
  readCodexAccountDiagnostics,
  readCodexWhamDiagnostics,
} from '../chat-runtime-providers/codex/app-server/account-diagnostics'
import {
  cancelCodexChatgptCredentialLogin,
  readCodexChatgptCredentialLoginStatus,
  startCodexChatgptCredentialLogin,
} from '../chat-runtime-providers/codex/app-server/account-service'
import { ProviderTargetsModel } from './model'
import * as ProviderTargets from './service'

export const providerTargets = new Elysia({
  prefix: '/provider-targets',
  detail: { tags: ['provider-targets'] },
})
  .get(
    '/',
    ({ query }) => ProviderTargets.listProviderTargets({
      runtimeKind: query.runtimeKind,
      workspaceId: query.workspaceId ?? null,
    }),
    {
      detail: {
        summary: 'List provider targets',
      },
      query: ProviderTargetsModel.listQuery,
      response: { 200: t.Array(ProviderTargetsModel.providerTarget) },
    },
  )
  .put(
    '/:providerTargetId',
    ({ params, body }) => {
      return ProviderTargets.upsertManualProviderTarget({
        id: params.providerTargetId,
        displayName: body.displayName,
        providerKind: body.providerKind,
        enabled: body.enabled,
        connectionConfigJson: JSON.stringify(body.connectionConfig),
        credentialRef: body.credentialRef ?? null,
        iconSlug: body.iconSlug,
      })
    },
    {
      detail: {
        summary: 'Create or update a manual provider target',
      },
      params: ProviderTargetsModel.idParams,
      body: ProviderTargetsModel.upsertManualBody,
      response: { 200: ProviderTargetsModel.providerTarget },
    },
  )
  .delete(
    '/:providerTargetId',
    ({ params }) => {
      ProviderTargets.removeProviderTarget(params.providerTargetId)
      return { ok: true as const }
    },
    {
      detail: {
        summary: 'Delete provider target',
      },
      params: ProviderTargetsModel.idParams,
      response: { 200: t.Object({ ok: t.Literal(true) }) },
    },
  )
  .post(
    '/credentials/chatgpt/login',
    ({ body }) => startCodexChatgptCredentialLogin({ label: body.label }),
    {
      detail: {
        summary: 'Start ChatGPT credential login',
        description: 'Start a Cradle-owned ChatGPT device auth flow and create an encrypted credential when it completes.',
      },
      body: ProviderTargetsModel.chatgptCredentialLoginStartBody,
      response: { 200: ProviderTargetsModel.chatgptCredentialLoginStartResponse },
    },
  )
  .get(
    '/credentials/chatgpt/login/:loginId',
    ({ params }) => readCodexChatgptCredentialLoginStatus(params.loginId),
    {
      detail: {
        summary: 'Read ChatGPT credential login status',
      },
      params: ProviderTargetsModel.chatgptCredentialLoginParams,
      response: { 200: ProviderTargetsModel.chatgptCredentialLoginStatus },
    },
  )
  .post(
    '/credentials/chatgpt/login/:loginId/cancel',
    ({ params }) => cancelCodexChatgptCredentialLogin(params.loginId),
    {
      detail: {
        summary: 'Cancel ChatGPT credential login',
      },
      params: ProviderTargetsModel.chatgptCredentialLoginParams,
      response: { 200: t.Object({ ok: t.Literal(true) }) },
    },
  )
  .get(
    '/:providerTargetId/model-settings',
    ({ params }) => ProviderTargets.getProviderTargetModelSettings(params.providerTargetId),
    {
      detail: {
        summary: 'Get model settings for a provider target',
      },
      params: ProviderTargetsModel.idParams,
      response: { 200: ProviderTargetsModel.modelSettings },
    },
  )
  .patch(
    '/:providerTargetId/model-settings',
    ({ params, body }) =>
      ProviderTargets.updateProviderTargetClaudeAgentConfigFromJson(params.providerTargetId, body.claudeAgent),
    {
      detail: {
        summary: 'Update model settings for a provider target',
      },
      params: ProviderTargetsModel.idParams,
      body: ProviderTargetsModel.modelSettingsBody,
      response: { 200: ProviderTargetsModel.modelSettings },
    },
  )
  .get(
    '/:providerTargetId/auth-diagnostics',
    ({ params }) => readClaudeAgentAuthDiagnostics({ providerTargetId: params.providerTargetId }),
    {
      detail: {
        summary: 'Read provider target auth diagnostics',
        description: 'Reads provider-target scoped authentication status without projecting secret values.',
      },
      params: ProviderTargetsModel.idParams,
      response: { 200: ProviderTargetsModel.providerAuthDiagnostics },
    },
  )
  .get(
    '/:providerTargetId/codex/account-diagnostics',
    ({ params }) => readCodexAccountDiagnostics({ providerTargetId: params.providerTargetId }),
    {
      detail: {
        summary: 'Read Codex account diagnostics for a provider target',
        description: 'Explicitly starts or reuses Codex app-server to read ChatGPT account usage and rate limits.',
      },
      params: ProviderTargetsModel.idParams,
      response: { 200: ProviderTargetsModel.codexAccountDiagnostics },
    },
  )
  .get(
    '/:providerTargetId/codex/wham-diagnostics',
    ({ params }) => readCodexWhamDiagnostics({ providerTargetId: params.providerTargetId }),
    {
      detail: {
        summary: 'Read Codex WHAM diagnostics for a provider target',
        description: 'Reads ChatGPT WHAM usage, rate-limit reset credits, and referral eligibility with the provider target ChatGPT credential.',
      },
      params: ProviderTargetsModel.idParams,
      response: { 200: ProviderTargetsModel.codexWhamDiagnostics },
    },
  )
  .post(
    '/:providerTargetId/codex/rate-limit-reset-credit/consume',
    ({ params, body }) => consumeCodexRateLimitResetCredit({
      providerTargetId: params.providerTargetId,
      idempotencyKey: body.idempotencyKey,
    }),
    {
      detail: {
        summary: 'Consume a Codex rate-limit reset credit',
        description: 'Consumes one ChatGPT account reset credit using the supplied idempotency key.',
      },
      params: ProviderTargetsModel.idParams,
      body: ProviderTargetsModel.codexRateLimitResetCreditConsumeBody,
      response: { 200: ProviderTargetsModel.codexRateLimitResetCreditConsumeResponse },
    },
  )
  .patch(
    '/:providerTargetId/model-visibility',
    ({ params, body }) =>
      ProviderTargets.updateProviderTargetModelVisibility(params.providerTargetId, body.enabledModels),
    {
      detail: {
        summary: 'Update visible models for a provider target',
      },
      params: ProviderTargetsModel.idParams,
      body: ProviderTargetsModel.modelVisibilityBody,
      response: { 200: ProviderTargetsModel.modelSettings },
    },
  )
  .patch(
    '/:providerTargetId/custom-models',
    ({ params, body }) =>
      ProviderTargets.updateProviderTargetCustomModels(params.providerTargetId, body.models),
    {
      detail: {
        summary: 'Update custom models for a provider target',
      },
      params: ProviderTargetsModel.idParams,
      body: ProviderTargetsModel.customModelsBody,
      response: { 200: ProviderTargetsModel.customModelEntryList },
    },
  )
