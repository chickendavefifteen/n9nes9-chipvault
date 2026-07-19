import { Component, StrictMode, type ErrorInfo, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

class AppErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Chipvault startup failed', error, info)
  }

  render() {
    if (this.state.failed) {
      return <main className="boot-fallback" role="alert">
        <span>N9NES9 / CHIPVAULT</span>
        <h1>The tracker hit a browser error.</h1>
        <p>Your files are untouched. Reload the current build; if browser storage is blocked, the editor will continue in a temporary session.</p>
        <button onClick={() => window.location.reload()}>Reload tracker</button>
      </main>
    }
    return this.props.children
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary><App /></AppErrorBoundary>
  </StrictMode>,
)

document.documentElement.dataset.appReady = 'true'
