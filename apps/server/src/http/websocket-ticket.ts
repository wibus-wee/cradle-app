import { createHash, randomBytes } from 'node:crypto'

const TICKET_TTL_MS = 30_000
const MAX_TICKETS = 1_024

interface TicketRecord {
  audience: string
  expiresAt: number
}

const tickets = new Map<string, TicketRecord>()

function digestTicket(ticket: string): string {
  return createHash('sha256').update(ticket).digest('base64url')
}

function pruneTickets(now: number): void {
  for (const [digest, record] of tickets) {
    if (record.expiresAt <= now) {
      tickets.delete(digest)
    }
  }
  while (tickets.size >= MAX_TICKETS) {
    const oldest = tickets.keys().next().value
    if (typeof oldest !== 'string') {
      break
    }
    tickets.delete(oldest)
  }
}

export function issueWebSocketTicket(audience: string, now = Date.now()): {
  ticket: string
  expiresAt: number
} {
  pruneTickets(now)
  const ticket = randomBytes(32).toString('base64url')
  const expiresAt = now + TICKET_TTL_MS
  tickets.set(digestTicket(ticket), { audience, expiresAt })
  return { ticket, expiresAt }
}

export function consumeWebSocketTicket(ticket: string, audience: string, now = Date.now()): boolean {
  const digest = digestTicket(ticket)
  const record = tickets.get(digest)
  tickets.delete(digest)
  return Boolean(record && record.expiresAt > now && record.audience === audience)
}

export function resetWebSocketTicketsForTests(): void {
  tickets.clear()
}
