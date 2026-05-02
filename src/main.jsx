import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import ComingSoon from './ComingSoon'
import { initPWA } from './pwa'
import './index.css'

const PREVIEW_KEY = 'bc_preview_mode'
const PREVIEW_TOKEN = 'brasil2026'

function isPreviewMode() {
  try {
    const params = new URLSearchParams(window.location.search)
    const token = params.get('preview')
    if (token === 'off') { localStorage.removeItem(PREVIEW_KEY); return false }
    if (token === PREVIEW_TOKEN) { localStorage.setItem(PREVIEW_KEY, '1'); return true }
    return localStorage.getItem(PREVIEW_KEY) === '1'
  } catch (e) { return false }
}

initPWA()

const isPreview = isPreviewMode()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {isPreview ? <App /> : <ComingSoon />}
  </React.StrictMode>
)
