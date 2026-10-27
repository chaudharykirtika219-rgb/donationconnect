import { Link } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { CheckCircle2, Copy, FlaskConical, Info, Mail, MessageSquare, RotateCcw, X, XCircle } from 'lucide-react'
import { Logo } from './Logo'
import { use3DPreference, useApp, useBackend } from '../state/app'
import { DemoBackend } from '../services/demoBackend'
import { cx } from '../lib/format'

export function DemoBanner() {
  const backend = useBackend()
  if (backend.mode !== 'demo') return null
  const reset = async () => {
    if (!confirm('Reset all demo data in this browser? Your demo donations and sign-in will be cleared.')) return
    await (backend as DemoBackend).resetDemoData()
    location.href = '/'
  }
  return (
    <div className="relative z-[51] bg-forest-900 text-ivory">
      <div className="container-x flex flex-wrap items-center justify-center gap-x-4 gap-y-1 py-2 text-center text-[12px]">
        <span className="inline-flex items-center gap-1.5 font-bold tracking-wide text-coral">
          <FlaskConical className="h-3.5 w-3.5" /> DEMO MODE
        </span>
        <span className="text-ivory/80"><span className="sm:hidden">Fictional sample data, stored in this browser.</span><span className="hidden sm:inline">All organisations, people and figures are fictional sample data stored only in this browser. No SMS, emails, payments or real pickups happen.</span></span>
        <button onClick={reset} className="inline-flex items-center gap-1 font-bold text-ivory underline-offset-2 hover:underline">
          <RotateCcw className="h-3 w-3" /> Reset demo
        </button>
      </div>
    </div>
  )
}

export function Toaster() {
  const { toasts, dismiss } = useApp()
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-3 bottom-4 z-[80] flex flex-col items-center gap-2 sm:inset-x-auto sm:right-5 sm:items-end">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div key={t.id} layout initial={{ opacity: 0, y: 16, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, x: 40 }} className="pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-3xl border border-forest/10 bg-white p-4 shadow-lift">
            {t.tone === 'good' ? <CheckCircle2 className="h-5 w-5 shrink-0 text-forest-400" /> : t.tone === 'bad' ? <XCircle className="h-5 w-5 shrink-0 text-coral-700" /> : <Info className="h-5 w-5 shrink-0 text-forest-400" />}
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-bold text-forest">{t.title}</p>
              {t.body && <p className="mt-0.5 text-[13px] text-charcoal-600">{t.body}</p>}
            </div>
            <button onClick={() => dismiss(t.id)} aria-label="Dismiss" className="text-charcoal-400 hover:text-charcoal">
              <X className="h-4 w-4" />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}

/** Demo-only stand-in for an SMS provider: shows the one-time code that would have been texted. */
export function DemoSmsInbox() {
  const { demoSms, setDemoSms } = useApp()
  return (
    <AnimatePresence>
      {demoSms && (
        <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="fixed left-1/2 top-3 z-[90] w-[min(92vw,380px)] -translate-x-1/2 rounded-3xl border border-white/20 bg-charcoal/95 p-4 text-ivory shadow-lift backdrop-blur" role="status">
          <div className="flex items-start gap-3">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-sage text-forest">
              <MessageSquare className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-coral">Demo SMS inbox · not sent</p>
              <p className="mt-1 text-[13.5px]">
                KindRoute code for {demoSms.phone}: <span className="font-mono text-lg font-bold tracking-[0.2em] text-white">{demoSms.code}</span>
              </p>
            </div>
            <button aria-label="Copy code" onClick={() => navigator.clipboard?.writeText(demoSms.code)} className="rounded-full p-1.5 text-ivory/70 hover:bg-white/10">
              <Copy className="h-4 w-4" />
            </button>
            <button aria-label="Dismiss" onClick={() => setDemoSms(null)} className="rounded-full p-1.5 text-ivory/70 hover:bg-white/10">
              <X className="h-4 w-4" />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/** Demo-only stand-in for an email provider: shows the password-reset link that would have been emailed. */
export function DemoEmailInbox() {
  const { demoEmail, setDemoEmail } = useApp()
  return (
    <AnimatePresence>
      {demoEmail && (
        <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="fixed left-1/2 top-3 z-[90] w-[min(92vw,400px)] -translate-x-1/2 rounded-3xl border border-white/20 bg-charcoal/95 p-4 text-ivory shadow-lift backdrop-blur" role="status">
          <div className="flex items-start gap-3">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-sage text-forest">
              <Mail className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-bold uppercase tracking-wider text-coral">Demo email inbox · not sent</p>
              <p className="mt-1 text-[13.5px]">To {demoEmail.to}: {demoEmail.subject}</p>
              <Link to={demoEmail.link} onClick={() => setDemoEmail(null)} className="mt-2 inline-block font-bold text-white underline underline-offset-2">Open reset link</Link>
            </div>
            <button aria-label="Dismiss" onClick={() => setDemoEmail(null)} className="rounded-full p-1.5 text-ivory/70 hover:bg-white/10">
              <X className="h-4 w-4" />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export function Footer() {
  const { pref, setPref, webgl } = use3DPreference()
  const cols = [
    { title: 'Donate', links: [['/explore', 'Explore needs'], ['/donate', 'Start a donation'], ['/guidelines', 'Item guidelines'], ['/experience', '3D donation story'], ['/dashboard', 'Track my donations']] },
    { title: 'Join', links: [['/for-organizations', 'For organisations'], ['/portal/organization', 'Organisation portal'], ['/become-a-partner', 'Become a delivery partner'], ['/portal/partner', 'Partner portal']] },
    { title: 'KindRoute', links: [['/about', 'About'], ['/how-it-works', 'How it works'], ['/faq', 'FAQ'], ['/contact', 'Contact & support'], ['/privacy', 'Privacy policy'], ['/terms', 'Terms & conditions']] },
  ]
  return (
    <footer className="relative mt-24 overflow-hidden bg-forest text-ivory">
      <div className="container-x relative py-16 lg:py-20">
        <div className="grid gap-12 lg:grid-cols-[1.3fr_2fr]">
          <div>
            <Logo light />
            <p className="mt-6 max-w-sm font-display text-[28px] leading-tight text-ivory/95">Useful things, routed to people who need them — across Pune.</p>
            <p className="mt-4 max-w-sm text-[13.5px] leading-relaxed text-ivory/60">KindRoute is a donation-coordination platform. We do not take custody of goods or money; organisations confirm every request and receipt.</p>
          </div>
          <div className="grid grid-cols-2 gap-8 sm:grid-cols-3">
            {cols.map((c) => (
              <div key={c.title}>
                <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-sage">{c.title}</p>
                <ul className="mt-4 space-y-2.5">
                  {c.links.map(([to, label]) => (
                    <li key={to}>
                      <Link to={to} className="text-[14px] text-ivory/80 transition hover:text-white">
                        {label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
        <div className="mt-14 flex flex-col gap-4 border-t border-ivory/10 pt-6 text-[12.5px] text-ivory/55 sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} KindRoute (provisional name) · Pune, Maharashtra</p>
          <div className="flex items-center gap-2">
            <span>3D scenes:</span>
            {(['auto', 'on', 'off'] as const).map((v) => (
              <button key={v} disabled={v === 'on' && !webgl} onClick={() => setPref(v)} className={cx('rounded-full px-2.5 py-1 font-bold capitalize transition disabled:opacity-40', pref === v ? 'bg-ivory text-forest' : 'text-ivory/70 hover:bg-white/10')}>
                {v}
              </button>
            ))}
          </div>
        </div>
      </div>
    </footer>
  )
}
