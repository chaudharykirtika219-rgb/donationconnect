import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowRight, Camera, Check, Clock, Loader2, MapPin, Navigation, Search, ShieldAlert, ShieldCheck, Truck, Store, X, Circle } from 'lucide-react'
import type { CategoryId, DonationStatus, DonationView, OrgNeed, PublicOrganization, Urgency } from '../lib/types'
import { Badge, Button, DemoTag, Field, Input, btn } from './ui'
import { CategoryIcon, CATEGORY_TINT } from './CategoryIcon'
import { ORG_TYPES, UNITS, categoryById } from '../data/categories'
import { isVerificationCurrent, needIsStale, policyAccepts, STANDING_LABEL, suggest, type SearchResult, type Standing, type Suggestion } from '../lib/search'
import { DROPOFF_PATH, PARTNER_PATH, STATUS_META } from '../lib/status'
import { cx, formatDate, formatDateTime, timeAgo } from '../lib/format'
import { LOCALITIES } from '../data/localities'
import { useApp, useBackend, errorMessage } from '../state/app'
import { normalizePhone } from '../lib/validation'

/* ------------------------------------------------------------ verification */

export function VerificationBadge({ org, compact }: { org: Pick<PublicOrganization, 'status' | 'nextReviewDue' | 'verifiedAt' | 'isDemo'>; compact?: boolean }) {
  if (org.status !== 'approved') return <Badge tone="warn" icon={<ShieldAlert className="h-3 w-3" />}>Not verified</Badge>
  if (!isVerificationCurrent(org)) return <Badge tone="warn" icon={<ShieldAlert className="h-3 w-3" />}>Verification review due</Badge>
  return (
    <Badge tone="good" icon={<ShieldCheck className="h-3 w-3" />}>
      {org.isDemo ? 'Verified · demo review' : compact ? 'Verified' : `Verified ${org.verifiedAt ? formatDate(org.verifiedAt, { month: 'short', year: 'numeric' }) : ''}`}
    </Badge>
  )
}

const URG: Record<Urgency, { label: string; tone: 'bad' | 'warn' | 'sage' }> = {
  high: { label: 'Urgent', tone: 'bad' },
  medium: { label: 'Needed', tone: 'warn' },
  low: { label: 'Welcome', tone: 'sage' },
}

export function NeedRow({ need, compact }: { need: OrgNeed; compact?: boolean }) {
  const remaining = need.quantity != null ? Math.max(need.quantity - need.fulfilledQty, 0) : undefined
  const stale = needIsStale(need)
  return (
    <div className="flex items-start gap-3">
      <span className={cx('mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-xl', CATEGORY_TINT[need.categoryId].bg, CATEGORY_TINT[need.categoryId].fg)}>
        <CategoryIcon id={need.categoryId} className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <p className="text-[14px] font-semibold leading-snug text-charcoal">{need.title}</p>
          <Badge tone={URG[need.urgency].tone}>{URG[need.urgency].label}</Badge>
        </div>
        <p className={cx('mt-0.5 text-[12.5px]', stale ? 'font-semibold text-[#7A5410]' : 'text-charcoal-500')}>
          {remaining != null && need.unit && <>About {remaining} {UNITS[need.unit]} still needed · </>}
          {stale ? `Last confirmed ${timeAgo(need.lastConfirmedAt)} — may be outdated` : `Confirmed ${timeAgo(need.lastConfirmedAt)}`}
        </p>
        {!compact && need.note && <p className="mt-1 text-[12.5px] text-charcoal-500">{need.note}</p>}
      </div>
    </div>
  )
}

const STANDING_TONE: Record<Standing, 'good' | 'sage' | 'warn' | 'neutral'> = { currently_needed: 'good', generally_accepted: 'sage', temporarily_unavailable: 'warn', not_accepted: 'neutral' }

/** Per-category match labels: currently needed / generally accepted / temporarily unavailable / not accepted. */
export function StandingBadges({ standing }: { standing: Partial<Record<CategoryId, Standing>> }) {
  const entries = Object.entries(standing) as Array<[CategoryId, Standing]>
  if (!entries.length) return null
  return (
    <div className="mt-3 flex flex-wrap gap-1.5">
      {entries.map(([c, s]) => <Badge key={c} tone={STANDING_TONE[s]}>{categoryById(c).short}: {STANDING_LABEL[s]}</Badge>)}
    </div>
  )
}

