import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Backend } from '../services/backend'
import { AppError } from '../services/backend'
import { getBackend } from '../services'
import type { Role, Session } from '../lib/types'

/* ------------------------------------------------------------ toasts */

export interface Toast {
  id: number
  title: string
  body?: string
  tone?: 'info' | 'good' | 'bad'
  code?: string
}

interface Ctx {
  backend: Backend
  session: Session | null
  sessionLoading: boolean
  refreshSession: () => Promise<void>
  toasts: Toast[]
  toast: (t: Omit<Toast, 'id'>) => void
  dismiss: (id: number) => void
  demoSms: { phone: string; code: string } | null
  setDemoSms: (v: { phone: string; code: string } | null) => void
  /** demo only: stands in for an email provider (password-reset links) */
  demoEmail: { to: string; subject: string; link: string } | null
  setDemoEmail: (v: { to: string; subject: string; link: string } | null) => void
}

const AppCtx = createContext<Ctx>(null!)

export function AppProvider({ children }: { children: ReactNode }) {
  const backend = useMemo(() => getBackend(), [])
  const [session, setSession] = useState<Session | null>(null)
  const [sessionLoading, setLoading] = useState(true)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [demoSms, setDemoSms] = useState<{ phone: string; code: string } | null>(null)
  const [demoEmail, setDemoEmail] = useState<{ to: string; subject: string; link: string } | null>(null)
  const seq = useRef(0)

  const refreshSession = useCallback(async () => {
    try {
      setSession(await backend.getSession())
    } catch {
      setSession(null)
    } finally {
      setLoading(false)
    }
  }, [backend])

  useEffect(() => {
    refreshSession()
    return backend.subscribe(() => void refreshSession())
  }, [backend, refreshSession])

  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), [])
  const toast = useCallback(
    (t: Omit<Toast, 'id'>) => {
      const id = ++seq.current
      setToasts((x) => [...x.slice(-3), { ...t, id }])
      setTimeout(() => dismiss(id), t.tone === 'bad' ? 7000 : 4500)
    },
    [dismiss],
  )

  return (
    <AppCtx.Provider value={{ backend, session, sessionLoading, refreshSession, toasts, toast, dismiss, demoSms, setDemoSms, demoEmail, setDemoEmail }}>
      {children}
    </AppCtx.Provider>
  )
}

export const useApp = () => useContext(AppCtx)
export const useBackend = () => useContext(AppCtx).backend

export function useSession() {
  const { session, sessionLoading, refreshSession, backend } = useApp()
  const hasRole = useCallback((r: Role) => !!session?.roles.some((x) => x.role === r), [session])
  const signOut = useCallback(async () => {
    await backend.signOut()
    await refreshSession()
  }, [backend, refreshSession])
  return { session, loading: sessionLoading, hasRole, signOut, refresh: refreshSession }
}

/* ------------------------------------------------------------ data hooks */

export function errorMessage(e: unknown) {
  if (e instanceof AppError) return e.message
  if (e instanceof Error) return e.message
  return 'Something went wrong.'
}

/**
 * Loads data from the backend, re-fetches on backend change events (realtime / cross-tab)
 * and optionally polls. Exposes the last successful update time for "updated x ago" labels.
 */
