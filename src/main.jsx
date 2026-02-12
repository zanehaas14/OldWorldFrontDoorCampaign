import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { runLaunchVerification } from './bootstrap'

// Run unit verification in background on launch
runLaunchVerification().catch(() => {})

const root = document.getElementById('root')
if (root) {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )
}