/* ------------------------------------------------------------ organisation card */

export function OrgCard({ result, index = 0 }: { result: SearchResult; index?: number }) {
  const { org, matchedNeeds, distanceKm } = result
  const accepted = org.policies.filter(policyAccepts).map((p) => p.categoryId)
  const needs = (matchedNeeds.length ? matchedNeeds : org.needs).slice(0, 3)
  return (
    <motion.article initial={{ opacity: 0, y: 18 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '-40px' }} transition={{ duration: 0.5, delay: Math.min(index, 6) * 0.05, ease: [0.2, 0.7, 0.2, 1] }} className="card group relative flex flex-col p-5 transition-all duration-300 hover:-translate-y-1 hover:shadow-lift sm:p-6">
      <div className="flex flex-wrap items-center gap-2">
        <VerificationBadge org={org} compact />
        {org.isDemo && <DemoTag />}
      </div>
      <h3 className="mt-4 font-display text-[24px] leading-tight text-forest">
        <Link to={`/org/${org.slug}`} className="after:absolute after:inset-0 after:rounded-3xl">
          {org.name}
        </Link>
      </h3>
      <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-charcoal-500">
        <span className="font-semibold text-charcoal-600">{ORG_TYPES[org.type]}</span>
        <span className="inline-flex items-center gap-1">
          <MapPin className="h-3.5 w-3.5" /> {org.locality}
        </span>
        {distanceKm != null && <span title="Approximate, based on locality centre points">≈ {distanceKm.toFixed(1)} km</span>}
      </p>
      {result.reasons[0] && <p className="mt-3 text-[13px] font-semibold text-forest-400">{result.reasons[0]}</p>}
      <StandingBadges standing={result.standing} />

      <div className="mt-4 space-y-3 border-t border-forest/10 pt-4">
        {needs.length ? needs.map((n) => <NeedRow key={n.id} need={n} compact />) : <p className="text-[13px] text-charcoal-500">No specific needs listed right now — accepts the items below.</p>}
      </div>

      <div className="mt-auto pt-5">
        <div className="flex flex-wrap items-center gap-1.5">
          {accepted.map((c) => (
            <span key={c} title={`Accepts ${categoryById(c).label}`} className={cx('grid h-7 w-7 place-items-center rounded-lg', CATEGORY_TINT[c].bg, CATEGORY_TINT[c].fg)}>
              <CategoryIcon id={c} className="h-3.5 w-3.5" />
              <span className="sr-only">{categoryById(c).label}</span>
            </span>
          ))}
          <span className="ml-auto flex gap-1.5 text-[11.5px] font-bold text-charcoal-500">
            {org.deliveryMethods.includes('partner_pickup') && <span className="inline-flex items-center gap-1"><Truck className="h-3.5 w-3.5" /> Pickup</span>}
            {org.deliveryMethods.includes('donor_dropoff') && <span className="inline-flex items-center gap-1"><Store className="h-3.5 w-3.5" /> Drop-off</span>}
          </span>
        </div>
        <div className="relative z-10 mt-5 grid grid-cols-2 gap-2">
          <Link to={`/org/${org.slug}`} className={btn('outline', 'sm')}>View details</Link>
          <Link to={`/donate?org=${org.slug}${result.matchedNeeds[0] ? `&cat=${result.matchedNeeds[0].categoryId}` : ''}`} className={btn('primary', 'sm')}>Donate here</Link>
        </div>
      </div>
    </motion.article>
  )
}

/* ------------------------------------------------------------ status */

export function StatusPill({ status }: { status: DonationStatus }) {
  const m = STATUS_META[status]
  return (
    <Badge tone={m.tone === 'good' ? 'good' : m.tone === 'bad' ? 'bad' : m.tone === 'waiting' ? 'waiting' : m.tone === 'active' ? 'active' : 'neutral'}>
      {m.tone === 'waiting' && <span className="relative mr-0.5 flex h-1.5 w-1.5"><span className="animate-ring absolute inset-0 rounded-full bg-[#C9932E]" /><span className="relative h-1.5 w-1.5 rounded-full bg-[#C9932E]" /></span>}
      {m.label}
    </Badge>
  )
}

