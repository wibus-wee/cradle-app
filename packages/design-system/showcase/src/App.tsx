import { useLang } from './i18n'
import AntiPatterns from './sections/AntiPatterns'
import Background from './sections/Background'
import Color from './sections/Color'
import Components from './sections/Components'
import Decision from './sections/Decision'
import Footer from './sections/Footer'
import Hero from './sections/Hero'
import Manifesto from './sections/Manifesto'
import OutputSamples from './sections/OutputSamples'
import Snippets from './sections/Snippets'
import Spacing from './sections/Spacing'
import Typography from './sections/Typography'
import { useTheme } from './theme'

export default function App() {
  const { theme, toggle } = useTheme()
  const { lang, setLang } = useLang()

  return (
    <>
      <div className="toolbar">
        <button onClick={toggle} data-active={theme === 'dark' ? 'true' : undefined}>
          {theme === 'light' ? 'light' : 'dark'}
        </button>
        <div className="sep" />
        <button onClick={() => setLang(lang === 'en' ? 'zh' : 'en')} data-active={undefined}>
          {lang}
        </button>
      </div>

      <div className="page">
        <Hero lang={lang} />
        <OutputSamples lang={lang} />
        <Manifesto lang={lang} />
        <Color lang={lang} />
        <Typography lang={lang} />
        <Spacing lang={lang} />
        <Components lang={lang} />
        <Snippets lang={lang} />
        <AntiPatterns lang={lang} />
        <Decision lang={lang} />
        <Background lang={lang} />
        <Footer />
      </div>
    </>
  )
}
