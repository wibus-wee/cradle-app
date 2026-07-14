import { Elysia } from 'elysia'

import { getOutboundNetworkStatus } from '../../lib/outbound-network'
import { PreferencesModel } from './model'
import * as Preferences from './service'

export const preferences = new Elysia({
  prefix: '/preferences',
  detail: { tags: ['preferences'] },
})
  .get('/app', () => Preferences.getAppPreferences(), {
    detail: {
      'summary': 'Get app preferences',
      'description': 'Read Cradle-owned application preferences and feature flags.',
      'x-cradle-cli': {
        command: ['preferences', 'app', 'get'],
      },
    },
    response: {
      200: PreferencesModel.appPreferences,
    },
  })
  .put(
    '/app',
    async ({ body }) => {
      await Preferences.setAppPreferences(body)
      return { ok: true as const }
    },
    {
      detail: {
        'summary': 'Set app preferences',
        'description': 'Persist Cradle-owned application preferences and feature flags.',
        'x-cradle-cli': {
          command: ['preferences', 'app', 'set'],
        },
      },
      body: PreferencesModel.appPreferences,
      response: {
        200: PreferencesModel.savedResponse,
      },
    },
  )
  .get('/chat', () => Preferences.getChatPreferences(), {
    detail: {
      'summary': 'Get chat preferences',
      'description': 'Read the server-owned default chat preferences.',
      'x-cradle-cli': {
        command: ['preferences', 'chat', 'get'],
      },
    },
    response: {
      200: PreferencesModel.chatPreferences,
    },
  })
  .get('/keybindings', () => Preferences.getKeybindingsPreferences(), {
    detail: {
      'summary': 'Get keybindings configuration',
      'description': 'Read the Cradle-owned keybindings.json file and report validation errors.',
      'x-cradle-cli': {
        command: ['preferences', 'keybindings', 'get'],
      },
    },
    response: {
      200: PreferencesModel.keybindingsPreferences,
    },
  })
  .put(
    '/chat',
    async ({ body }) => {
      await Preferences.setChatPreferences(body)
      return { ok: true as const }
    },
    {
      detail: {
        'summary': 'Set chat preferences',
        'description': 'Persist the server-owned default chat preferences.',
        'x-cradle-cli': {
          command: ['preferences', 'chat', 'set'],
        },
      },
      body: PreferencesModel.chatPreferencesUpdate,
      response: {
        200: PreferencesModel.savedResponse,
      },
    },
  )
  .get('/codex', () => Preferences.getCodexPreferences(), {
    detail: {
      'summary': 'Get Codex preferences',
      'description': 'Read Codex runtime preferences owned by Cradle.',
      'x-cradle-cli': {
        command: ['preferences', 'codex', 'get'],
      },
    },
    response: {
      200: PreferencesModel.codexPreferences,
    },
  })
  .put(
    '/codex',
    async ({ body }) => {
      await Preferences.setCodexPreferences(body)
      return { ok: true as const }
    },
    {
      detail: {
        'summary': 'Set Codex preferences',
        'description': 'Persist Codex runtime preferences owned by Cradle.',
        'x-cradle-cli': {
          command: ['preferences', 'codex', 'set'],
        },
      },
      body: PreferencesModel.codexPreferences,
      response: {
        200: PreferencesModel.savedResponse,
      },
    },
  )
  .get('/desktop', () => Preferences.getDesktopPreferences(), {
    detail: {
      'summary': 'Get desktop preferences',
      'description': 'Read Cradle Desktop runtime preferences.',
      'x-cradle-cli': {
        command: ['preferences', 'desktop', 'get'],
      },
    },
    response: {
      200: PreferencesModel.desktopPreferences,
    },
  })
  .put(
    '/desktop',
    async ({ body }) => {
      await Preferences.setDesktopPreferences(body)
      return { ok: true as const }
    },
    {
      detail: {
        'summary': 'Set desktop preferences',
        'description': 'Persist Cradle Desktop runtime preferences.',
        'x-cradle-cli': {
          command: ['preferences', 'desktop', 'set'],
        },
      },
      body: PreferencesModel.desktopPreferences,
      response: {
        200: PreferencesModel.savedResponse,
      },
    },
  )
  .get('/network', () => Preferences.getNetworkPreferences(), {
    detail: {
      summary: 'Get network access preferences',
      description: 'Read Cradle-owned outbound network proxy preferences.',
    },
    response: {
      200: PreferencesModel.networkPreferences,
    },
  })
  .put(
    '/network',
    async ({ body }) => {
      await Preferences.setNetworkPreferences(body)
      return { ok: true as const }
    },
    {
      detail: {
        summary: 'Set network access preferences',
        description: 'Persist Cradle-owned outbound network proxy preferences.',
      },
      body: PreferencesModel.networkPreferences,
      response: {
        200: PreferencesModel.savedResponse,
      },
    },
  )
  .get('/network/status', () => getOutboundNetworkStatus(), {
    detail: {
      summary: 'Get outbound network proxy status',
      description:
        'Resolve the currently effective Cradle outbound proxy source for new network requests.',
    },
    response: {
      200: PreferencesModel.networkProxyStatus,
    },
  })
  .get('/jarvis', () => Preferences.getJarvisPreferences(), {
    detail: {
      'summary': 'Get Jarvis preferences',
      'description': 'Read the system agent (Jarvis) configuration.',
      'x-cradle-cli': {
        command: ['preferences', 'jarvis', 'get'],
      },
    },
    response: {
      200: PreferencesModel.jarvisPreferences,
    },
  })
  .put(
    '/jarvis',
    async ({ body }) => {
      await Preferences.setJarvisPreferences(body)
      return { ok: true as const }
    },
    {
      detail: {
        'summary': 'Set Jarvis preferences',
        'description': 'Persist the system agent (Jarvis) provider and explicit model config.',
        'x-cradle-cli': {
          command: ['preferences', 'jarvis', 'set'],
        },
      },
      body: PreferencesModel.jarvisPreferences,
      response: {
        200: PreferencesModel.savedResponse,
      },
    },
  )
