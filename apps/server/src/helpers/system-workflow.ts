import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

let _cache: string | null | undefined

export function getSystemWorkflow(): string | null {
  if (_cache !== undefined) {
    return _cache
  }
  const candidates = [
    resolve(process.cwd(), '../../../resources/system-workflow.md'),
    resolve(process.cwd(), '../../resources/system-workflow.md'),
    resolve(process.cwd(), '../resources/system-workflow.md'),
    resolve(process.cwd(), 'resources/system-workflow.md'),
  ]
  for (const p of candidates) {
    if (existsSync(p)) {
      _cache = readFileSync(p, 'utf-8')
      return _cache
    }
  }
  _cache = null
  return null
}
