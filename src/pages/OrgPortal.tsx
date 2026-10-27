import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AlertTriangle, Check, CheckCircle2, Clock, FileUp, Inbox, Pencil, Plus, RefreshCw, Trash2, X, ShieldCheck } from 'lucide-react'
import { PhotoInput, StatusPill, UpdatedLabel, NeedRow, readFileAsDataUrl, VerificationBadge } from '../components/domain'
import { RequireAuth } from '../components/auth'
import { ItemsList } from '../components/DonationDetail'
import { Badge, Button, Checkbox, DemoTag, EmptyState, ErrorState, Field, Input, Modal, Notice, Select, Spinner, Stat, Tabs, Textarea, btn } from '../components/ui'
import { CategoryIcon } from '../components/CategoryIcon'
import { useAction, useBackend, useData, useSession } from '../state/app'
import type { OrgWorkspace, OrgRegistration } from '../services/backend'
import { CATEGORIES, CONDITIONS, ORG_TYPES, UNITS, categoryById } from '../data/categories'
import { LOCALITIES, localityByName } from '../data/localities'
import type { Acceptance, ApprovalStatus, CategoryId, Condition, DeliveryMethod, DonationView, OrgItemPolicy, OrgNeed, OrgType, Unit, Urgency } from '../lib/types'
import { cx, formatDate, formatDateTime, timeAgo } from '../lib/format'
import { NEED_FRESHNESS_DAYS, policyAccepts } from '../lib/search'
import { fileProblem } from '../lib/validation'

export default function OrgPortal() {
  return (
    <RequireAuth title="Organisation portal" body="Sign in with the mobile number of an authorised staff member.">
      <Inner />
    </RequireAuth>
  )
}

function Inner() {
  const { session } = useSession()
  const { data: ws, loading, error, reload } = useData((b) => b.getMyOrganization(), [session?.user.id])
  if (loading && !ws) return <Spinner />
  if (error) return <div className="container-x py-16"><ErrorState error={error} onRetry={reload} /></div>
  if (!ws) return <Register />
  return <Workspace ws={ws} />
}

type Tab = 'requests' | 'needs' | 'items' | 'profile' | 'verification' | 'analytics'

