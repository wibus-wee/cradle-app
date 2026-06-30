import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { requestJson } from './http-client'

describe('requestJson', () => {
  beforeEach(() => {
    delete process.env.CRADLE_AGENT_ID
    delete process.env.CRADLE_AGENT_HOME
    delete process.env.CRADLE_CHAT_SESSION_ID
    delete process.env.CRADLE_WORKSPACE_ID
    delete process.env.CRADLE_WORKSPACE_PATH
  })

  afterEach(() => {
    vi.restoreAllMocks()
    delete process.env.CRADLE_AGENT_ID
    delete process.env.CRADLE_AGENT_HOME
    delete process.env.CRADLE_CHAT_SESSION_ID
    delete process.env.CRADLE_WORKSPACE_ID
    delete process.env.CRADLE_WORKSPACE_PATH
  })

  it('projects CRADLE_CHAT_SESSION_ID into the runtime context header', async () => {
    process.env.CRADLE_CHAT_SESSION_ID = 'chat-session-1'
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"ok":true}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))

    await requestJson({
      method: 'post',
      path: {},
      query: {},
      serverUrl: 'http://localhost:21423',
      template: '/issues/issue-1/comments',
      body: { content: 'Hello' },
    })

    expect(fetchSpy).toHaveBeenCalledWith(new URL('http://localhost:21423/issues/issue-1/comments'), expect.objectContaining({
      headers: {
        'content-type': 'application/json',
        'x-cradle-chat-session-id': 'chat-session-1',
      },
    }))
  })

  it('rejects issue mutations from Cradle runtime when chat session context is missing', async () => {
    process.env.CRADLE_WORKSPACE_ID = 'workspace-1'
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"ok":true}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))

    await expect(requestJson({
      method: 'post',
      path: {},
      query: {},
      serverUrl: 'http://localhost:21423',
      template: '/issues/issue-1/comments',
      body: { content: 'Hello' },
    })).rejects.toThrow('CRADLE_CHAT_SESSION_ID')

    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('rejects issue mutations from agent-scoped Cradle runtime when chat session context is missing', async () => {
    process.env.CRADLE_AGENT_ID = 'agent-1'
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"ok":true}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))

    await expect(requestJson({
      method: 'post',
      path: {},
      query: {},
      serverUrl: 'http://localhost:21423',
      template: '/issues/issue-1/comments',
      body: { content: 'Hello' },
    })).rejects.toThrow('CRADLE_CHAT_SESSION_ID')

    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('allows issue mutations without chat session outside Cradle runtime', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"ok":true}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))

    await requestJson({
      method: 'post',
      path: {},
      query: {},
      serverUrl: 'http://localhost:21423',
      template: '/issues/issue-1/comments',
      body: { content: 'Hello' },
    })

    expect(fetchSpy).toHaveBeenCalledWith(new URL('http://localhost:21423/issues/issue-1/comments'), expect.objectContaining({
      headers: {
        'content-type': 'application/json',
      },
    }))
  })
})
