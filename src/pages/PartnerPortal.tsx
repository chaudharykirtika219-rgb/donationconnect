import { useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, ArrowRight, CalendarCheck, Clock, MapPin, Navigation, PackageCheck, PackageOpen, Phone, Route, ShieldAlert, Truck, Undo2 } from 'lucide-react'
import { PhotoInput, StatusPill, UpdatedLabel } from '../components/domain'
import { RequireAuth } from '../components/auth'
import { ItemsList } from '../components/DonationDetail'
import { Badge, Button, Checkbox, DemoTag, EmptyState, ErrorState, Field, Input, Modal, Notice, Select, Spinner, Tabs, Textarea, Toggle, btn } from '../components/ui'
import { CategoryIcon } from '../components/CategoryIcon'
import { useAction, useBackend, useData, useSession } from '../state/app'
import type { PartnerStep } from '../services/backend'
import type { DonationView, Vehicle } from '../lib/types'
import { VEHICLES, categoryById } from '../data/categories'
import { LOCALITIES } from '../data/localities'
import { cx, formatDate, timeAgo } from '../lib/format'

export default function PartnerPortal() {
  return (
    <RequireAuth title="Delivery partner portal" body="Sign in with your verified mobile number.">
      <Inner />
    </RequireAuth>
  )
}

