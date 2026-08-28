import 'markstream-react/index.css'

import MarkdownRender from 'markstream-react'
import { createRoot } from 'react-dom/client'

createRoot(document.createElement('div')).render(<MarkdownRender content="# Bundle benchmark" />)
