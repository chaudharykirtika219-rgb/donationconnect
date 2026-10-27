import type { Backend } from './backend'
import { DemoBackend, browserStore } from './demoBackend'
import { SupabaseBackend } from './supabaseBackend'

const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim()
const anon = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim()

export const supabaseConfigured = !!(url && anon)

/** Set when Supabase variables are present but unusable — the app shows a configuration screen instead of crashing. */
export const configError: string | null = (() => {
  if (!url && !anon) return null
  if (!url || !anon) return 'Both VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set (or neither, for demo mode).'
  try {
    const u = new URL(url)
    if (!/^https?:$/.test(u.protocol)) return 'VITE_SUPABASE_URL must start with https://'
  } catch {
    return 'VITE_SUPABASE_URL is not a valid URL. It looks like https://<project-ref>.supabase.co'
  }
  // A service-role key in the browser would bypass every RLS policy. Refuse to start with one.
  try {
    const payload = JSON.parse(atob(anon.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    if (payload?.role === 'service_role') return 'VITE_SUPABASE_ANON_KEY contains a service-role key. Never ship it to the browser — use the anon / publishable key.'
  } catch {
    /* new-style publishable keys (sb_publishable_…) are not JWTs */
  }
  if (anon.startsWith('sb_secret_')) return 'VITE_SUPABASE_ANON_KEY contains a secret key. Use the publishable key instead.'
  return null
})()

let instance: Backend | undefined

/** Supabase when VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY are set and valid; otherwise the labelled demo backend. */
export function getBackend(): Backend {
  if (!instance) instance = supabaseConfigured && !configError ? new SupabaseBackend(url!, anon!) : new DemoBackend(browserStore(), { latencyMs: 180 })
  return instance
}

export const mapboxToken = (import.meta.env.VITE_MAPBOX_TOKEN as string | undefined) || undefined
