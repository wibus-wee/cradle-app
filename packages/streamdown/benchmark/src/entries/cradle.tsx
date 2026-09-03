import '../../../src/styles/animations.css'
import '../../../src/styles/typography.css'

import { createRoot } from 'react-dom/client'

import { Streamdown } from '../../../src/streamdown'

createRoot(document.createElement('div')).render(<Streamdown content="# Bundle benchmark" />)
