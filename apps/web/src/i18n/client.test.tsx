import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useTranslation } from 'react-i18next'
import { afterEach, describe, expect, it } from 'vitest'

import { I18nProvider } from './client'
import { useI18n } from './i18n-context'
import { LOCALE_COOKIE } from './locales'

afterEach(() => {
  cleanup()
  document.cookie = `${LOCALE_COOKIE}=;path=/;max-age=0`
  document.documentElement.lang = ''
  document.documentElement.dir = ''
})

function LocaleProbe() {
  const { t } = useTranslation('settings')
  const { switchLang } = useI18n()

  return (
    <div>
      <p data-testid="language-label">{t('appearance.language.label')}</p>
      <button type="button" onClick={() => void switchLang('zh-CN')}>Switch</button>
    </div>
  )
}

describe('i18nProvider', () => {
  it('changes language, writes cookie, and updates html attributes', async () => {
    render(
      <I18nProvider initialLocale="en-US">
        <LocaleProbe />
      </I18nProvider>,
    )

    expect((await screen.findByTestId('language-label')).textContent).toBe('Language')

    fireEvent.click(screen.getByText('Switch'))

    await waitFor(() => {
      expect(screen.getByTestId('language-label').textContent).toBe('语言')
    })
    expect(document.cookie).toContain(`${LOCALE_COOKIE}=zh-CN`)
    expect(document.documentElement.lang).toBe('zh-CN')
    expect(document.documentElement.dir).toBe('ltr')
  })
})
