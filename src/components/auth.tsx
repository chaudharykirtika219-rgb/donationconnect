import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Eye, EyeOff, Mail, MessageSquareOff, Smartphone } from 'lucide-react'
import { Button, Field, Input, Notice } from './ui'
import { OtpForm } from './domain'
import { errorMessage, useApp, useBackend, useData, useSession } from '../state/app'
import { isEmail, normalizePhone, passwordProblem } from '../lib/validation'
import { cx } from '../lib/format'

export function useAuthCaps() {
  return useData((b) => b.getAuthCapabilities(), []).data
}

function PasswordInput({ id, value, onChange, autoComplete }: { id: string; value: string; onChange: (v: string) => void; autoComplete: string }) {
  const [show, setShow] = useState(false)
  return (
    <div className="relative">
      <Input id={id} type={show ? 'text' : 'password'} value={value} onChange={(e) => onChange(e.target.value)} autoComplete={autoComplete} className="pr-12" />
      <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'} className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1.5 text-charcoal-400 hover:text-forest">
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  )
}

/** Email + password sign-in or sign-up. New accounts are donors only; other roles come from approval flows. */
export function EmailAuthForm({ mode, onModeChange, onDone, redirectPath, knownName }: { mode: 'signin' | 'signup'; onModeChange: (m: 'signin' | 'signup') => void; onDone: () => void; redirectPath?: string; knownName?: string }) {
  const backend = useBackend()
  const { refreshSession } = useApp()
  const [typedName, setName] = useState('')
  const name = knownName ?? typedName
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmSent, setConfirmSent] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!isEmail(email)) return setError('Enter a valid email address.')
    if (mode === 'signup') {
      if (name.trim().length < 2) return setError(knownName !== undefined ? 'Enter your full name under “About you” first.' : 'Tell us your name.')
      const pw = passwordProblem(password)
      if (pw) return setError(pw)
    } else if (!password) return setError('Enter your password.')
    setBusy(true)
    try {
      if (mode === 'signup') {
        const r = await backend.signUpWithEmail({ email, password, fullName: name, redirectPath })
        if (r.needsEmailConfirmation) {
          setConfirmSent(email)
          return
        }
      } else await backend.signInWithEmail(email, password)
      await refreshSession()
      onDone()
    } catch (x) {
      setError(errorMessage(x))
    } finally {
      setBusy(false)
    }
  }

  if (confirmSent)
    return (
      <Notice tone="good" icon={<Mail className="h-4 w-4" />} title="Check your inbox">
        We sent a confirmation link to <b>{confirmSent}</b>. Your account is created but you can’t sign in until you open that link. It may take a minute — check spam too.
      </Notice>
    )

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {mode === 'signup' && knownName === undefined && <Field label="Full name" required hint="Never shown publicly.">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />}</Field>}
      <Field label="Email" required>{(id) => <Input id={id} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" inputMode="email" />}</Field>
      <Field label="Password" required hint={mode === 'signup' ? 'At least 8 characters, letters and numbers.' : undefined}>
        {(id) => <PasswordInput id={id} value={password} onChange={setPassword} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} />}
      </Field>
      {error && <p className="text-[13px] font-semibold text-coral-700" role="alert">{error}</p>}
      <Button type="submit" size="lg" className="w-full" loading={busy}>{mode === 'signup' ? 'Create account' : 'Sign in'}</Button>
      <div className="flex flex-wrap items-center justify-between gap-2 text-[13px]">
        <button type="button" onClick={() => { setError(null); onModeChange(mode === 'signup' ? 'signin' : 'signup') }} className="font-bold text-forest-400 hover:text-forest">
          {mode === 'signup' ? 'Already have an account? Sign in' : 'New here? Create an account'}
        </button>
        {mode === 'signin' && <Link to="/reset-password" className="font-bold text-charcoal-500 hover:text-forest">Forgot password?</Link>}
      </div>
    </form>
  )
}

/**
 * Sign-in / sign-up panel used by the login page, protected routes and the donation builder.
 * Phone OTP is only offered when it really works in this deployment (demo simulation or a configured SMS provider).
 */
export function AuthPanel({ onDone, initialMode = 'signin', phonePreset, redirectPath, signupName }: { onDone: () => void; initialMode?: 'signin' | 'signup'; phonePreset?: { phone: string; key: number } | null; redirectPath?: string; signupName?: string }) {
  const caps = useAuthCaps()
  const [method, setMethod] = useState<'email' | 'phone'>(phonePreset ? 'phone' : 'email')
  const [mode, setMode] = useState(initialMode)
  useEffect(() => {
    if (phonePreset) setMethod('phone')
  }, [phonePreset])
  return (
    <div>
      <div role="tablist" aria-label="Sign-in method" className="mb-6 grid grid-cols-2 gap-1 rounded-full bg-forest/5 p-1">
        {([['email', 'Email', Mail], ['phone', 'Mobile code', Smartphone]] as const).map(([k, label, I]) => (
          <button key={k} role="tab" type="button" aria-selected={method === k} onClick={() => setMethod(k)} className={cx('flex h-10 items-center justify-center gap-2 rounded-full text-[13.5px] font-bold transition', method === k ? 'bg-white text-forest shadow-soft' : 'text-charcoal-500 hover:text-forest')}>
            <I className="h-4 w-4" /> {label}
          </button>
        ))}
      </div>
      {method === 'email' ? (
        <EmailAuthForm mode={mode} onModeChange={setMode} onDone={onDone} redirectPath={redirectPath} knownName={signupName} />
      ) : !caps ? null : caps.phoneOtp ? (
        <OtpForm key={phonePreset?.key ?? 0} initialPhone={phonePreset?.phone} autoSend={!!phonePreset} onDone={onDone} askName={signupName === undefined} signupName={signupName || undefined} />
      ) : (
        <Notice tone="warn" icon={<MessageSquareOff className="h-4 w-4" />} title="Mobile sign-in is not configured">
          This deployment has no SMS provider connected, so one-time codes cannot be sent. Use email and password instead.
        </Notice>
      )}
    </div>
  )
}

