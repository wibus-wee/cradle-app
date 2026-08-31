import AsyncStorage from '@react-native-async-storage/async-storage'

import type { UsageRange } from './usage-range'
import { usageRanges } from './usage-range'

const USAGE_RANGE_KEY = '@cradle/mobile/usage-range'

function isUsageRange(value: string | null): value is UsageRange {
  return usageRanges.some(range => range.key === value)
}

export async function loadUsageRange(): Promise<UsageRange> {
  try {
    const value = await AsyncStorage.getItem(USAGE_RANGE_KEY)
    return isUsageRange(value) ? value : '30d'
  }
  catch {
    return '30d'
  }
}

export async function persistUsageRange(range: UsageRange): Promise<void> {
  try {
    await AsyncStorage.setItem(USAGE_RANGE_KEY, range)
  }
  catch {
    // A display preference should not block Usage when device storage is unavailable.
  }
}
