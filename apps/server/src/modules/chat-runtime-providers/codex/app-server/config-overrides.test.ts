import { parse } from 'smol-toml'
import { describe, expect, it } from 'vitest'

import { serializeConfigOverrides } from './config-overrides'

describe('codex CLI TOML overrides', () => {
  it('round trips nested tables, object arrays, literal dotted keys and escaped strings', () => {
    const config = {
      hooks: { events: [{ command: 'echo "hello"\nnext', enabled: false }] },
      responses_api_metadata: { 'literal.dot': 'value', 'quoted"key': 'tab\there' },
      features: {},
      tool_output_token_limit: 1234,
    }
    const restored = Object.assign(
      {},
      ...serializeConfigOverrides(config).map(override => parse(override)),
    )
    expect(restored).toEqual(config)
  })

  it('rejects null instead of sending it as a literal string', () => {
    expect(() => serializeConfigOverrides({ features: { multi_agent: null } })).toThrow('null')
  })
})