export function StatusTimeline({ view }: { view: DonationView }) {
  const r = view.request
  const path = r.deliveryMethod === 'donor_dropoff' ? DROPOFF_PATH : PARTNER_PATH
  const reached = new Map<DonationStatus, string>()
  view.events.forEach((e) => reached.set(e.to, e.at))
  const terminalBad = ['rejected', 'cancelled', 'failed'].includes(r.status)
  const currentIdx = path.indexOf(r.status)
  const lastGood = terminalBad ? Math.max(...path.map((s, i) => (reached.has(s) ? i : -1))) : currentIdx
  return (
    <ol className="relative">
      {path.map((s, i) => {
        const done = i < lastGood || (i === lastGood && (r.status === 'completed' || terminalBad))
        const current = !terminalBad && i === currentIdx && r.status !== 'completed'
        const at = reached.get(s)
        const ev = [...view.events].reverse().find((e) => e.to === s)
        return (
          <li key={s} className="relative flex gap-4 pb-6 last:pb-0">
            {i < path.length - 1 && <span className={cx('absolute left-[13px] top-7 h-[calc(100%-20px)] w-0.5', done ? 'bg-forest' : 'bg-forest/10')} aria-hidden />}
            <span className={cx('relative z-10 grid h-7 w-7 shrink-0 place-items-center rounded-full border-2 transition', done ? 'border-forest bg-forest text-ivory' : current ? 'border-coral-600 bg-white text-coral-700' : 'border-forest/15 bg-white text-transparent')}>
              {done ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : current ? <span className="relative flex h-2.5 w-2.5"><span className="animate-ring absolute inset-0 rounded-full bg-coral-600" /><span className="relative h-2.5 w-2.5 rounded-full bg-coral-600" /></span> : <Circle className="h-2 w-2" />}
            </span>
            <div className="min-w-0 pt-0.5">
              <p className={cx('text-[14.5px] font-bold', done || current ? 'text-forest' : 'text-charcoal-400')}>{STATUS_META[s].label}</p>
              {(current || (done && ev?.note)) && <p className="mt-0.5 text-[13px] leading-snug text-charcoal-500">{ev?.note && done ? `“${ev.note}”` : STATUS_META[s].explain}</p>}
              {at && <p className="mt-0.5 text-[12px] text-charcoal-400">{formatDateTime(at)}</p>}
            </div>
          </li>
        )
      })}
      {terminalBad && (
        <li className="relative mt-2 flex gap-4 rounded-2xl bg-coral-100/60 p-4">
          <X className="h-5 w-5 shrink-0 text-coral-700" />
          <div>
            <p className="text-[14.5px] font-bold text-coral-700">{STATUS_META[r.status].label}</p>
            <p className="mt-0.5 text-[13px] text-charcoal-600">{r.rejectionReason ?? r.cancelReason ?? r.failureReason ?? STATUS_META[r.status].explain}</p>
            {reached.get(r.status) && <p className="mt-0.5 text-[12px] text-charcoal-400">{formatDateTime(reached.get(r.status)!)}</p>}
          </div>
        </li>
      )}
    </ol>
  )
}

export function UpdatedLabel({ at }: { at: number | null }) {
  const [, tick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 10_000)
    return () => clearInterval(t)
  }, [])
  if (!at) return null
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] text-charcoal-500">
      <span className="h-1.5 w-1.5 rounded-full bg-forest-300" /> Updated {timeAgo(new Date(at).toISOString())}
    </span>
  )
}

/* ------------------------------------------------------------ search */