/** Route guard for signed-in areas. UX only — every backend call is authorised again server-side (RLS / RPC checks). */
export function RequireAuth({ children, title = 'Sign in to continue', body }: { children: ReactNode; title?: string; body?: string }) {
  const { session, loading } = useSession()
  if (loading) return <div className="container-x py-24"><div className="mx-auto h-40 max-w-md animate-pulse rounded-4xl bg-forest/5" /></div>
  if (!session)
    return (
      <div className="container-x py-16 sm:py-24">
        <div className="card mx-auto max-w-md p-7 sm:p-9">
          <h1 className="font-display text-3xl text-forest">{title}</h1>
          <p className="mt-2 text-[14.5px] text-charcoal-600">{body ?? 'Sign in with your email or mobile number. We only use your details to coordinate donations.'}</p>
          <div className="mt-6"><AuthPanel onDone={() => undefined} /></div>
        </div>
      </div>
    )
  if (session.user.accountStatus === 'suspended')
    return (
      <div className="container-x py-16"><div className="mx-auto max-w-md"><Notice tone="bad" title="Account suspended">This account has been suspended by an administrator. Contact support if you think this is a mistake.</Notice></div></div>
    )
  return <>{children}</>
}

/** Adds and verifies a phone number on the signed-in account (Supabase: phone_change OTP). */
export function PhoneVerifyForm({ onDone, initialPhone = '' }: { onDone?: () => void; initialPhone?: string }) {
  const backend = useBackend()
  const caps = useAuthCaps()
  const { setDemoSms, refreshSession, toast } = useApp()
  const [phone, setPhone] = useState(initialPhone)
  const [code, setCode] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!cooldown) return
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [cooldown])

  if (caps && !caps.phoneOtp)
    return (
      <Notice tone="warn" icon={<MessageSquareOff className="h-4 w-4" />} title="Phone verification requires configuration">
        No SMS provider is connected to this deployment, so phone numbers cannot be verified yet. An administrator must configure one in Supabase Auth.
      </Notice>
    )

  const send = async () => {
    setError(null)
    if (!normalizePhone(phone, backend.mode === 'demo')) return setError('Enter a valid 10-digit Indian mobile number.')
    setBusy(true)
    try {
      const r = await backend.startPhoneVerification(phone)
      setSent(true)
      setCooldown(r.cooldownSec)
      if (r.demoCode) setDemoSms({ phone, code: r.demoCode })
    } catch (x) {
      setError(errorMessage(x))
    } finally {
      setBusy(false)
    }
  }
  const verify = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!/^\d{6}$/.test(code)) return setError('Enter the 6-digit code.')
    setBusy(true)
    try {
      await backend.confirmPhoneVerification(phone, code)
      setDemoSms(null)
      await refreshSession()
      toast({ title: 'Phone number verified', tone: 'good' })
      onDone?.()
    } catch (x) {
      setError(errorMessage(x))
    } finally {
      setBusy(false)
    }
  }
  return (
    <form onSubmit={verify} className="space-y-4">
      <Field label="Mobile number" required hint={caps?.phoneOtpSimulated ? 'Demo: no SMS is sent — the code appears on screen.' : 'We’ll text you a one-time code.'}>
        {(id) => (
          <div className="flex gap-2">
            <div className="relative flex-1">
              <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[15px] font-semibold text-charcoal-500">+91</span>
              <Input id={id} value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" autoComplete="tel-national" placeholder="98xxx xxxxx" className="pl-14" />
            </div>
            <Button type="button" variant={sent ? 'outline' : 'primary'} onClick={send} loading={busy && !sent} disabled={cooldown > 0}>{cooldown > 0 ? `${cooldown}s` : sent ? 'Resend' : 'Send code'}</Button>
          </div>
        )}
      </Field>
      {sent && <Field label="6-digit code" required>{(id) => <Input id={id} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" placeholder="••••••" className="text-center font-mono text-xl tracking-[0.5em]" autoFocus />}</Field>}
      {error && <p className="text-[13px] font-semibold text-coral-700" role="alert">{error}</p>}
      {sent && <Button type="submit" size="lg" className="w-full" loading={busy}>Verify number</Button>}
    </form>
  )
}
