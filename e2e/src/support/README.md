<!-- Once this directory changes, update this README.md -->

# E2E/Support

Shared world, hooks, simulator lifecycle, provider helpers, scenario builders, and page objects.

## Files

- **hooks.ts**: scenario launch, tracing, failure artifacts (includes simulator request ledger)
- **world.ts**: Cucumber world — Chromium page, simulator handle, Standard/Claude Agent configure helpers
- **model-api-simulator.ts**: starts `@cradle/model-api-simulator` with autoRespond for E2E
- **providers.ts**: upsert OpenAI/Anthropic profiles + agents; title-generation sink
- **scenarios/**: deterministic OpenAI Responses / Anthropic Messages exchanges
- **pages/chat.ts**: NewChatPage, ChatPage, ApprovalPage
- **server-lifecycle.ts**: managed server/web (no `CRADLE_MOCK_LLM_URL`)
- **ui.ts**: shared locators for new-chat / chat surfaces
- **database.ts** / **world-utils.ts**: fixtures and artifact paths