export function useData<T>(fn: (b: Backend) => Promise<T>, deps: unknown[], opts: { poll?: number; enabled?: boolean } = {}) {
  const backend = useBackend()
  const [data, setData] = useState<T | undefined>(undefined)
  const [error, setError] = useState<AppError | Error | null>(null)
  const [loading, setLoading] = useState(true)
  const [updatedAt, setUpdatedAt] = useState<number | null>(null)
  const fnRef = useRef(fn)
  fnRef.current = fn
  const enabled = opts.enabled ?? true

  const load = useCallback(async () => {
    if (!enabled) return
    try {
      const d = await fnRef.current(backend)
      setData(d)
      setError(null)
      setUpdatedAt(Date.now())
    } catch (e) {
      setError(e as Error)
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backend, enabled, ...deps])

  useEffect(() => {
    setLoading(true)
    load()
    const unsub = backend.subscribe(() => void load())
    const t = opts.poll ? setInterval(load, opts.poll) : undefined
    return () => {
      unsub()
      if (t) clearInterval(t)
    }
  }, [load, backend, opts.poll])

  return { data, error, loading, reload: load, updatedAt }
}

/** Wraps a mutation with busy state and error/success toasts. */
export function useAction() {
  const { toast } = useApp()
  const [busy, setBusy] = useState<string | null>(null)
  const run = useCallback(
    async <T,>(key: string, fn: () => Promise<T>, success?: string): Promise<{ ok: true; value: T } | { ok: false; error: string }> => {
      setBusy(key)
      try {
        const value = await fn()
        if (success) toast({ title: success, tone: 'good' })
        return { ok: true, value }
      } catch (e) {
        toast({ title: 'Could not complete that', body: errorMessage(e), tone: 'bad' })
        return { ok: false, error: errorMessage(e) }
      } finally {
        setBusy(null)
      }
    },
    [toast],
  )
  return { run, busy }
}

/* ------------------------------------------------------------ motion / 3D preferences */

export function useReducedMotion() {
  const [reduced, setReduced] = useState(() => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  useEffect(() => {
    const m = window.matchMedia('(prefers-reduced-motion: reduce)')
    const on = () => setReduced(m.matches)
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [])
  return reduced
}

let webglCache: boolean | undefined
export function hasWebGL() {
  if (webglCache !== undefined) return webglCache
  try {
    const c = document.createElement('canvas')
    webglCache = !!(c.getContext('webgl2') || c.getContext('webgl'))
  } catch {
    webglCache = false
  }
  return webglCache
}

function lowPowerDevice() {
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } }
  if (nav.connection?.saveData) return true
  return (nav.hardwareConcurrency ?? 8) <= 2 || (nav.deviceMemory ?? 8) <= 2
}

const PREF_KEY = 'kindroute.3d'
const prefListeners = new Set<() => void>()

/** Decides whether to render WebGL scenes. Users can override in the footer. */
export function use3DPreference() {
  const reduced = useReducedMotion()
  const [pref, setPrefState] = useState<'auto' | 'on' | 'off'>(() => {
    try {
      return (localStorage.getItem(PREF_KEY) as 'on' | 'off' | null) ?? 'auto'
    } catch {
      return 'auto'
    }
  })
  useEffect(() => {
    const f = () => {
      try {
        setPrefState((localStorage.getItem(PREF_KEY) as 'on' | 'off' | null) ?? 'auto')
      } catch {
        /* ignore */
      }
    }
    prefListeners.add(f)
    return () => void prefListeners.delete(f)
  }, [])
  const setPref = (v: 'auto' | 'on' | 'off') => {
    try {
      if (v === 'auto') localStorage.removeItem(PREF_KEY)
      else localStorage.setItem(PREF_KEY, v)
    } catch {
      /* ignore */
    }
    prefListeners.forEach((f) => f())
  }
  const webgl = typeof document !== 'undefined' && hasWebGL()
  const enabled = webgl && (pref === 'on' || (pref === 'auto' && !reduced && !lowPowerDevice()))
  return { enabled, webgl, reduced, pref, setPref }
}

export function useIsMobile() {
  const [m, setM] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768)
  useEffect(() => {
    const f = () => setM(window.innerWidth < 768)
    window.addEventListener('resize', f)
    return () => window.removeEventListener('resize', f)
  }, [])
  return m
}

export function useMedia(query: string) {
  const [m, setM] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches)
  useEffect(() => {
    const mq = window.matchMedia(query)
    const f = () => setM(mq.matches)
    f()
    mq.addEventListener('change', f)
    return () => mq.removeEventListener('change', f)
  }, [query])
  return m
}
