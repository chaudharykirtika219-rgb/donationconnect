import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { KeyRound, Mail } from 'lucide-react'
import { Button, Field, Input, Notice } from '../components/ui'
import { LogoMark } from '../components/Logo'
import { errorMessage, useApp, useBackend, useSession } from '../state/app'
import { isEmail, passwordProblem } from '../lib/validation'

/**
 * Two states:
 *  - request: ask for an email, send a reset link (Supabase emails it; demo shows it in the labelled demo inbox)
 *  - update: arrived from the link (Supabase signs the user in with a recovery session; demo carries ?demo_token)
 */
export default function ResetPassword() {
  const [params] = useSearchParams()
  const demoToken = params.get('demo_token') ?? undefined
  const updating = !!demoToken || params.get('mode') === 'update'
  return (
    <div className="container-x py-12 sm:py-20">
      <div className="card mx-auto w-full max-w-md p-7 sm:p-9">
        <LogoMark />
        {updating ? <UpdateForm demoToken={demoToken} /> : <RequestForm />}
      </div>
    </div>
  )
}

function RequestForm() {
  const backend = useBackend()
  const { setDemoEmail } = useApp()
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!isEmail(email)) return setError('Enter a valid email address.')
    setBusy(true)
    try {
      const r = await backend.requestPasswordReset(email)
      if (r.demoLink) setDemoEmail({ to: email, subject: 'Reset your KindRoute password', link: r.demoLink })
      setSent(true)
    } catch (x) {
      setError(errorMessage(x))
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <h1 className="mt-6 font-display text-3xl text-forest">Reset your password</h1>
      {sent ? (
        <div className="mt-6"><Notice tone="good" icon={<Mail className="h-4 w-4" />} title="Check your inbox">If an account exists for <b>{email}</b>, we’ve sent a link to set a new password. It expires soon and works once.</Notice></div>
      ) : (
        <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
          <Field label="Email" required>{(id) => <Input id={id} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />}</Field>
          {error && <p className="text-[13px] font-semibold text-coral-700" role="alert">{error}</p>}
          <Button type="submit" size="lg" className="w-full" loading={busy}>Send reset link</Button>
        </form>
      )}
      <Link to="/login" className="mt-6 inline-block text-[13px] font-bold text-forest-400 hover:text-forest">Back to sign in</Link>
    </>
  )
}

function UpdateForm({ demoToken }: { demoToken?: string }) {
  const backend = useBackend()
  const { refreshSession, toast } = useApp()
  const { session, loading } = useSession()
  const nav = useNavigate()
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    const p = passwordProblem(pw)
    if (p) return setError(p)
    if (pw !== pw2) return setError('The two passwords don’t match.')
    setBusy(true)
    try {
      await backend.updatePassword(pw, demoToken)
      await refreshSession()
      toast({ title: 'Password updated', tone: 'good' })
      nav('/dashboard')
    } catch (x) {
      setError(errorMessage(x))
    } finally {
      setBusy(false)
    }
  }
  if (!demoToken && !loading && !session)
    return (
      <div className="mt-6"><Notice tone="bad" title="This link is invalid or has expired">Request a new reset link. <Link to="/reset-password" className="font-bold underline">Try again</Link></Notice></div>
    )
  return (
    <>
      <h1 className="mt-6 flex items-center gap-2 font-display text-3xl text-forest"><KeyRound className="h-6 w-6" /> Choose a new password</h1>
      <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
        <Field label="New password" required hint="At least 8 characters, letters and numbers.">{(id) => <Input id={id} type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" />}</Field>
        <Field label="Repeat new password" required>{(id) => <Input id={id} type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" />}</Field>
        {error && <p className="text-[13px] font-semibold text-coral-700" role="alert">{error}</p>}
        <Button type="submit" size="lg" className="w-full" loading={busy}>Save new password</Button>
      </form>
    </>
  )
}
