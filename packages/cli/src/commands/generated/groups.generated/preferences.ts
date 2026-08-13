import type { Command } from 'commander'

import { register as registerPreferencesAppGet } from '../preferences/app/get'
import { register as registerPreferencesAppSet } from '../preferences/app/set'
import { register as registerPreferencesChatGet } from '../preferences/chat/get'
import { register as registerPreferencesChatSet } from '../preferences/chat/set'
import { register as registerPreferencesCodexGet } from '../preferences/codex/get'
import { register as registerPreferencesCodexSet } from '../preferences/codex/set'
import { register as registerPreferencesDesktopGet } from '../preferences/desktop/get'
import { register as registerPreferencesDesktopSet } from '../preferences/desktop/set'
import { register as registerPreferencesJarvisGet } from '../preferences/jarvis/get'
import { register as registerPreferencesJarvisSet } from '../preferences/jarvis/set'
import { register as registerPreferencesKeybindingsGet } from '../preferences/keybindings/get'

export function registerGeneratedCommands(program: Command): void {
  registerPreferencesAppGet(program)
  registerPreferencesAppSet(program)
  registerPreferencesChatGet(program)
  registerPreferencesChatSet(program)
  registerPreferencesCodexGet(program)
  registerPreferencesCodexSet(program)
  registerPreferencesDesktopGet(program)
  registerPreferencesDesktopSet(program)
  registerPreferencesJarvisGet(program)
  registerPreferencesJarvisSet(program)
  registerPreferencesKeybindingsGet(program)
}
