import { DEFAULT_LOCALE } from '../../src/i18n/locales'
import { allNamespaces } from '../../src/locales/default'
import { defaultNamespaceEntries, localeNamespacePath, nonDefaultLocales, pathExists, readJson, resolveFromWebRoot, writeJson } from './utils'

for (const namespace of allNamespaces) {
  const baselinePath = resolveFromWebRoot(localeNamespacePath(DEFAULT_LOCALE, namespace))
  const previousBaseline = (await pathExists(baselinePath)) ? await readJson(baselinePath) : {}
  const nextBaseline = defaultNamespaceEntries(namespace)

  const changedKeys = Object.keys(nextBaseline).filter((key) => {
    return typeof previousBaseline[key] === 'string' && previousBaseline[key] !== nextBaseline[key]
  })

  if (changedKeys.length === 0) {
    continue
  }

  for (const locale of nonDefaultLocales()) {
    const localePath = resolveFromWebRoot(localeNamespacePath(locale, namespace))
    if (!(await pathExists(localePath))) {
      continue
    }

    const translations = await readJson(localePath)
    let changed = false
    for (const key of changedKeys) {
      if (key in translations) {
        delete translations[key]
        changed = true
      }
    }

    if (changed) {
      await writeJson(localePath, translations)
    }
  }
}
