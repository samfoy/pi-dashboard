import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Provider } from 'react-redux'
import { BrowserRouter } from 'react-router-dom'
import { store } from './store'
import App from './App'
import { initToken } from './api/auth'
import './index.css'

// Extract and store auth token from URL before any API calls
initToken()

// Detect standalone/Electron mode for macOS traffic light padding
const isElectron = navigator.userAgent.includes('Electron')
const isPiDashIOS = navigator.userAgent.includes('PiDash-iOS')

if (isElectron || isPiDashIOS) {
  document.documentElement.classList.add('is-standalone')
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Provider store={store}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </Provider>
  </StrictMode>,
)
