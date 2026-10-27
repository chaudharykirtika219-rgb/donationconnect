import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { AppProvider } from './state/app'
import { configError } from './services'
import './index.css'

function ConfigError({ message }: { message: string }) {
  return (
    <div className="grid min-h-screen place-items-center bg-ivory p-6">
      <div className="card max-w-lg p-8">
        <p className="eyebrow">Configuration needed</p>
        <h1 className="mt-3 font-display text-3xl text-forest">KindRoute can’t connect to its backend</h1>
        <p className="mt-4 text-[15px] text-charcoal-600">{message}</p>
        <p className="mt-4 text-[13.5px] text-charcoal-500">Fix <code>.env.local</code> and restart the dev server, or remove both Supabase variables to run the labelled demo. See README → “Connect Supabase”.</p>
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {configError ? (
      <ConfigError message={configError} />
    ) : (
      <BrowserRouter>
        <AppProvider>
          <App />
        </AppProvider>
      </BrowserRouter>
    )}
  </StrictMode>,
)
