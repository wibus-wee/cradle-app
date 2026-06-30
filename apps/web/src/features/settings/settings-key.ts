import type settings from '~/locales/default/settings'

/**
 * The union of every settings-namespace i18n key.
 *
 * Resolved once from the typed default locale so consumers (settings rows,
 * the shortcuts catalog, the `Cmd+/` overlay) share a single source of truth
 * for key validity instead of re-deriving `keyof typeof import(...)`.
 */
export type SettingsKey = keyof typeof settings