function Inner() {
  const { session } = useSession()
  const { data, loading, error, reload } = useData((b) => b.getMyPartnerProfile(), [session?.user.id])
  if (loading && data === undefined) return <Spinner />
  if (error) return <div className="container-x py-16"><ErrorState error={error} onRetry={reload} /></div>
  if (!data) return <Apply />
  if (data.partner.status !== 'approved')
    return (
      <div className="container-x py-16">
        <div className="card mx-auto max-w-xl p-8 text-center">
          <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[#FCF1D9] text-[#7A5410]"><Clock className="h-6 w-6" /></span>
          <h1 className="mt-5 font-display text-3xl text-forest">Application {data.partner.status.replace('_', ' ')}</h1>
          <p className="mt-3 text-[14.5px] text-charcoal-600">{data.partner.status === 'pending' ? 'An administrator is reviewing your identity document. You’ll be notified when you can go online.' : data.partner.reviewNote ?? 'Contact support for details.'}</p>
          <ul className="mt-6 space-y-2 text-left">
            {data.docs.map((d) => <li key={d.id} className="flex items-center justify-between rounded-2xl bg-ivory p-3 text-[13.5px]"><span>{d.kind} · {d.fileName}</span><Badge tone={d.status === 'accepted' ? 'good' : d.status === 'rejected' ? 'bad' : 'waiting'}>{d.status}</Badge></li>)}
          </ul>
        </div>
      </div>
    )
  return <Dashboard available={data.partner.available} name={data.partner.fullName} vehicle={data.partner.vehicle} areas={data.partner.serviceLocalities} isDemo={data.partner.isDemo} />
}

function Dashboard({ available, name, vehicle, areas, isDemo }: { available: boolean; name: string; vehicle: Vehicle; areas: string[]; isDemo: boolean }) {
  const backend = useBackend()
  const { run, busy } = useAction()
  const [tab, setTab] = useState<'available' | 'mine' | 'history'>('available')
  const jobs = useData((b) => b.listAvailableJobs(), [available], { poll: 10_000 })
  const mine = useData((b) => b.listMyJobs(), [], { poll: 10_000 })
  const active = (mine.data ?? []).filter((v) => v.job?.state === 'claimed')
  const history = (mine.data ?? []).filter((v) => v.job?.state !== 'claimed')
  return (
    <div className="container-x pb-10 pt-8 sm:pt-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Delivery partner</p>
          <h1 className="display-md mt-3 text-forest">{name}</h1>
          <p className="mt-2 flex flex-wrap items-center gap-2 text-[13.5px] text-charcoal-500">{VEHICLES[vehicle]} · {areas.length ? areas.join(', ') : 'All of Pune'} {isDemo && <DemoTag label="Demo partner" />}</p>
        </div>
        <div className={cx('flex items-center gap-4 rounded-full border px-5 py-3', available ? 'border-forest/30 bg-sage-100' : 'border-forest/10 bg-white')}>
          <span className="text-[14px] font-bold text-forest">{available ? 'Online — receiving jobs' : 'Offline'}</span>
          <Toggle checked={available} onChange={(v) => run('av', () => backend.setAvailability(v), v ? 'You’re online' : 'You’re offline')} label="Availability" disabled={busy === 'av'} />
        </div>
      </div>
      <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
        <Tabs value={tab} onChange={setTab} tabs={[{ id: 'available', label: 'Available jobs', count: jobs.data?.length }, { id: 'mine', label: 'My active jobs', count: active.length }, { id: 'history', label: 'History', count: history.length }]} />
        <UpdatedLabel at={jobs.updatedAt} />
      </div>
      <div className="mt-6">
        {tab === 'available' && (!available ? <EmptyState icon={<Truck className="h-6 w-6" />} title="You’re offline" body="Go online to see jobs in your service area." /> : jobs.error ? <ErrorState error={jobs.error} onRetry={jobs.reload} /> : !jobs.data ? <Spinner /> : jobs.data.length ? (
          <div className="grid gap-4 md:grid-cols-2">
            {jobs.data.map((j) => (
              <div key={j.job.id} className="card p-5 sm:p-6">
                <div className="flex items-center justify-between gap-2"><span className="font-mono text-[12.5px] font-bold text-forest-400">{j.requestCode}</span><Badge tone="sage">{j.job.packageSize} package</Badge></div>
                <div className="mt-4 flex items-center gap-3 text-[15px] font-bold text-forest">
                  <span className="flex items-center gap-1.5"><MapPin className="h-4 w-4 text-coral-700" /> {j.pickupLocality}</span>
                  <ArrowRight className="h-4 w-4 text-charcoal-400" />
                  <span className="flex items-center gap-1.5"><Navigation className="h-4 w-4 text-forest-400" /> {j.destinationLocality}</span>
                </div>
                <p className="mt-1 text-[13px] text-charcoal-500">To {j.destinationName}</p>
                <div className="mt-4 flex flex-wrap gap-1.5">{j.categories.map((c) => <span key={c} className="chip pointer-events-none"><CategoryIcon id={c} className="h-3.5 w-3.5" /> {categoryById(c).short}</span>)}</div>
                <p className="mt-4 text-[13px] text-charcoal-600">{j.itemCount} units · preferred {formatDate(j.preferredDate)}, {j.preferredSlot}{j.approxKm != null && <> · ≈ {j.approxKm} km locality-to-locality</>}</p>
                <p className="mt-1 text-[12px] text-charcoal-400">Exact addresses and contact are shown after you accept. Travel time needs a mapping service (not configured).</p>
                <Button className="mt-5 w-full" loading={busy === j.job.id} onClick={() => run(j.job.id, () => backend.claimJob(j.job.id, j.job.version), 'Job accepted — it’s yours').then((r) => { if (r.ok) setTab('mine'); jobs.reload() })}>Accept job</Button>
              </div>
            ))}
          </div>
        ) : <EmptyState icon={<PackageOpen className="h-6 w-6" />} title="No open jobs right now" body="New jobs appear when an organisation accepts a donation in your area. This page refreshes automatically." />)}
        {tab === 'mine' && (active.length ? <div className="space-y-4">{active.map((v) => <ActiveJob key={v.request.id} v={v} />)}</div> : <EmptyState icon={<Route className="h-6 w-6" />} title="No active jobs" body="Accept an available job to get started." />)}
        {tab === 'history' && (history.length ? (
          <div className="space-y-2">{history.map((v) => (
            <div key={v.request.id} className="card flex flex-wrap items-center gap-3 p-4 text-[13.5px]"><span className="font-mono font-bold text-forest-400">{v.request.code}</span><span className="flex-1">{v.donor.locality ?? '—'} → {v.org.locality} · {v.org.name}</span><StatusPill status={v.request.status} /><span className="text-charcoal-400">{timeAgo(v.request.updatedAt)}</span></div>
          ))}</div>
        ) : <EmptyState title="No delivery history yet" />)}
      </div>
    </div>
  )
}

const NEXT: Partial<Record<string, { to: PartnerStep; label: string; icon: JSX.Element; proof?: 'optional' | 'required' }>> = {
  delivery_partner_assigned: { to: 'pickup_scheduled', label: 'Confirm pickup slot', icon: <CalendarCheck className="h-4 w-4" /> },
  pickup_scheduled: { to: 'picked_up', label: 'Confirm pickup', icon: <PackageCheck className="h-4 w-4" />, proof: 'optional' },
  picked_up: { to: 'in_transit', label: 'Start delivery', icon: <Truck className="h-4 w-4" /> },
  in_transit: { to: 'delivered_pending_receipt_confirmation', label: 'Confirm delivery', icon: <PackageCheck className="h-4 w-4" />, proof: 'required' },
}

function ActiveJob({ v }: { v: DonationView }) {
  const backend = useBackend()
  const { run, busy } = useAction()
  const [modal, setModal] = useState<null | 'proof' | 'release' | 'fail'>(null)
  const [note, setNote] = useState('')
  const [photo, setPhoto] = useState<string>()
  const r = v.request
  const step = NEXT[r.status]
  const close = () => { setModal(null); setNote(''); setPhoto(undefined) }
  const advance = async (to: PartnerStep, opts?: { note?: string; photo?: string }) => {
    const x = await run('adv', () => backend.partnerAdvance(r.id, to, opts), 'Status updated')
    if (x.ok) close()
  }
  return (
    <div className="card p-5 sm:p-6">
      <div className="flex flex-wrap items-center gap-2"><span className="font-mono text-[12.5px] font-bold text-forest-400">{r.code}</span><StatusPill status={r.status} /></div>
      <div className="mt-5 grid gap-6 lg:grid-cols-3">
        <div className="rounded-2xl bg-coral-100/50 p-4 text-[13.5px]">
          <p className="text-[11.5px] font-bold uppercase tracking-wider text-coral-700">Pickup</p>
          <p className="mt-1.5 font-bold text-forest">{v.donor.displayName}</p>
          {v.donor.address ? <p className="mt-1 text-charcoal-600">{v.donor.address.line1}{v.donor.address.landmark && `, ${v.donor.address.landmark}`}, {v.donor.address.locality} {v.donor.address.pinCode}</p> : <p className="mt-1 text-charcoal-500">{v.donor.locality}</p>}
          {v.donor.address?.instructions && <p className="mt-1 text-[12.5px] text-charcoal-500">Note: {v.donor.address.instructions}</p>}
          {v.donor.phone && <a href={`tel:${v.donor.phone}`} className="mt-2 inline-flex items-center gap-1.5 font-bold text-forest"><Phone className="h-3.5 w-3.5" /> {v.donor.phone}</a>}
          <p className="mt-2 text-[12.5px] text-charcoal-500">{formatDate(r.preferredDate)}, {r.preferredSlot}</p>
        </div>
        <div className="rounded-2xl bg-sage-100/60 p-4 text-[13.5px]">
          <p className="text-[11.5px] font-bold uppercase tracking-wider text-forest-400">Deliver to</p>
          <p className="mt-1.5 font-bold text-forest">{v.org.name}</p>
          {v.org.address && <p className="mt-1 text-charcoal-600">{v.org.address}</p>}
          {v.org.phone && <a href={`tel:${v.org.phone}`} className="mt-2 inline-flex items-center gap-1.5 font-bold text-forest"><Phone className="h-3.5 w-3.5" /> {v.org.phone}</a>}
        </div>
        <div><ItemsList view={v} /></div>
      </div>
      <Notice tone="info" icon={<ShieldAlert className="h-4 w-4" />}>Donor contact details are for this delivery only. They disappear from your view once the job ends. Never photograph residents or children.</Notice>
      <div className="mt-5 flex flex-wrap gap-2">
        {step && <Button icon={step.icon} loading={busy === 'adv' && !modal} onClick={() => (step.proof ? setModal('proof') : advance(step.to))}>{step.label}</Button>}
        {['delivery_partner_assigned', 'pickup_scheduled'].includes(r.status) && <Button variant="outline" icon={<Undo2 className="h-4 w-4" />} onClick={() => setModal('release')}>Release job</Button>}
        {['pickup_scheduled', 'picked_up', 'in_transit'].includes(r.status) && <Button variant="danger" icon={<AlertTriangle className="h-4 w-4" />} onClick={() => setModal('fail')}>Report a problem</Button>}
        <Link to={`/track/${r.code}`} className={btn('ghost')}>Timeline</Link>
      </div>

      <Modal open={modal === 'proof'} onClose={close} title={step?.to === 'picked_up' ? 'Confirm pickup' : 'Confirm delivery'}>
        <p className="mb-4 text-[14px] text-charcoal-600">{step?.proof === 'required' ? 'Delivery proof is required: add a photo of the handed-over items or the name of the staff member who received them.' : 'Optionally add a note or photo of the collected items.'}</p>
        <Field label={step?.proof === 'required' ? 'Received by (name / role)' : 'Note'}>{(id) => <Input id={id} value={note} onChange={(e) => setNote(e.target.value)} placeholder={step?.proof === 'required' ? 'e.g. Front-desk staff, Mrs. A.' : 'e.g. 2 bags collected'} />}</Field>
        <div className="mt-4"><PhotoInput value={photo} onChange={setPhoto} label="Proof photo" note="Items only — no people." /></div>
        <Button className="mt-5 w-full" loading={busy === 'adv'} onClick={() => advance(step!.to, { note: note || undefined, photo })}>Confirm</Button>
      </Modal>
      <Modal open={modal === 'release'} onClose={close} title="Release this job?">
        <p className="mb-4 text-[14px] text-charcoal-600">It goes back to the open job list for other partners. The donor is not charged or penalised.</p>
        <Field label="Reason" required>{(id) => <Textarea id={id} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
        <Button variant="danger" className="mt-5 w-full" loading={busy === 'rel'} onClick={async () => { const x = await run('rel', () => backend.releaseJob(r.id, note), 'Job released'); if (x.ok) close() }}>Release job</Button>
      </Modal>
      <Modal open={modal === 'fail'} onClose={close} title="Report a delivery problem">
        <p className="mb-4 text-[14px] text-charcoal-600">The request will be marked “failed — rescheduling required” and the donor, organisation and admins notified.</p>
        <Field label="What happened?" required>{(id) => <Textarea id={id} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Donor not reachable at pickup time" />}</Field>
        <Button variant="danger" className="mt-5 w-full" loading={busy === 'adv'} onClick={() => advance('failed', { note })}>Report problem</Button>
      </Modal>
    </div>
  )
}

function Apply() {
  const backend = useBackend()
  const { session } = useSession()
  const { run, busy } = useAction()
  const [fullName, setFullName] = useState(session?.user.fullName ?? '')
  const [vehicle, setVehicle] = useState<Vehicle>('two_wheeler')
  const [areas, setAreas] = useState<string[]>([])
  const [doc, setDoc] = useState<{ name: string; dataUrl: string } | null>(null)
  const [consent, setConsent] = useState(false)
  return (
    <div className="container-x pb-10 pt-8 sm:pt-12">
      <p className="eyebrow">Partner registration</p>
      <h1 className="display-md mt-3 text-forest">Become a delivery partner</h1>
      <p className="mt-3 max-w-2xl text-[15px] text-charcoal-600">Applications are reviewed by an administrator who checks your identity document. Until then you can’t see any donor details or jobs.</p>
      <form className="card mt-10 max-w-2xl space-y-5 p-6 sm:p-8" onSubmit={(e) => { e.preventDefault(); if (doc) run('apply', () => backend.applyAsPartner({ fullName, vehicle, serviceLocalities: areas, idDocument: doc, consent }), 'Application submitted') }}>
        <Field label="Full legal name (as on ID)" required>{(id) => <Input id={id} value={fullName} onChange={(e) => setFullName(e.target.value)} />}</Field>
        <Field label="Verified mobile">{(id) => <Input id={id} value={session?.user.phone ?? ''} disabled />}</Field>
        <Field label="Vehicle / transport" required>{(id) => <Select id={id} value={vehicle} onChange={(e) => setVehicle(e.target.value as Vehicle)}>{Object.entries(VEHICLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>}</Field>
        <div>
          <p className="mb-2 text-[13px] font-bold text-forest">Service area <span className="font-normal text-charcoal-500">— leave empty for all of Pune</span></p>
          <div className="flex flex-wrap gap-1.5">{LOCALITIES.map((l) => { const on = areas.includes(l.name); return <button type="button" key={l.name} onClick={() => setAreas(on ? areas.filter((x) => x !== l.name) : [...areas, l.name])} className={cx('chip', on && 'chip-on')}>{l.name}</button> })}</div>
        </div>
        <div>
          <p className="mb-2 text-[13px] font-bold text-forest">Government photo ID <span className="text-coral-700">*</span></p>
          <PhotoInput value={doc?.dataUrl} onChange={(v) => setDoc(v ? { name: 'id-photo.jpg', dataUrl: v } : null)} label="Upload ID photo" note="Aadhaar (masked), driving licence, voter ID or passport. Stored privately; deleted after 180 days unless renewed." />
        </div>
        <Checkbox checked={consent} onChange={setConsent}>I consent to identity verification, agree to the partner terms, and will use donor and organisation details only to complete assigned deliveries.</Checkbox>
        <Button type="submit" size="lg" disabled={!doc || !consent} loading={busy === 'apply'}>Submit application</Button>
      </form>
    </div>
  )
}
