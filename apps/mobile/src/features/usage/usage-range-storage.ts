import AsyncStorage from '@react-native-async-storage/async-storage'

import type { UsageRange } from './usage-range'
import { DEFAULT_USAGE_RANGE, isUsageRange } from './usage-range'

const USAGE_RANGE_KEY = 'cradle.mobile.usage-range'

export async function loadUsageRange(): Promise<UsageRange> {
  try {
    const stored = await AsyncStorage.getItem(USAGE_RANGE_KEY)
    return isUsageRange(stored) ? stored : DEFAULT_USAGE_RANGE
  }
  catch {
    return DEFAULT_USAGE_RANGE
  }
}

export async function persistUsageRange(range: UsageRange): Promise<void> {
  try {
    await AsyncStorage.setItem(USAGE_RANGE_KEY, range)
  }
  catch {
    // Preferences are non-critical; the selected range still applies for this mount.
  }
}