export function SearchBar({ initial = '', size = 'lg', onSearch, autoFocus, orgNames = [] }: { initial?: string; size?: 'lg' | 'md'; onSearch?: (q: string) => void; autoFocus?: boolean; orgNames?: { name: string; slug: string }[] }) {
  const [q, setQ] = useState(initial)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const nav = useNavigate()
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => setQ(initial), [initial])
  const items = useMemo(() => suggest(q, orgNames), [q, orgNames])

  const pick = (s: Suggestion) => {
    setOpen(false)
    if (s.kind === 'org') return nav(`/org/${s.value}`)
    if (s.kind === 'category') return onSearch ? (setQ(s.label), onSearch(s.label)) : nav(`/explore?cat=${s.value}`)
    const text = s.kind === 'locality' ? `near ${s.value}` : s.kind === 'orgType' ? s.label : s.value
    setQ(text)
    onSearch ? onSearch(text) : nav(`/explore?q=${encodeURIComponent(text)}`)
  }
  const submit = (e?: React.FormEvent) => {
    e?.preventDefault()
    if (active >= 0 && items[active]) return pick(items[active])
    setOpen(false)
    onSearch ? onSearch(q.trim()) : nav(`/explore?q=${encodeURIComponent(q.trim())}`)
  }
  useEffect(() => {
    const f = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false)
    document.addEventListener('mousedown', f)
    return () => document.removeEventListener('mousedown', f)
  }, [])

  return (
    <div ref={box} className="relative w-full">
      <form onSubmit={submit} role="search" className={cx('group relative flex items-center rounded-full border border-forest/15 bg-white shadow-soft transition focus-within:border-forest/40 focus-within:shadow-lift', size === 'lg' ? 'h-[68px] pl-6 pr-2' : 'h-14 pl-5 pr-1.5')}>
        <Search className={cx('shrink-0 text-forest-400', size === 'lg' ? 'h-6 w-6' : 'h-5 w-5')} aria-hidden />
        <input
          value={q}
          autoFocus={autoFocus}
          onChange={(e) => { setQ(e.target.value); setOpen(true); setActive(-1) }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, items.length - 1)) }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, -1)) }
            else if (e.key === 'Escape') setOpen(false)
          }}
          placeholder="What would you like to donate today?"
          aria-label="What would you like to donate today?"
          role="combobox"
          aria-expanded={open && items.length > 0}
          aria-controls="kr-suggest"
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? `kr-s-${active}` : undefined}
          className={cx('h-full min-w-0 flex-1 bg-transparent px-4 text-charcoal placeholder:text-charcoal-400 focus:outline-none', size === 'lg' ? 'text-[17px] sm:text-[19px]' : 'text-[16px]')}
        />
        {q && <button type="button" aria-label="Clear search" onClick={() => { setQ(''); onSearch?.('') }} className="mr-1 rounded-full p-2 text-charcoal-400 hover:bg-forest/5"><X className="h-4 w-4" /></button>}
        <button type="submit" className={btn('primary', size === 'lg' ? 'lg' : 'md', 'shrink-0 px-5 sm:px-7')}>
          <span className="hidden sm:inline">Find needs</span>
          <ArrowRight className="h-4 w-4 sm:hidden" aria-label="Search" />
        </button>
      </form>
      {open && items.length > 0 && (
        <ul id="kr-suggest" role="listbox" className="absolute inset-x-0 top-[calc(100%+8px)] z-30 overflow-hidden rounded-3xl border border-forest/10 bg-white p-2 shadow-lift">
          {!q && <li className="px-4 pb-1 pt-2 text-[11px] font-bold uppercase tracking-wider text-charcoal-400">Popular searches</li>}
          {items.map((s, i) => (
            <li key={s.label + s.kind} id={`kr-s-${i}`} role="option" aria-selected={active === i} onMouseDown={(e) => { e.preventDefault(); pick(s) }} onMouseEnter={() => setActive(i)} className={cx('flex cursor-pointer items-center justify-between gap-3 rounded-2xl px-4 py-3', active === i && 'bg-ivory')}>
              <span className="text-[15px] font-semibold text-charcoal">{s.label}</span>
              <span className="text-[12px] text-charcoal-400">{s.hint}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/* ------------------------------------------------------------ map */

/** Stylised locality map used when no map provider key is configured. */
export function LocalityMap({ lat, lng, label, precision, className }: { lat: number; lng: number; label: string; precision: 'exact' | 'locality'; className?: string }) {
  const bounds = { minLat: 18.44, maxLat: 18.66, minLng: 73.72, maxLng: 73.95 }
  const x = (v: number) => ((v - bounds.minLng) / (bounds.maxLng - bounds.minLng)) * 400
  const y = (v: number) => 260 - ((v - bounds.minLat) / (bounds.maxLat - bounds.minLat)) * 260
  return (
    <figure className={cx('overflow-hidden rounded-3xl border border-forest/10 bg-sage-100/60', className)}>
      <svg viewBox="0 0 400 260" className="h-auto w-full" role="img" aria-label={`Approximate location: ${label}, Pune`}>
        <defs>
          <pattern id="g" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M20 0H0V20" fill="none" stroke="#173D32" strokeOpacity=".06" /></pattern>
        </defs>
        <rect width="400" height="260" fill="url(#g)" />
        <path d="M-10 150 C 60 120, 110 170, 170 140 S 270 100, 330 130 S 400 120, 420 110" fill="none" stroke="#9fc3c7" strokeWidth="7" strokeLinecap="round" opacity=".7" />
        {LOCALITIES.map((l) => (
          <g key={l.name} opacity={l.name === label ? 1 : 0.55}>
            <circle cx={x(l.lng)} cy={y(l.lat)} r="2.5" fill="#173D32" />
            <text x={x(l.lng) + 5} y={y(l.lat) + 3} fontSize="8.5" fill="#252925" fontFamily="Manrope">{l.name}</text>
          </g>
        ))}
        <circle cx={x(lng)} cy={y(lat)} r={precision === 'locality' ? 22 : 8} fill="#EAA58D" opacity=".35" />
        <circle cx={x(lng)} cy={y(lat)} r="6" fill="#C9694B" stroke="#fff" strokeWidth="2" />
      </svg>
      <figcaption className="flex items-center gap-2 border-t border-forest/10 bg-white/60 px-4 py-2.5 text-[12px] text-charcoal-500">
        <Navigation className="h-3.5 w-3.5" />
        {precision === 'locality' ? `Approximate area: ${label}. Exact pin shared after confirmation.` : label}
        <span className="ml-auto hidden sm:inline">Map service not configured</span>
      </figcaption>
    </figure>
  )
}

/* ------------------------------------------------------------ OTP */

export function OtpForm({ onDone, askName = true, submitLabel = 'Verify & continue', defaultName = '', initialPhone = '', autoSend, signupName }: { onDone: () => void; askName?: boolean; submitLabel?: string; defaultName?: string; initialPhone?: string; autoSend?: boolean; signupName?: string }) {
  const backend = useBackend()
  const { setDemoSms, refreshSession } = useApp()
  const [phone, setPhone] = useState(initialPhone)
  const [name, setName] = useState(defaultName)
  const [code, setCode] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cooldown, setCooldown] = useState(0)
  useEffect(() => {
    if (!cooldown) return
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [cooldown])

  const send = async () => {
    setError(null)
    if (!normalizePhone(phone, backend.mode === 'demo')) return setError('Enter a valid 10-digit Indian mobile number.')
    setBusy(true)
    try {
      const r = await backend.requestOtp(phone)
      setSent(true)
      setCooldown(r.cooldownSec)
      if (r.demoCode) setDemoSms({ phone, code: r.demoCode })
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  const autoSent = useRef(false)
  useEffect(() => {
    // guard: StrictMode runs effects twice in development, which would trip the OTP cooldown
    if (autoSend && initialPhone && !autoSent.current) {
      autoSent.current = true
      void send()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const verify = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!/^\d{6}$/.test(code)) return setError('Enter the 6-digit code.')
    setBusy(true)
    try {
      await backend.verifyOtp(phone, code, askName ? { fullName: name } : signupName ? { fullName: signupName } : undefined)
      setDemoSms(null)
      await refreshSession()
      onDone()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={verify} className="space-y-4">
      {askName && (
        <Field label="Full name" hint="Needed if this is your first time. Never shown publicly.">
          {(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" placeholder="Your name" />}
        </Field>
      )}
      <Field label="Mobile number" required hint={backend.mode === 'demo' ? 'Demo: any 10-digit mobile works — no SMS is sent.' : 'We’ll text you a one-time code.'}>
        {(id) => (
          <div className="flex gap-2">
            <div className="relative flex-1">
              <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[15px] font-semibold text-charcoal-500">+91</span>
              <Input id={id} value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" autoComplete="tel-national" placeholder="98xxx xxxxx" className="pl-14" disabled={sent && busy} />
            </div>
            <Button type="button" variant={sent ? 'outline' : 'primary'} onClick={send} loading={busy && !sent} disabled={cooldown > 0}>
              {cooldown > 0 ? `${cooldown}s` : sent ? 'Resend' : 'Send code'}
            </Button>
          </div>
        )}
      </Field>
      {sent && (
        <Field label="6-digit code" required>
          {(id) => <Input id={id} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" placeholder="••••••" className="text-center font-mono text-xl tracking-[0.5em]" autoFocus />}
        </Field>
      )}
      {error && <p className="text-[13px] font-semibold text-coral-700" role="alert">{error}</p>}
      {sent && (
        <Button type="submit" size="lg" className="w-full" loading={busy}>
          {submitLabel}
        </Button>
      )}
    </form>
  )
}

/* ------------------------------------------------------------ photos */

/** Downscales an image to max 720px JPEG (~60–150 KB) before upload. Strips EXIF/location by re-encoding. */
export async function compressImage(file: File, max = 720, quality = 0.72): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Please choose an image file.')
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image()
      i.onload = () => res(i)
      i.onerror = () => rej(new Error('Could not read that image.'))
      i.src = url
    })
    const scale = Math.min(1, max / Math.max(img.width, img.height))
    const c = document.createElement('canvas')
    c.width = Math.round(img.width * scale)
    c.height = Math.round(img.height * scale)
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
    return c.toDataURL('image/jpeg', quality)
  } finally {
    URL.revokeObjectURL(url)
  }
}

export function PhotoInput({ value, onChange, label = 'Add photo', note }: { value?: string; onChange: (v?: string) => void; label?: string; note?: ReactNode }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const ref = useRef<HTMLInputElement>(null)
  return (
    <div>
      <div className="flex items-center gap-3">
        {value ? (
          <div className="relative">
            <img src={value} alt="Selected" className="h-16 w-16 rounded-2xl object-cover" />
            <button type="button" onClick={() => onChange(undefined)} aria-label="Remove photo" className="absolute -right-2 -top-2 grid h-6 w-6 place-items-center rounded-full bg-charcoal text-white"><X className="h-3 w-3" /></button>
          </div>
        ) : (
          <button type="button" onClick={() => ref.current?.click()} className="flex h-16 items-center gap-2 rounded-2xl border border-dashed border-forest/25 px-4 text-[13px] font-bold text-forest hover:bg-white">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />} {label}
          </button>
        )}
        <input ref={ref} type="file" accept="image/*" className="hidden" onChange={async (e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (!f) return
          setBusy(true); setErr(null)
          try { onChange(await compressImage(f)) } catch (x) { setErr((x as Error).message) } finally { setBusy(false) }
        }} />
        {note && <p className="text-[12px] leading-snug text-charcoal-500">{note}</p>}
      </div>
      {err && <p className="mt-1 text-[12px] font-semibold text-coral-700">{err}</p>}
    </div>
  )
}

/** Reads any small file (e.g. a PDF certificate) as a data URL for the demo backend. */
export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader()
    r.onload = () => res(r.result as string)
    r.onerror = () => rej(new Error('Could not read the file.'))
    r.readAsDataURL(file)
  })
}

/* ------------------------------------------------------------ guards */

export function PageHeader({ eyebrow, title, body, children }: { eyebrow: string; title: ReactNode; body?: ReactNode; children?: ReactNode }) {
  return (
    <div className="container-x pb-10 pt-10 sm:pt-16">
      <p className="eyebrow">{eyebrow}</p>
      <h1 className="display-lg mt-4 max-w-4xl text-balance text-forest">{title}</h1>
      {body && <p className="mt-5 max-w-2xl text-[17px] leading-relaxed text-charcoal-600">{body}</p>}
      {children}
    </div>
  )
}

export function ProofList({ view }: { view: DonationView }) {
  if (!view.proofs.length) return null
  return (
    <div className="space-y-3">
      {view.proofs.map((p) => (
        <div key={p.id} className="flex gap-3 rounded-2xl bg-ivory p-3">
          {p.photo ? <img src={p.photo} alt={`${p.kind} proof`} className="h-16 w-16 rounded-xl object-cover" /> : <div className="grid h-16 w-16 place-items-center rounded-xl bg-sage-100 text-forest"><Check className="h-5 w-5" /></div>}
          <div className="text-[13px]">
            <p className="font-bold capitalize text-forest">{p.kind} proof</p>
            {p.note && <p className="text-charcoal-600">“{p.note}”</p>}
            <p className="mt-0.5 flex items-center gap-1 text-[12px] text-charcoal-400"><Clock className="h-3 w-3" /> {formatDateTime(p.at)}</p>
          </div>
        </div>
      ))}
    </div>
  )
}
