import { Elysia } from 'elysia'

import { DesktopModel } from './model'
import * as Desktop from './service'

export const desktop = new Elysia({
  prefix: '/desktop',
  detail: { tags: ['desktop'] },
})
  .get('/summary', () => Desktop.getDesktopSummary(), {
    detail: {
      summary: 'Get desktop summary facts',
    },
    response: { 200: DesktopModel.desktopSummary },
  })
  .get('/recent-sessions', () => Desktop.getDesktopRecentSessions(), {
    detail: {
      summary: 'Get desktop recent sessions',
    },
    response: { 200: DesktopModel.desktopRecentSessions },
  })
  .get('/health', () => Desktop.getDesktopHealth(), {
    detail: {
      summary: 'Get desktop health facts',
    },
    response: { 200: DesktopModel.desktopHealth },
  })
  .get('/awaits', () => Desktop.getDesktopAwaits(), {
    detail: {
      summary: 'Get desktop await facts',
    },
    response: { 200: DesktopModel.desktopAwaits },
  })
