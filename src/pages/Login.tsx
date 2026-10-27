import { useState } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { Building2, ChevronRight, HeartHandshake, Shield, Truck } from 'lucide-react'
import { AuthPanel } from '../components/auth'
import { DemoTag, Notice } from '../components/ui'
import { useBackend, useSession } from '../state/app'
import { DEMO_ACCOUNTS } from '../data/seed'
import { LogoMark } from '../components/Logo'
import { cx } from '../lib/format'

const ICON = { donor: HeartHandshake, org_staff: Building2, delivery_partner: Truck, admin: Shield } as const

/** What the new user intends to do. This only chooses where we send them next — it never grants a role. */
type Intent = 'donor' | 'organization' | 'partner'
const INTENTS: Array<{ id: Intent; label: string; next: string; note: string }> = [
  { id: 'donor', label: 'Donate items', next: '/dashboard', note: 'Start donating right away.' },
  { id: 'organization', label: 'Register an organisation', next: '/portal/organization', note: 'You’ll submit details and documents; an administrator verifies them before you can receive donations.' },
  { id: 'partner', label: 'Become a delivery partner', next: '/portal/partner', note: 'You’ll apply with an ID; jobs unlock only after an administrator approves you.' },
]

const safeNext = (n: string | null) => (n && n.startsWith('/') && !n.startsWith('//') ? n : null)

export default function Login() {
  const [params] = useSearchParams()
  const next = safeNext(params.get('next'))
  const signup = params.get('mode') === 'signup'
  const [intent, setIntent] = useState<Intent>((['donor', 'organization', 'partner'] as const).find((x) => x === params.get('as')) ?? 'donor')
  const nav = useNavigate()
  const backend = useBackend()
  const { session } = useSession()
  const [preset, setPreset] = useState<{ phone: string; key: number } | null>(null)
  const [justDone, setJustDone] = useState(false)

  const destination = (role?: string) => {
    if (next) return next
    if (signup) return INTENTS.find((i) => i.id === intent)!.next
    return role === 'org_staff' ? '/portal/organization' : role === 'delivery_partner' ? '/portal/partner' : role === 'admin' ? '/admin' : '/dashboard'
  }
  const chosenRole = DEMO_ACCOUNTS.find((a) => preset && a.phone.endsWith(preset.phone))?.role
  if (session && !preset && !justDone) return <Navigate to={destination()} replace />

  return (
    <div className="container-x grid gap-10 py-12 sm:py-20 lg:grid-cols-2">
      <div className="card mx-auto w-full max-w-md p-7 sm:p-9 lg:mx-0 lg:justify-self-end">
        <LogoMark />
        <h1 className="mt-6 font-display text-3xl text-forest">{signup ? 'Create your account' : 'Welcome back'}</h1>
        <p className="mt-2 text-[14.5px] text-charcoal-600">Every new account starts as a donor. Organisation and delivery-partner access is granted only after an administrator verifies you.</p>
        {signup && (
          <fieldset className="mt-6">
            <legend className="mb-2 text-[13px] font-bold text-forest">I want to…</legend>
            <div className="grid gap-2">
              {INTENTS.map((i) => (
                <label key={i.id} className={cx('flex cursor-pointer items-start gap-3 rounded-2xl border bg-white p-3 text-[13.5px] transition', intent === i.id ? 'border-forest ring-2 ring-forest/10' : 'border-forest/10')}>
                  <input type="radio" name="intent" className="mt-1 accent-forest" checked={intent === i.id} onChange={() => setIntent(i.id)} />
                  <span><b className="block text-forest">{i.label}</b><span className="text-[12.5px] text-charcoal-500">{i.note}</span></span>
                </label>
              ))}
            </div>
          </fieldset>
        )}
        <div className="mt-7">
          <AuthPanel
            key={signup ? 'up' : 'in'}
            initialMode={signup ? 'signup' : 'signin'}
            phonePreset={preset}
            redirectPath={destination()}
            onDone={() => { setJustDone(true); nav(destination(chosenRole)) }}
          />
        </div>
      </div>

      {backend.mode === 'demo' ? (
        <div className="mx-auto w-full max-w-md lg:mx-0">
          <div className="flex items-center gap-2"><h2 className="font-display text-2xl text-forest">Demo accounts</h2><DemoTag /></div>
          <p className="mt-2 text-[14px] text-charcoal-600">Fictional people using unassignable 00000 numbers. Picking one still goes through the code step — the code appears in the demo SMS inbox at the top of the screen.</p>
          <ul className="mt-6 space-y-2">
            {DEMO_ACCOUNTS.map((a) => {
              const I = ICON[a.role]
              const local = a.phone.slice(3)
              return (
                <li key={a.id}>
                  <button onClick={() => setPreset({ phone: local, key: Date.now() })} className="card flex w-full items-center gap-4 p-4 text-left transition hover:-translate-y-0.5 hover:shadow-lift">
                    <span className="grid h-11 w-11 place-items-center rounded-2xl bg-sage-100 text-forest"><I className="h-5 w-5" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[14.5px] font-bold text-forest">{a.label}</span>
                      <span className="block truncate text-[12.5px] text-charcoal-500">{a.name} · {a.note}</span>
                    </span>
                    <span className="font-mono text-[12px] text-charcoal-400">{local.replace(/(\d{5})(\d{5})/, '$1 $2')}</span>
                    <ChevronRight className="h-4 w-4 text-charcoal-400" />
                  </button>
                </li>
              )
            })}
          </ul>
          <div className="mt-6"><Notice tone="info">Roles come from the backend’s role table, not from this list — picking “Administrator” here only works because that demo account was seeded with the admin role.</Notice></div>
        </div>
      ) : (
        <div className="mx-auto max-w-md space-y-4 lg:mx-0">
          <Notice tone="info" title="Organisations and delivery partners">Create an account, then register from the Organisation or Partner portal. Access is enabled only after an administrator verifies your details.</Notice>
          <Notice tone="info" title="Administrators">Admin access is never available from sign-up. It is granted in the database by an existing administrator (see the README).</Notice>
        </div>
      )}
    </div>
  )
}
