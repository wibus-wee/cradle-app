import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { z } from 'zod'

// --- Schemas ---

const ChannelBindingSchema = z.object({
  channelId: z.string(),
  boundAt: z.string(),
  boundBy: z.string(), // Slack user ID
})

const StoreSchema = z.object({
  channelBinding: ChannelBindingSchema.nullable(),
})

const StoreJsonSchema = z.string().transform(raw => JSON.parse(raw)).pipe(StoreSchema)

export type ChannelBinding = z.infer<typeof ChannelBindingSchema>
export type Store = z.infer<typeof StoreSchema>

// --- Persistence ---

function getDataDir(): string {
  const dir = process.env.ZHI_DATA_DIR || join(homedir(), '.zhi-slack-bridge')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

function getStorePath(): string {
  return join(getDataDir(), 'store.json')
}

function loadStore(): Store {
  const path = getStorePath()
  if (!existsSync(path)) {
    return { channelBinding: null }
  }
  return StoreJsonSchema.parse(readFileSync(path, 'utf-8'))
}

function saveStore(store: Store): void {
  const path = getStorePath()
  writeFileSync(path, JSON.stringify(store, null, 2), 'utf-8')
}

// --- Store API ---

export class BridgeStore {
  private store: Store

  constructor() {
    this.store = loadStore()
  }

  private persist(): void {
    saveStore(this.store)
  }

  // Channel binding

  getChannelBinding(): ChannelBinding | null {
    return this.store.channelBinding
  }

  setChannelBinding(channelId: string, userId: string): void {
    this.store.channelBinding = {
      channelId,
      boundAt: new Date().toISOString(),
      boundBy: userId,
    }
    this.persist()
  }

  clearChannelBinding(): void {
    this.store.channelBinding = null
    this.persist()
  }
}