function Workspace({ ws }: { ws: OrgWorkspace }) {
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') as Tab) || 'requests'
  const { data: reqs, updatedAt } = useData((b) => b.listOrgRequests(), [ws.org.id], { poll: 12_000 })
  const pending = (reqs ?? []).filter((v) => v.request.status === 'pending_organization_confirmation').length
  const toConfirm = (reqs ?? []).filter((v) => v.request.status === 'delivered_pending_receipt_confirmation').length
  return (
    <div className="container-x pb-10 pt-8 sm:pt-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Organisation portal</p>
          <h1 className="display-md mt-3 text-forest">{ws.org.name}</h1>
          <div className="mt-3 flex flex-wrap items-center gap-2"><VerificationBadge org={ws.org} />{ws.org.isDemo && <DemoTag />}<Badge>{ORG_TYPES[ws.org.type]} · {ws.org.locality}</Badge></div>
        </div>
        <div className="flex items-center gap-3"><UpdatedLabel at={updatedAt} />{ws.org.status === 'approved' && <Link to={`/org/${ws.org.slug}`} className={btn('outline', 'sm')}>View public profile</Link>}</div>
      </div>
      {ws.org.status !== 'approved' && <div className="mt-6"><VerificationStateNotice status={ws.org.status} note={ws.org.verificationNote} /></div>}
      <div className="mt-8">
        <Tabs value={tab} onChange={(t) => setParams(t === 'requests' ? {} : { tab: t })} tabs={[
          { id: 'requests', label: 'Incoming requests', count: pending + toConfirm },
          { id: 'needs', label: 'Current needs' },
          { id: 'items', label: 'Accepted items & rules' },
          { id: 'profile', label: 'Profile & delivery' },
          { id: 'verification', label: 'Verification' },
          { id: 'analytics', label: 'History & analytics' },
        ]} />
      </div>
      <div className="mt-8">
        {tab === 'requests' && <Requests reqs={reqs} approved={ws.org.status === 'approved'} />}
        {tab === 'needs' && <Needs ws={ws} />}
        {tab === 'items' && <Policies ws={ws} />}
        {tab === 'profile' && <ProfileEditor ws={ws} />}
        {tab === 'verification' && <Verification ws={ws} />}
        {tab === 'analytics' && <Analytics reqs={reqs ?? []} />}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------ requests */

function Requests({ reqs, approved }: { reqs?: DonationView[]; approved: boolean }) {
  const [filter, setFilter] = useState<'action' | 'active' | 'closed'>('action')
  if (!reqs) return <Spinner />
  const groups = {
    action: reqs.filter((v) => ['pending_organization_confirmation', 'delivered_pending_receipt_confirmation', 'failed'].includes(v.request.status)),
    active: reqs.filter((v) => ['organization_accepted', 'awaiting_delivery_partner', 'delivery_partner_assigned', 'pickup_scheduled', 'picked_up', 'in_transit'].includes(v.request.status)),
    closed: reqs.filter((v) => ['completed', 'rejected', 'cancelled'].includes(v.request.status)),
  }
  return (
    <div>
      <div className="mb-5 flex gap-2">
        {(['action', 'active', 'closed'] as const).map((k) => <button key={k} onClick={() => setFilter(k)} className={cx('chip', filter === k && 'chip-on')}>{k === 'action' ? 'Needs your action' : k === 'active' ? 'In progress' : 'Closed'} ({groups[k].length})</button>)}
      </div>
      {groups[filter].length ? <div className="space-y-4">{groups[filter].map((v) => <RequestCard key={v.request.id} v={v} approved={approved} />)}</div> : <EmptyState icon={<Inbox className="h-6 w-6" />} title="Nothing here" body={filter === 'action' ? 'New donation requests and deliveries to confirm will appear here.' : undefined} />}
    </div>
  )
}

function RequestCard({ v, approved }: { v: DonationView; approved: boolean }) {
  const backend = useBackend()
  const { run, busy } = useAction()
  const [modal, setModal] = useState<null | 'reject' | 'receipt' | 'notReceived'>(null)
  const [text, setText] = useState('')
  const [photo, setPhoto] = useState<string>()
  const r = v.request
  const close = () => { setModal(null); setText(''); setPhoto(undefined) }
  return (
    <div className="card p-5 sm:p-6">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[12.5px] font-bold text-forest-400">{r.code}</span>
        <StatusPill status={r.status} />
        {r.flagged && <Badge tone="bad" icon={<AlertTriangle className="h-3 w-3" />}>Held for admin review</Badge>}
        {r.isDemo && <DemoTag />}
        <span className="ml-auto text-[12px] text-charcoal-400">{timeAgo(r.createdAt)}</span>
      </div>
      <div className="mt-4 grid gap-6 lg:grid-cols-[1fr_280px]">
        <div>
          <p className="text-[14px] text-charcoal-600"><b className="text-forest">{v.donor.displayName}</b>{v.donor.locality && <> · {v.donor.locality}</>} · {r.deliveryMethod === 'partner_pickup' ? 'Partner pickup' : 'Donor drop-off'} · preferred {formatDate(r.preferredDate)}, {r.preferredSlot}</p>
          {r.notes && <p className="mt-2 rounded-2xl bg-ivory p-3 text-[13.5px] text-charcoal-600">“{r.notes}”</p>}
          <div className="mt-4"><ItemsList view={v} /></div>
        </div>
        <div className="flex flex-col gap-2">
          {r.status === 'pending_organization_confirmation' && (
            <>
              <Button disabled={!approved || !!r.flagged} loading={busy === 'acc'} icon={<Check className="h-4 w-4" />} onClick={() => run('acc', () => backend.orgDecide(r.id, 'accept'), r.deliveryMethod === 'partner_pickup' ? 'Accepted — now visible to delivery partners' : 'Accepted — donor will drop off')}>Accept</Button>
              <Button variant="danger" icon={<X className="h-4 w-4" />} onClick={() => setModal('reject')}>Decline</Button>
              {!approved && <p className="text-[12px] text-charcoal-500">Available once your organisation is verified.</p>}
              {r.flagged && <p className="text-[12px] text-charcoal-500">An administrator must review this request first ({r.flagged}).</p>}
            </>
          )}
          {r.status === 'delivered_pending_receipt_confirmation' && (
            <>
              <Button icon={<CheckCircle2 className="h-4 w-4" />} onClick={() => setModal('receipt')}>Confirm receipt</Button>
              <Button variant="danger" onClick={() => setModal('notReceived')}>Not received</Button>
            </>
          )}
          {r.status === 'failed' && r.deliveryMethod === 'partner_pickup' && <Button variant="outline" icon={<RefreshCw className="h-4 w-4" />} loading={busy === 're'} onClick={() => run('re', () => backend.orgReoffer(r.id), 'Re-offered to delivery partners')}>Re-offer to partners</Button>}
          {v.partner && <p className="text-[12.5px] text-charcoal-500">Partner: <b>{v.partner.displayName}</b>{v.partner.isDemo && ' (demo)'}</p>}
          <Link to={`/track/${r.code}`} className={btn('ghost', 'sm')}>Full timeline</Link>
        </div>
      </div>

      <Modal open={modal === 'reject'} onClose={close} title="Decline this request">
        <Field label="Reason shown to the donor" required>{(id) => <Textarea id={id} value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. We have enough winter clothes this month — thank you!" />}</Field>
        <Button variant="danger" className="mt-5 w-full" loading={busy === 'rej'} onClick={async () => { const x = await run('rej', () => backend.orgDecide(r.id, 'reject', text), 'Request declined'); if (x.ok) close() }}>Decline request</Button>
      </Modal>
      <Modal open={modal === 'receipt'} onClose={close} title="Confirm you received the items">
        <p className="mb-4 text-[14px] text-charcoal-600">This completes the donation and notifies the donor. Only confirm once the items are physically with you.</p>
        <Field label="Note (optional)">{(id) => <Textarea id={id} value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. 10 textbooks received, good condition" />}</Field>
        <div className="mt-4"><PhotoInput value={photo} onChange={setPhoto} label="Receipt photo" note="Photograph the items only — never residents or children." /></div>
        <Button className="mt-5 w-full" loading={busy === 'rec'} onClick={async () => { const x = await run('rec', () => backend.orgConfirmReceipt(r.id, text || undefined, photo), 'Receipt confirmed — donation completed'); if (x.ok) close() }}>Confirm receipt</Button>
      </Modal>
      <Modal open={modal === 'notReceived'} onClose={close} title="Items not received">
        <p className="mb-4 text-[14px] text-charcoal-600">This marks the delivery as failed and opens a dispute for an administrator to review.</p>
        <Field label="What happened?" required>{(id) => <Textarea id={id} value={text} onChange={(e) => setText(e.target.value)} />}</Field>
        <Button variant="danger" className="mt-5 w-full" loading={busy === 'nr'} onClick={async () => { const x = await run('nr', () => backend.orgReportNotReceived(r.id, text), 'Reported — an administrator will follow up'); if (x.ok) close() }}>Report</Button>
      </Modal>
    </div>
  )
}

/* ------------------------------------------------------------ needs */

function Needs({ ws }: { ws: OrgWorkspace }) {
  const backend = useBackend()
  const { run, busy } = useAction()
  const [editing, setEditing] = useState<Partial<OrgNeed> | null>(null)
  const accepted = ws.policies.filter(policyAccepts).map((p) => p.categoryId)
  const active = ws.needs.filter((n) => n.status === 'open')
  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-[14px] text-charcoal-600">Donors see when each need was last confirmed. Needs older than {NEED_FRESHNESS_DAYS} days are marked “may be outdated” — reconfirm regularly.</p>
        <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing({ categoryId: accepted[0], urgency: 'medium', tags: [] })} disabled={!accepted.length}>Add need</Button>
      </div>
      {active.length ? (
        <div className="grid gap-3 md:grid-cols-2">
          {active.map((n) => (
            <div key={n.id} className="card p-5">
              <NeedRow need={n} />
              {n.quantity != null && <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-forest/10"><div className="h-full rounded-full bg-forest" style={{ width: `${Math.min(100, (n.fulfilledQty / n.quantity) * 100)}%` }} /></div>}
              {n.quantity != null && <p className="mt-1 text-[12px] text-charcoal-500">{n.fulfilledQty} of {n.quantity} received via KindRoute</p>}
              <div className="mt-4 flex flex-wrap gap-2">
                <Button size="sm" variant="outline" loading={busy === n.id} icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => run(n.id, () => backend.confirmNeed(n.id), 'Need reconfirmed')}>Still needed</Button>
                <Button size="sm" variant="ghost" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => setEditing(n)}>Edit</Button>
                <Button size="sm" variant="ghost" icon={<CheckCircle2 className="h-3.5 w-3.5" />} loading={busy === 'ff' + n.id} onClick={() => run('ff' + n.id, () => backend.closeNeed(n.id, 'fulfilled'), 'Marked fulfilled — thank you!')}>Fulfilled</Button>
                <Button size="sm" variant="ghost" icon={<Trash2 className="h-3.5 w-3.5" />} loading={busy === 'rm' + n.id} onClick={() => run('rm' + n.id, () => backend.closeNeed(n.id, 'closed'), 'Need closed')}>Close</Button>
              </div>
            </div>
          ))}
        </div>
      ) : <EmptyState title="No current needs listed" body="Donors can still find you by your accepted items, but specific needs rank you higher in search." />}
      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? 'Edit need' : 'Add a need'}>
        {editing && (
          <form className="space-y-4" onSubmit={async (e) => { e.preventDefault(); const x = await run('save', () => backend.saveNeed({ ...editing, title: editing.title ?? '', categoryId: editing.categoryId!, urgency: editing.urgency ?? 'medium' }), 'Need saved'); if (x.ok) setEditing(null) }}>
            <Field label="Category">{(id) => <Select id={id} value={editing.categoryId} onChange={(e) => setEditing({ ...editing, categoryId: e.target.value as CategoryId })}>{accepted.map((c) => <option key={c} value={c}>{categoryById(c).label}</option>)}</Select>}</Field>
            <Field label="What do you need?" required>{(id) => <Input id={id} value={editing.title ?? ''} onChange={(e) => setEditing({ ...editing, title: e.target.value })} placeholder="e.g. Winter jackets, ages 8–14" />}</Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Quantity">{(id) => <Input id={id} type="number" min={1} value={editing.quantity ?? ''} onChange={(e) => setEditing({ ...editing, quantity: e.target.value ? Math.floor(+e.target.value) : undefined })} />}</Field>
              <Field label="Unit">{(id) => <Select id={id} value={editing.unit ?? ''} onChange={(e) => setEditing({ ...editing, unit: (e.target.value || undefined) as Unit | undefined })}><option value="">—</option>{Object.entries(UNITS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>}</Field>
              <Field label="Urgency">{(id) => <Select id={id} value={editing.urgency} onChange={(e) => setEditing({ ...editing, urgency: e.target.value as Urgency })}><option value="high">Urgent</option><option value="medium">Needed</option><option value="low">Welcome</option></Select>}</Field>
            </div>
            <Field label="Search tags" hint="Comma-separated, e.g. winter, kids, school">{(id) => <Input id={id} value={(editing.tags ?? []).join(', ')} onChange={(e) => setEditing({ ...editing, tags: e.target.value.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean) })} />}</Field>
            <Field label="Note for donors">{(id) => <Textarea id={id} value={editing.note ?? ''} onChange={(e) => setEditing({ ...editing, note: e.target.value })} />}</Field>
            <Button type="submit" className="w-full" loading={busy === 'save'}>Save need</Button>
          </form>
        )}
      </Modal>
    </div>
  )
}

/* ------------------------------------------------------------ policies */

const ACCEPTANCE_OPTIONS: Array<[Acceptance, string]> = [['accepts', 'Accepts'], ['temporarily_unavailable', 'Paused'], ['does_not_accept', 'No']]

const STATE_COPY: Partial<Record<ApprovalStatus, { tone: 'warn' | 'bad' | 'info'; title: string; body: string }>> = {
  pending: { tone: 'warn', title: 'Pending verification', body: 'Your profile is not public yet. Upload your registration certificate and an address proof under Verification. You can prepare needs and item rules meanwhile.' },
  under_review: { tone: 'info', title: 'Under review', body: 'An administrator is checking your documents, address and contact details. You will be notified of the decision.' },
  needs_info: { tone: 'warn', title: 'More information requested', body: 'An administrator needs more information — see the note and upload the requested document.' },
  rejected: { tone: 'bad', title: 'Verification not approved', body: 'Your organisation was not approved. Contact support if you believe this is a mistake.' },
  suspended: { tone: 'bad', title: 'Listing suspended', body: 'Your public listing is paused and you cannot receive new requests. Contact support.' },
}

function VerificationStateNotice({ status, note }: { status: ApprovalStatus; note?: string }) {
  const c = STATE_COPY[status] ?? STATE_COPY.pending!
  return (
    <Notice tone={c.tone} icon={<Clock className="h-4 w-4" />} title={c.title}>
      {c.body}
      {note && <span className="mt-1 block font-semibold">Reviewer note: {note}</span>}
    </Notice>
  )
}

function Policies({ ws }: { ws: OrgWorkspace }) {
  const backend = useBackend()
  const { run, busy } = useAction()
  return (
    <div className="space-y-3">
      <p className="mb-2 max-w-2xl text-[14px] text-charcoal-600">These rules are enforced when donors build a donation: items that don’t meet them are blocked with an explanation.</p>
      {CATEGORIES.map((c) => {
        const found = ws.policies.find((x) => x.categoryId === c.id)
        const p: Omit<OrgItemPolicy, 'id' | 'orgId'> = found ? (({ id: _i, orgId: _o, ...rest }) => rest)(found) : { categoryId: c.id, acceptance: 'does_not_accept', conditionsAccepted: ['new', 'like_new', 'gently_used'] }
        const save = (patch: Partial<typeof p>) => run(c.id, () => backend.savePolicy({ ...p, ...patch }), 'Rules saved')
        return (
          <div key={c.id} className={cx('card p-5', p.acceptance !== 'accepts' && 'opacity-80')}>
            <div className="flex flex-wrap items-center gap-3">
              <CategoryIcon id={c.id} className="h-5 w-5 text-forest" />
              <p className="flex-1 font-bold text-forest">{c.label}</p>
              <div role="radiogroup" aria-label={`${c.label} acceptance`} className="flex flex-wrap gap-1">
                {ACCEPTANCE_OPTIONS.map(([v, label]) => (
                  <button key={v} role="radio" aria-checked={p.acceptance === v} disabled={busy === c.id} onClick={() => p.acceptance !== v && save({ acceptance: v })} className={cx('chip', p.acceptance === v && 'chip-on')}>{label}</button>
                ))}
              </div>
            </div>
            {p.acceptance === 'temporarily_unavailable' && <p className="mt-3 text-[12.5px] text-charcoal-500">Shown to donors as “temporarily unavailable”. No new requests arrive for this category until you switch it back.</p>}
            {p.acceptance === 'accepts' && (
              <div className="mt-4 grid gap-4 border-t border-forest/10 pt-4 md:grid-cols-[1fr_1fr]">
                <div>
                  <p className="mb-2 text-[12.5px] font-bold text-charcoal-500">Accepted condition</p>
                  <div className="flex flex-wrap gap-1.5">
                    {(Object.keys(CONDITIONS) as Condition[]).map((k) => {
                      const on = p.conditionsAccepted.includes(k)
                      return <button key={k} onClick={() => save({ conditionsAccepted: on ? p.conditionsAccepted.filter((x) => x !== k) : [...p.conditionsAccepted, k] })} className={cx('chip', on && 'chip-on')}>{CONDITIONS[k]}</button>
                    })}
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {c.id === 'packaged_food' && <Field label="Min. shelf life (days)">{(id) => <Input id={id} type="number" min={0} defaultValue={p.minShelfLifeDays ?? ''} onBlur={(e) => save({ minShelfLifeDays: e.target.value ? +e.target.value : undefined })} />}</Field>}
                  {c.id === 'fresh_food' && <Field label="Max hours since prep">{(id) => <Input id={id} type="number" min={1} max={24} defaultValue={p.maxHoursSincePrep ?? ''} onBlur={(e) => save({ maxHoursSincePrep: e.target.value ? +e.target.value : undefined })} />}</Field>}
                  <Field label="Max. quantity per request" hint="Optional">{(id) => <Input id={id} type="number" min={1} defaultValue={p.quantityLimit ?? ''} onBlur={(e) => save({ quantityLimit: e.target.value ? Math.floor(+e.target.value) : undefined })} />}</Field>
                  <Field label="Restrictions / notes for donors" className={c.id.includes('food') ? 'sm:col-span-2' : ''}>{(id) => <Input id={id} defaultValue={p.notes ?? ''} onBlur={(e) => e.target.value !== (p.notes ?? '') && save({ notes: e.target.value || undefined })} />}</Field>
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

/* ------------------------------------------------------------ profile */

function ProfileEditor({ ws }: { ws: OrgWorkspace }) {
  const backend = useBackend()
  const { run, busy } = useAction()
  const o = ws.org
  const [f, setF] = useState({ intro: o.intro, publicPhone: o.publicPhone, publicEmail: o.publicEmail, website: o.website ?? '', dropoffHours: o.dropoffHours ?? '', conditionRules: o.conditionRules, restrictions: o.restrictions.join('\n'), pickupSlots: o.pickupSlots.join(', '), deliveryMethods: o.deliveryMethods, showImpact: o.showImpact })
  const toggleM = (m: DeliveryMethod) => setF({ ...f, deliveryMethods: f.deliveryMethods.includes(m) ? f.deliveryMethods.filter((x) => x !== m) : [...f.deliveryMethods, m] })
  return (
    <form className="grid gap-6 lg:grid-cols-2" onSubmit={(e) => { e.preventDefault(); run('prof', () => backend.updateMyOrganization({ ...f, website: f.website || undefined, dropoffHours: f.dropoffHours || undefined, restrictions: f.restrictions.split('\n').map((s) => s.trim()).filter(Boolean), pickupSlots: f.pickupSlots.split(',').map((s) => s.trim()).filter(Boolean) }), 'Profile updated') }}>
      <section className="card space-y-4 p-6">
        <h2 className="font-display text-xl text-forest">Public profile</h2>
        <Field label="Introduction" hint="Describe your work. Don’t include residents’ names or photos.">{(id) => <Textarea id={id} value={f.intro} onChange={(e) => setF({ ...f, intro: e.target.value })} />}</Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Public phone" hint="Changing contact details triggers re-verification.">{(id) => <Input id={id} value={f.publicPhone} onChange={(e) => setF({ ...f, publicPhone: e.target.value })} />}</Field>
          <Field label="Public email">{(id) => <Input id={id} value={f.publicEmail} onChange={(e) => setF({ ...f, publicEmail: e.target.value })} />}</Field>
        </div>
        <Field label="Website">{(id) => <Input id={id} value={f.website} onChange={(e) => setF({ ...f, website: e.target.value })} />}</Field>
        <Checkbox checked={f.showImpact} onChange={(v) => setF({ ...f, showImpact: v })}>Show aggregate donation counts on our public profile</Checkbox>
        <p className="text-[12px] text-charcoal-500">Name, address and registration details can only be changed by an administrator.</p>
      </section>
      <section className="card space-y-4 p-6">
        <h2 className="font-display text-xl text-forest">Delivery & rules</h2>
        <div className="flex flex-wrap gap-2">
          {(['partner_pickup', 'donor_dropoff'] as const).map((m) => <button type="button" key={m} onClick={() => toggleM(m)} className={cx('chip', f.deliveryMethods.includes(m) && 'chip-on')}>{m === 'partner_pickup' ? 'Partner pickup' : 'Donor drop-off'}</button>)}
        </div>
        <Field label="Drop-off hours">{(id) => <Input id={id} value={f.dropoffHours} onChange={(e) => setF({ ...f, dropoffHours: e.target.value })} placeholder="Mon–Sat, 10:00 – 17:00" />}</Field>
        <Field label="Preferred delivery windows" hint="Comma-separated">{(id) => <Input id={id} value={f.pickupSlots} onChange={(e) => setF({ ...f, pickupSlots: e.target.value })} />}</Field>
        <Field label="Condition requirements">{(id) => <Textarea id={id} value={f.conditionRules} onChange={(e) => setF({ ...f, conditionRules: e.target.value })} />}</Field>
        <Field label="Restrictions" hint="One per line">{(id) => <Textarea id={id} value={f.restrictions} onChange={(e) => setF({ ...f, restrictions: e.target.value })} />}</Field>
      </section>
      <div className="lg:col-span-2"><Button type="submit" size="lg" loading={busy === 'prof'}>Save changes</Button></div>
    </form>
  )
}

/* ------------------------------------------------------------ verification */

function Verification({ ws }: { ws: OrgWorkspace }) {
  const backend = useBackend()
  const { run, busy } = useAction()
  const [kind, setKind] = useState('Registration certificate')
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
      <section className="card p-6">
        <h2 className="font-display text-xl text-forest">Status</h2>
        <div className="mt-3"><VerificationBadge org={ws.org} /></div>
        <dl className="mt-5 space-y-2 text-[14px]">
          <div className="flex justify-between"><dt className="text-charcoal-500">Contact details</dt><dd>{ws.org.contactVerified ? <span className="flex items-center gap-1 font-semibold text-forest"><ShieldCheck className="h-4 w-4" /> Verified</span> : 'Not verified'}</dd></div>
          {ws.org.verifiedAt && <div className="flex justify-between"><dt className="text-charcoal-500">Verified on</dt><dd className="font-semibold">{formatDate(ws.org.verifiedAt)}</dd></div>}
          {ws.org.nextReviewDue && <div className="flex justify-between"><dt className="text-charcoal-500">Next review</dt><dd className="font-semibold">{formatDate(ws.org.nextReviewDue)}</dd></div>}
          <div className="flex justify-between"><dt className="text-charcoal-500">Registration</dt><dd className="font-semibold">{ws.org.registrationType} · {ws.org.registrationNumber}</dd></div>
        </dl>
        {ws.org.verificationNote && <p className="mt-4 rounded-2xl bg-ivory p-3 text-[13px] text-charcoal-600">{ws.org.verificationNote}</p>}
        <p className="mt-5 text-[12.5px] leading-relaxed text-charcoal-500">Uploading documents does not verify you automatically. An administrator reviews each document and checks your address and contact details, usually by phone or a visit.</p>
      </section>
      <section className="card p-6">
        <h2 className="font-display text-xl text-forest">Documents</h2>
        <ul className="mt-4 space-y-2">
          {ws.docs.map((d) => (
            <li key={d.id} className="flex items-center gap-3 rounded-2xl bg-ivory p-3 text-[13.5px]">
              <FileUp className="h-4 w-4 text-forest-400" />
              <span className="min-w-0 flex-1"><b className="block text-forest">{d.kind}</b><span className="text-[12px] text-charcoal-500">{d.fileName} · {formatDateTime(d.uploadedAt)} · retained until {formatDate(d.retainUntil)}</span>{d.reviewerNote && <span className="block text-[12px] text-charcoal-600">Reviewer: {d.reviewerNote}</span>}</span>
              <Badge tone={d.status === 'accepted' ? 'good' : d.status === 'rejected' ? 'bad' : 'waiting'}>{d.status}</Badge>
            </li>
          ))}
          {!ws.docs.length && <p className="text-[13.5px] text-charcoal-500">No documents uploaded yet.</p>}
        </ul>
        <div className="mt-5 space-y-3 border-t border-forest/10 pt-5">
          <Field label="Document type">{(id) => <Select id={id} value={kind} onChange={(e) => setKind(e.target.value)}>{['Registration certificate', 'Trust deed / MoA', '12A / 80G certificate', 'Address proof', 'Authorised signatory ID', 'Other'].map((k) => <option key={k}>{k}</option>)}</Select>}</Field>
          <label className={btn('outline', 'md', 'cursor-pointer')}>
            <FileUp className="h-4 w-4" /> {busy === 'doc' ? 'Uploading…' : 'Upload file'}
            <input type="file" accept="image/*,application/pdf" className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (!f) return; const problem = fileProblem(f, 'document', backend.mode === 'demo' ? 600_000 : undefined); if (problem) return alert(problem); const dataUrl = await readFileAsDataUrl(f); run('doc', () => backend.uploadOrgDocument(kind, { name: f.name, dataUrl }), 'Document uploaded for review') }} />
          </label>
          <p className="text-[12px] text-charcoal-500">Stored privately. Visible only to your staff and administrators. Deleted after the retention date.</p>
        </div>
      </section>
    </div>
  )
}

/* ------------------------------------------------------------ analytics */

function Analytics({ reqs }: { reqs: DonationView[] }) {
  const done = reqs.filter((v) => v.request.status === 'completed')
  const byCat = useMemo(() => {
    const m = new Map<CategoryId, number>()
    done.forEach((v) => v.items.forEach((i) => m.set(i.categoryId, (m.get(i.categoryId) ?? 0) + i.quantity)))
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [done])
  const max = Math.max(1, ...byCat.map(([, n]) => n))
  const decided = reqs.filter((v) => v.events.some((e) => e.to === 'organization_accepted' || e.to === 'rejected'))
  const acceptRate = decided.length ? Math.round((decided.filter((v) => v.events.some((e) => e.to === 'organization_accepted')).length / decided.length) * 100) : null
  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Requests received" value={reqs.length} />
        <Stat label="Completed" value={done.length} />
        <Stat label="Acceptance rate" value={acceptRate == null ? '—' : `${acceptRate}%`} />
        <Stat label="Items received" value={done.reduce((s, v) => s + v.items.reduce((a, i) => a + i.quantity, 0), 0)} />
      </div>
      <section className="card p-6">
        <h2 className="font-display text-xl text-forest">Items received by category</h2>
        {byCat.length ? (
          <ul className="mt-5 space-y-3">
            {byCat.map(([c, n]) => (
              <li key={c} className="grid grid-cols-[140px_1fr_48px] items-center gap-3 text-[13.5px]">
                <span className="flex items-center gap-2 font-semibold text-forest"><CategoryIcon id={c} className="h-4 w-4" /> {categoryById(c).short}</span>
                <span className="h-2.5 overflow-hidden rounded-full bg-forest/10"><span className="block h-full rounded-full bg-forest" style={{ width: `${(n / max) * 100}%` }} /></span>
                <span className="text-right font-bold text-forest">{n}</span>
              </li>
            ))}
          </ul>
        ) : <p className="mt-3 text-[14px] text-charcoal-500">No completed donations yet.</p>}
      </section>
      <section>
        <h2 className="mb-4 font-display text-xl text-forest">History</h2>
        <div className="overflow-x-auto rounded-3xl border border-forest/10 bg-white">
          <table className="w-full min-w-[640px] text-left text-[13.5px]">
            <thead className="bg-ivory text-[12px] uppercase tracking-wider text-charcoal-500"><tr><th className="px-4 py-3">Code</th><th className="px-4 py-3">Donor</th><th className="px-4 py-3">Items</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Updated</th></tr></thead>
            <tbody>
              {reqs.map((v) => (
                <tr key={v.request.id} className="border-t border-forest/10">
                  <td className="px-4 py-3 font-mono text-[12.5px]"><Link className="link-u" to={`/track/${v.request.code}`}>{v.request.code}</Link></td>
                  <td className="px-4 py-3">{v.donor.displayName}</td>
                  <td className="px-4 py-3">{v.items.map((i) => `${i.quantity} ${i.name}`).join(', ')}</td>
                  <td className="px-4 py-3"><StatusPill status={v.request.status} /></td>
                  <td className="px-4 py-3 text-charcoal-500">{timeAgo(v.request.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

/* ------------------------------------------------------------ registration */

function Register() {
  const backend = useBackend()
  const { refresh } = useSession()
  const { run, busy } = useAction()
  const [f, setF] = useState<OrgRegistration>({ name: '', type: 'children_home', intro: '', locality: '', address: '', pinCode: '', publicPhone: '', publicEmail: '', website: '', registrationType: 'Public charitable trust', registrationNumber: '', deliveryMethods: ['partner_pickup'], acceptedCategories: [] })
  const [ack, setAck] = useState(false)
  const set = (p: Partial<OrgRegistration>) => setF({ ...f, ...p })
  return (
    <div className="container-x pb-10 pt-8 sm:pt-12">
      <p className="eyebrow">Organisation onboarding</p>
      <h1 className="display-md mt-3 max-w-3xl text-forest">Register your organisation</h1>
      <p className="mt-3 max-w-2xl text-[15px] text-charcoal-600">After you register, upload your documents from the Verification tab. Your profile becomes public only after an administrator reviews your registration, address and contact details.</p>
      <form className="mt-10 grid gap-6 lg:grid-cols-2" onSubmit={async (e) => { e.preventDefault(); const r = await run('reg', () => backend.registerOrganization(f), 'Registered — next, upload your verification documents'); if (r.ok) refresh() }}>
        <section className="card space-y-4 p-6">
          <h2 className="font-display text-xl text-forest">Organisation</h2>
          <Field label="Registered name" required>{(id) => <Input id={id} value={f.name} onChange={(e) => set({ name: e.target.value })} />}</Field>
          <Field label="Type" required>{(id) => <Select id={id} value={f.type} onChange={(e) => set({ type: e.target.value as OrgType })}>{Object.entries(ORG_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>}</Field>
          <Field label="Short introduction">{(id) => <Textarea id={id} value={f.intro} onChange={(e) => set({ intro: e.target.value })} />}</Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Registration type" required>{(id) => <Select id={id} value={f.registrationType} onChange={(e) => set({ registrationType: e.target.value })}>{['Public charitable trust', 'Registered society', 'Section 8 company', 'Government-run', 'Other'].map((x) => <option key={x}>{x}</option>)}</Select>}</Field>
            <Field label="Registration number" required>{(id) => <Input id={id} value={f.registrationNumber} onChange={(e) => set({ registrationNumber: e.target.value })} />}</Field>
          </div>
        </section>
        <section className="card space-y-4 p-6">
          <h2 className="font-display text-xl text-forest">Location & contact</h2>
          <Field label="Full address" required hint="Shown publicly for drop-offs. For confidential shelters, enter a collection point instead.">{(id) => <Textarea id={id} value={f.address} onChange={(e) => set({ address: e.target.value })} className="min-h-[72px]" />}</Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Locality" required>{(id) => <Select id={id} value={f.locality} onChange={(e) => set({ locality: e.target.value, pinCode: f.pinCode || localityByName(e.target.value)?.pin || '' })}><option value="">Choose…</option>{LOCALITIES.map((l) => <option key={l.name}>{l.name}</option>)}</Select>}</Field>
            <Field label="PIN code" required>{(id) => <Input id={id} value={f.pinCode} onChange={(e) => set({ pinCode: e.target.value.replace(/\D/g, '').slice(0, 6) })} inputMode="numeric" />}</Field>
            <Field label="Public phone" required>{(id) => <Input id={id} value={f.publicPhone} onChange={(e) => set({ publicPhone: e.target.value })} inputMode="tel" />}</Field>
            <Field label="Public email" required>{(id) => <Input id={id} type="email" value={f.publicEmail} onChange={(e) => set({ publicEmail: e.target.value })} />}</Field>
          </div>
          <Field label="Website">{(id) => <Input id={id} value={f.website} onChange={(e) => set({ website: e.target.value })} />}</Field>
        </section>
        <section className="card space-y-4 p-6 lg:col-span-2">
          <h2 className="font-display text-xl text-forest">What you accept</h2>
          <div className="flex flex-wrap gap-1.5">
            {CATEGORIES.map((c) => { const on = f.acceptedCategories.includes(c.id); return <button type="button" key={c.id} onClick={() => set({ acceptedCategories: on ? f.acceptedCategories.filter((x) => x !== c.id) : [...f.acceptedCategories, c.id] })} className={cx('chip', on && 'chip-on')}><CategoryIcon id={c.id} className="h-3.5 w-3.5" /> {c.label}</button> })}
          </div>
          <div className="flex flex-wrap gap-2">
            {(['partner_pickup', 'donor_dropoff'] as const).map((m) => { const on = f.deliveryMethods.includes(m); return <button type="button" key={m} onClick={() => set({ deliveryMethods: on ? f.deliveryMethods.filter((x) => x !== m) : [...f.deliveryMethods, m] })} className={cx('chip', on && 'chip-on')}>{m === 'partner_pickup' ? 'Receive via delivery partners' : 'Accept donor drop-offs'}</button> })}
          </div>
          <Checkbox checked={ack} onChange={setAck}>I am authorised to represent this organisation. I understand KindRoute will verify our documents and contact details before listing us, and that we must never share residents’ personal information through the platform.</Checkbox>
          <Button type="submit" size="lg" disabled={!ack} loading={busy === 'reg'}>Submit registration</Button>
        </section>
      </form>
    </div>
  )
}
