import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Provider } from 'react-redux'
import { BrowserRouter } from 'react-router-dom'
import { store } from './store'
import App from './App'
import './index.css'

// Detect standalone/Electron mode for macOS traffic light padding
if (
  window.matchMedia('(display-mode: standalone)').matches ||
  (navigator as any).standalone ||
  navigator.userAgent.includes('Electron') ||
  (window as any).piDash
) {
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
