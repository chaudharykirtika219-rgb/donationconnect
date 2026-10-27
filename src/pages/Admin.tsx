import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AlertTriangle, Check, Database, Download, Eye, FileText, Flag, RotateCcw, ShieldAlert, Trash2, Upload, X } from 'lucide-react'
import { StatusPill, UpdatedLabel } from '../components/domain'
import { RequireAuth } from '../components/auth'
import { Badge, Button, Checkbox, DemoTag, EmptyState, ErrorState, Field, Input, Modal, Notice, Select, Spinner, Stat, Tabs, Textarea, Toggle } from '../components/ui'
import { errorMessage, useAction, useBackend, useData, useSession } from '../state/app'
import type { AdminOrgRow } from '../services/backend'
import type { ApprovalStatus, Category, DonationStatus, DonationView, ImportRow, VerificationDoc } from '../lib/types'
import { ORG_TYPES, VEHICLES, categoryById } from '../data/categories'
import { STATUS_META, TRANSITIONS } from '../lib/status'
import { cx, formatDate, formatDateTime, timeAgo } from '../lib/format'

export default function Admin() {
  return (
    <RequireAuth title="Administrator sign-in">
      <Gate />
    </RequireAuth>
  )
}

function Gate() {
  const { hasRole } = useSession()
  if (!hasRole('admin'))
    return (
      <div className="container-x py-16">
        <EmptyState icon={<ShieldAlert className="h-6 w-6" />} title="Administrators only" body="Your account doesn’t have the admin role. Roles are granted server-side and can’t be selected from the app." />
      </div>
    )
  return <Inner />
}

type Tab = 'overview' | 'orgs' | 'partners' | 'requests' | 'reports' | 'import' | 'categories' | 'audit' | 'data'

function Inner() {
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') as Tab) || 'overview'
  const backend = useBackend()
  const { data: stats, updatedAt } = useData((b) => b.adminStats(), [], { poll: 15_000 })
  return (
    <div className="container-x pb-10 pt-8 sm:pt-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div><p className="eyebrow">Administration</p><h1 className="display-md mt-3 text-forest">Admin dashboard</h1></div>
        <div className="flex items-center gap-3"><UpdatedLabel at={updatedAt} />{backend.mode === 'demo' && <DemoTag label="Demo environment" />}</div>
      </div>
      <div className="mt-8">
        <Tabs value={tab} onChange={(t) => setParams(t === 'overview' ? {} : { tab: t })} tabs={[
          { id: 'overview', label: 'Overview' },
          { id: 'orgs', label: 'Organisations', count: stats?.orgsPending },
          { id: 'partners', label: 'Partners', count: stats?.partnersPending },
          { id: 'requests', label: 'Requests', count: stats?.flagged },
          { id: 'reports', label: 'Reports & disputes', count: stats?.reportsOpen },
          { id: 'import', label: 'CSV import' },
          { id: 'categories', label: 'Categories' },
          { id: 'audit', label: 'Audit log' },
          { id: 'data', label: 'Data & retention' },
        ]} />
      </div>
      <div className="mt-8">
        {tab === 'overview' && <Overview />}
        {tab === 'orgs' && <Orgs />}
        {tab === 'partners' && <Partners />}
        {tab === 'requests' && <Requests />}
        {tab === 'reports' && <Reports />}
        {tab === 'import' && <Import />}
        {tab === 'categories' && <Categories />}
        {tab === 'audit' && <Audit />}
        {tab === 'data' && <DataTab />}
      </div>
    </div>
  )
}

function Overview() {
  const { data: s } = useData((b) => b.adminStats(), [])
  const { data: impact } = useData((b) => b.getImpactStats(), [])
  if (!s) return <Spinner />
  const order: DonationStatus[] = ['pending_organization_confirmation', 'organization_accepted', 'awaiting_delivery_partner', 'delivery_partner_assigned', 'pickup_scheduled', 'picked_up', 'in_transit', 'delivered_pending_receipt_confirmation', 'completed', 'rejected', 'cancelled', 'failed']
  const max = Math.max(1, ...order.map((k) => s.byStatus[k] ?? 0))
  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Total requests" value={s.totalRequests} />
        <Stat label="Orgs awaiting review" value={s.orgsPending} />
        <Stat label="Partner applications" value={s.partnersPending} />
        <Stat label="Flagged / open reports" value={`${s.flagged} / ${s.reportsOpen}`} />
      </div>
      <section className="card p-6">
        <h2 className="font-display text-xl text-forest">Requests by status</h2>
        <ul className="mt-5 space-y-2.5">
          {order.map((k) => (
            <li key={k} className="grid grid-cols-[minmax(0,220px)_1fr_40px] items-center gap-3 text-[13px]">
              <span className="truncate font-semibold text-charcoal-600">{STATUS_META[k].label}</span>
              <span className="h-2 overflow-hidden rounded-full bg-forest/10"><span className={cx('block h-full rounded-full', STATUS_META[k].tone === 'bad' ? 'bg-coral-600' : 'bg-forest')} style={{ width: `${((s.byStatus[k] ?? 0) / max) * 100}%` }} /></span>
              <span className="text-right font-bold text-forest">{s.byStatus[k] ?? 0}</span>
            </li>
          ))}
        </ul>
      </section>
      {impact && <p className="text-[13px] text-charcoal-500">Public impact counters: {impact.donationsCompleted} completed · {impact.organizationsVerified} verified orgs · {impact.itemsDelivered} items · {impact.localitiesServed} localities {impact.isDemo && '(demo data)'}</p>}
    </div>
  )
}

/* ------------------------------------------------------------ orgs */

function DocLink({ d }: { d: VerificationDoc }) {
  const backend = useBackend()
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const hasFile = !!(d.dataUrl || (d.storagePath && !d.storagePath.startsWith('admin-record/')))
  const open = async () => {
    setError(null)
    try {
      const u = await backend.getDocumentUrl(d)
      if (u) setUrl(u)
      else setError('No file attached to this record.')
    } catch (e) {
      setError(errorMessage(e))
    }
  }
  const isImage = url?.startsWith('data:image') || /\.(jpe?g|png|webp)(\?|$)/i.test(url ?? '') || /\.(jpe?g|png|webp)$/i.test(d.storagePath ?? '')
  return (
    <>
      <button onClick={open} disabled={!hasFile} className="inline-flex items-center gap-1 text-[12.5px] font-bold text-forest-400 hover:text-forest disabled:opacity-50" title={hasFile ? 'View document' : 'Sample record — no file attached'}><Eye className="h-3.5 w-3.5" /> View</button>
      {error && <span className="ml-2 text-[12px] text-coral-700">{error}</span>}
      <Modal open={!!url} onClose={() => setUrl(null)} title={d.kind} wide>
        {url && (isImage ? <img src={url} alt={d.kind} className="w-full rounded-2xl" /> : <iframe title={d.kind} src={url} className="h-[70vh] w-full rounded-2xl" />)}
        <p className="mt-3 text-[12px] text-charcoal-500">Confidential. The link is a short-lived signed URL (60 seconds); don’t share or download unless needed for verification.</p>
      </Modal>
    </>
  )
}

function DocRow({ d }: { d: VerificationDoc }) {
  const backend = useBackend()
  const { run, busy } = useAction()
  return (
    <li className="flex flex-wrap items-center gap-3 rounded-2xl bg-ivory p-3 text-[13px]">
      <FileText className="h-4 w-4 text-forest-400" />
      <span className="min-w-0 flex-1"><b className="text-forest">{d.kind}</b> · {d.fileName} · {formatDate(d.uploadedAt)}</span>
      <DocLink d={d} />
      <Badge tone={d.status === 'accepted' ? 'good' : d.status === 'rejected' ? 'bad' : 'waiting'}>{d.status}</Badge>
      {d.status === 'submitted' && (
        <>
          <Button size="sm" variant="outline" loading={busy === 'a'} onClick={() => run('a', () => backend.adminReviewDocument(d.id, 'accepted', 'Checked against original'), 'Document accepted')}>Accept</Button>
          <Button size="sm" variant="danger" loading={busy === 'r'} onClick={() => { const n = prompt('Reason for rejecting this document?'); if (n) run('r', () => backend.adminReviewDocument(d.id, 'rejected', n), 'Document rejected') }}>Reject</Button>
        </>
      )}
    </li>
  )
}

function Orgs() {
  const { data, error, reload } = useData((b) => b.adminListOrganizations(), [])
  const [filter, setFilter] = useState<'queue' | 'approved' | 'all'>('queue')
  const [review, setReview] = useState<AdminOrgRow | null>(null)
  if (error) return <ErrorState error={error} onRetry={reload} />
  if (!data) return <Spinner />
  const rows = data.filter((r) => (filter === 'queue' ? ['pending', 'under_review', 'needs_info'].includes(r.org.status) : filter === 'approved' ? r.org.status === 'approved' : true))
  return (
    <div>
      <div className="mb-5 flex gap-2">{(['queue', 'approved', 'all'] as const).map((f) => <button key={f} onClick={() => setFilter(f)} className={cx('chip', filter === f && 'chip-on')}>{f === 'queue' ? 'Review queue' : f === 'approved' ? 'Approved' : 'All'}</button>)}</div>
      {rows.length ? (
        <div className="space-y-3">
          {rows.map((r) => (
            <div key={r.org.id} className="card flex flex-wrap items-center gap-4 p-5">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2"><p className="font-display text-xl text-forest">{r.org.name}</p>{r.org.isDemo && <DemoTag />}</div>
                <p className="text-[13px] text-charcoal-500">{ORG_TYPES[r.org.type]} · {r.org.locality} · {r.org.registrationType} {r.org.registrationNumber} · {r.docs.length} document(s) · registered {timeAgo(r.org.createdAt)}</p>
              </div>
              <Badge tone={r.org.status === 'approved' ? 'good' : r.org.status === 'rejected' || r.org.status === 'suspended' ? 'bad' : 'waiting'}>{r.org.status.replace('_', ' ')}</Badge>
              <Button size="sm" onClick={() => setReview(r)}>Review</Button>
            </div>
          ))}
        </div>
      ) : <EmptyState title="Nothing in this list" />}
      {review && <OrgReview row={data.find((x) => x.org.id === review.org.id) ?? review} onClose={() => setReview(null)} />}
    </div>
  )
}

function OrgReview({ row, onClose }: { row: AdminOrgRow; onClose: () => void }) {
  const backend = useBackend()
  const { run, busy } = useAction()
  const [note, setNote] = useState('')
  const [contact, setContact] = useState(false)
  const [address, setAddress] = useState(false)
  const o = row.org
  const act = async (d: ApprovalStatus) => {
    const r = await run(d, () => backend.adminReviewOrganization(o.id, d, note, { contactVerified: contact, addressVerified: address }), `Organisation ${d.replace('_', ' ')}`)
    if (r.ok) onClose()
  }
  return (
    <Modal open onClose={onClose} title={`Review: ${o.name}`} wide>
      <div className="grid gap-5 sm:grid-cols-2">
        <dl className="space-y-2 text-[13.5px]">
          {[['Type', ORG_TYPES[o.type]], ['Address', `${o.address} (${o.pinCode})`], ['Phone', o.publicPhone], ['Email', o.publicEmail], ['Registration', `${o.registrationType ?? '—'} · ${o.registrationNumber ?? '—'}`], ['Staff', row.staff.map((s) => `${s.fullName} (${s.phone})`).join(', ') || '—'], ['Status', o.status]].map(([k, v]) => (
            <div key={k}><dt className="text-[12px] font-bold uppercase tracking-wider text-charcoal-500">{k}</dt><dd className="text-charcoal">{v}</dd></div>
          ))}
        </dl>
        <div>
          <p className="mb-2 text-[12px] font-bold uppercase tracking-wider text-charcoal-500">Documents</p>
          <ul className="space-y-2">{row.docs.map((d) => <DocRow key={d.id} d={d} />)}{!row.docs.length && <p className="text-[13px] text-charcoal-500">No documents uploaded.</p>}</ul>
        </div>
      </div>
      <div className="mt-6 space-y-3 rounded-3xl bg-white p-5">
        <p className="text-[13px] font-bold text-forest">Verification checklist</p>
        <Checkbox checked={contact} onChange={setContact}>I independently confirmed the phone/email belong to this organisation (e.g. called the number listed on official records).</Checkbox>
        <Checkbox checked={address} onChange={setAddress}>I verified the address (site visit, utility bill or official registry) matches the registration.</Checkbox>
        <Field label="Decision note" hint="Required for anything other than approval. Shown to the organisation and recorded in the audit log.">{(id) => <Textarea id={id} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
        <div className="flex flex-wrap gap-2">
          <Button icon={<Check className="h-4 w-4" />} loading={busy === 'approved'} onClick={() => act('approved')}>Approve & publish</Button>
          {o.status === 'pending' && <Button variant="outline" loading={busy === 'under_review'} onClick={() => act('under_review')}>Start review</Button>}
          <Button variant="outline" loading={busy === 'needs_info'} onClick={() => act('needs_info')}>Request more info</Button>
          <Button variant="danger" loading={busy === 'rejected'} onClick={() => act('rejected')}>Reject</Button>
          {o.status === 'approved' && <Button variant="danger" loading={busy === 'suspended'} onClick={() => act('suspended')}>Suspend</Button>}
        </div>
        <p className="text-[12px] text-charcoal-500">Uploaded documents never verify an organisation automatically. Approval requires an accepted document and both checks above.</p>
      </div>
    </Modal>
  )
}

/* ------------------------------------------------------------ partners */

function Partners() {
  const backend = useBackend()
  const { run, busy } = useAction()
  const { data, error, reload } = useData((b) => b.adminListPartners(), [])
  if (error) return <ErrorState error={error} onRetry={reload} />
  if (!data) return <Spinner />
  const decide = (id: string, d: ApprovalStatus) => {
    const note = d === 'approved' ? 'Identity verified' : prompt(`Note for ${d.replace('_', ' ')}:`)
    if (note) run(id + d, () => backend.adminReviewPartner(id, d, note), `Partner ${d.replace('_', ' ')}`)
  }
  return (
    <div className="space-y-3">
      {data.map(({ partner: p, docs }) => (
        <div key={p.id} className="card p-5">
          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2"><p className="font-display text-xl text-forest">{p.fullName}</p>{p.isDemo && <DemoTag label="Demo partner" />}</div>
              <p className="text-[13px] text-charcoal-500">{p.phone} · {VEHICLES[p.vehicle]} · {p.serviceLocalities.length ? p.serviceLocalities.join(', ') : 'All Pune'} · applied {timeAgo(p.createdAt)} · {p.available ? 'online' : 'offline'}</p>
            </div>
            <Badge tone={p.status === 'approved' ? 'good' : p.status === 'pending' ? 'waiting' : 'bad'}>{p.status}</Badge>
          </div>
          <ul className="mt-4 space-y-2">{docs.map((d) => <DocRow key={d.id} d={d} />)}</ul>
          <div className="mt-4 flex flex-wrap gap-2">
            {p.status !== 'approved' && <Button size="sm" loading={busy === p.id + 'approved'} onClick={() => decide(p.id, 'approved')}>Approve</Button>}
            {p.status === 'pending' && <Button size="sm" variant="danger" onClick={() => decide(p.id, 'rejected')}>Reject</Button>}
            {p.status === 'approved' && <Button size="sm" variant="danger" onClick={() => decide(p.id, 'suspended')}>Suspend</Button>}
          </div>
        </div>
      ))}
      {!data.length && <EmptyState title="No partner applications" />}
    </div>
  )
}

/* ------------------------------------------------------------ requests */

function Requests() {
  const { data, error, reload } = useData((b) => b.adminListRequests(), [], { poll: 15_000 })
  const [filter, setFilter] = useState<'flagged' | 'problems' | 'open' | 'all'>('flagged')
  const [sel, setSel] = useState<DonationView | null>(null)
  if (error) return <ErrorState error={error} onRetry={reload} />
  if (!data) return <Spinner />
  const rows = data.filter((v) => (filter === 'flagged' ? !!v.request.flagged && !['completed', 'cancelled', 'rejected'].includes(v.request.status) : filter === 'problems' ? ['failed', 'cancelled', 'rejected'].includes(v.request.status) : filter === 'open' ? !['completed', 'cancelled', 'rejected'].includes(v.request.status) : true))
  return (
    <div>
      <div className="mb-5 flex flex-wrap gap-2">{(['flagged', 'problems', 'open', 'all'] as const).map((f) => <button key={f} onClick={() => setFilter(f)} className={cx('chip', filter === f && 'chip-on')}>{f === 'flagged' ? 'Flagged' : f === 'problems' ? 'Failed / cancelled / rejected' : f === 'open' ? 'Open' : 'All'}</button>)}</div>
      {rows.length ? (
        <div className="overflow-x-auto rounded-3xl border border-forest/10 bg-white">
          <table className="w-full min-w-[760px] text-left text-[13px]">
            <thead className="bg-ivory text-[11.5px] uppercase tracking-wider text-charcoal-500"><tr><th className="px-4 py-3">Code</th><th className="px-4 py-3">Donor → Org</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Flag</th><th className="px-4 py-3">Updated</th><th /></tr></thead>
            <tbody>
              {rows.map((v) => (
                <tr key={v.request.id} className="border-t border-forest/10">
                  <td className="px-4 py-3 font-mono"><Link to={`/track/${v.request.code}`} className="link-u">{v.request.code}</Link></td>
                  <td className="px-4 py-3">{v.donor.displayName} → {v.org.name}</td>
                  <td className="px-4 py-3"><StatusPill status={v.request.status} /></td>
                  <td className="px-4 py-3 text-coral-700">{v.request.flagged ?? ''}</td>
                  <td className="px-4 py-3 text-charcoal-500">{timeAgo(v.request.updatedAt)}</td>
                  <td className="px-4 py-3"><Button size="sm" variant="outline" onClick={() => setSel(v)}>Manage</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <EmptyState title="Nothing here" />}
      {sel && <ManageRequest v={data.find((x) => x.request.id === sel.request.id) ?? sel} onClose={() => setSel(null)} />}
    </div>
  )
}

function ManageRequest({ v, onClose }: { v: DonationView; onClose: () => void }) {
  const backend = useBackend()
  const { run, busy } = useAction()
  const [note, setNote] = useState('')
  const r = v.request
  const options = TRANSITIONS.filter((t) => t.from.includes(r.status) && t.by.includes('admin') && (!t.method || t.method === r.deliveryMethod)).map((t) => t.to)
  const [to, setTo] = useState<DonationStatus | ''>('')
  return (
    <Modal open onClose={onClose} title={`Manage ${r.code}`}>
      <div className="space-y-4 text-[13.5px]">
        <p><StatusPill status={r.status} /> <span className="ml-2 text-charcoal-500">{v.org.name} · {v.items.length} item(s)</span></p>
        {r.flagged && (
          <Notice tone="bad" icon={<Flag className="h-4 w-4" />} title="Held for review">{r.flagged}. The organisation cannot accept it until cleared.</Notice>
        )}
        <Field label="Admin note (audit log)" required>{(id) => <Textarea id={id} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
        {r.flagged && <Button variant="outline" className="w-full" loading={busy === 'clear'} onClick={async () => { const x = await run('clear', () => backend.adminClearFlag(r.id, note || 'Reviewed'), 'Flag cleared'); if (x.ok) onClose() }}>Clear flag after review</Button>}
        {options.length > 0 && (
          <div className="flex gap-2">
            <Select aria-label="Move to status" value={to} onChange={(e) => setTo(e.target.value as DonationStatus)}><option value="">Move to status…</option>{options.map((o) => <option key={o} value={o}>{STATUS_META[o].label}</option>)}</Select>
            <Button disabled={!to} loading={busy === 'tr'} onClick={async () => { const x = await run('tr', () => backend.adminTransition(r.id, to as DonationStatus, note), 'Status changed'); if (x.ok) onClose() }}>Apply</Button>
          </div>
        )}
        <p className="text-[12px] text-charcoal-500">Admins can only perform transitions allowed by the state machine. Completion always requires the organisation’s receipt confirmation.</p>
      </div>
    </Modal>
  )
}

/* ------------------------------------------------------------ reports */

function Reports() {
  const backend = useBackend()
  const { run } = useAction()
  const { data } = useData((b) => b.adminListReports(), [])
  const [res, setRes] = useState<Record<string, string>>({})
  if (!data) return <Spinner />
  if (!data.length) return <EmptyState title="No reports" body="Complaints, disputes and safety concerns filed by users appear here." />
  return (
    <div className="space-y-3">
      {data.map((r) => (
        <div key={r.id} className="card p-5">
          <div className="flex flex-wrap items-center gap-2"><Badge tone={r.kind === 'safety' ? 'bad' : 'warn'}>{r.kind}</Badge><Badge tone={r.status === 'resolved' ? 'good' : 'waiting'}>{r.status}</Badge><span className="ml-auto text-[12px] text-charcoal-400">{formatDateTime(r.createdAt)}</span></div>
          <p className="mt-3 text-[14px] text-charcoal">{r.message}</p>
          {r.requestId && <p className="mt-1 text-[12.5px] text-charcoal-500">Request: {r.requestId.slice(0, 8)}…</p>}
          {r.resolution && <p className="mt-2 rounded-2xl bg-sage-100/60 p-3 text-[13px]">Resolution: {r.resolution}</p>}
          {r.status !== 'resolved' && (
            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <Input placeholder="Resolution / next step" value={res[r.id] ?? ''} onChange={(e) => setRes({ ...res, [r.id]: e.target.value })} />
              {r.status === 'open' && <Button variant="outline" onClick={() => run('i' + r.id, () => backend.adminUpdateReport(r.id, 'investigating', res[r.id]), 'Marked investigating')}>Investigating</Button>}
              <Button onClick={() => run('r' + r.id, () => backend.adminUpdateReport(r.id, 'resolved', res[r.id]), 'Resolved')}>Resolve</Button>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------ import */

function Import() {
  const backend = useBackend()
  const { run, busy } = useAction()
  const { data } = useData((b) => b.adminListImports(), [])
  const [text, setText] = useState('')
  const [result, setResult] = useState<{ added: number; duplicates: number; errors: string[] } | null>(null)
  const loadSample = async () => setText(await (await fetch('/sample-org-import.csv')).text())
  return (
    <div className="space-y-8">
      <section className="card space-y-4 p-6">
        <h2 className="font-display text-xl text-forest">1 · Import CSV</h2>
        <p className="text-[13.5px] text-charcoal-600">Columns: <code className="rounded bg-ivory px-1.5 py-0.5 text-[12px]">name,type,locality,address,pin_code,phone,email,accepted_categories</code> (categories separated by “;”). Imported rows are <b>staged</b> — nothing is published until each row is verified.</p>
        <Textarea value={text} onChange={(e) => setText(e.target.value)} className="min-h-[140px] font-mono text-[12.5px]" placeholder="Paste CSV here…" />
        <div className="flex flex-wrap gap-2">
          <label className="inline-flex cursor-pointer"><span className="chip"><Upload className="h-3.5 w-3.5" /> Choose file</span><input type="file" accept=".csv,text/csv" className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setText(await f.text()) }} /></label>
          <button onClick={loadSample} className="chip"><Download className="h-3.5 w-3.5" /> Load sample CSV</button>
          <Button className="ml-auto" disabled={!text.trim()} loading={busy === 'imp'} onClick={async () => { const r = await run('imp', () => backend.adminImportCsv(text, 'manual-upload.csv')); if (r.ok) { setResult(r.value); setText('') } }}>Stage rows</Button>
        </div>
        {result && <Notice tone={result.errors.length ? 'warn' : 'good'} title={`${result.added} staged · ${result.duplicates} possible duplicates`}>{result.errors.length ? result.errors.join(' · ') : 'Review each row below.'}</Notice>}
      </section>
      <section>
        <h2 className="mb-4 font-display text-xl text-forest">2 · Review, verify, publish</h2>
        {!data ? <Spinner /> : data.length ? <div className="space-y-3">{data.map((row) => <ImportCard key={row.id} row={row} />)}</div> : <EmptyState title="No staged rows" />}
      </section>
    </div>
  )
}

function ImportCard({ row }: { row: ImportRow }) {
  const backend = useBackend()
  const { run, busy } = useAction()
  const [note, setNote] = useState(row.evidenceNote ?? '')
  const patch = (p: Parameters<typeof backend.adminUpdateImport>[1]) => run('p', () => backend.adminUpdateImport(row.id, p))
  const done = row.state === 'published' || row.state === 'discarded'
  return (
    <div className={cx('card p-5', done && 'opacity-70')}>
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-bold text-forest">{row.name}</p>
        <Badge>{ORG_TYPES[row.type]} · {row.locality}</Badge>
        <Badge tone={row.state === 'published' ? 'good' : row.state === 'discarded' ? 'bad' : 'waiting'}>{row.state}</Badge>
        {row.duplicateOf && <Badge tone="bad" icon={<AlertTriangle className="h-3 w-3" />}>Possible duplicate of existing org</Badge>}
      </div>
      <p className="mt-1 text-[12.5px] text-charcoal-500">{row.address} · {row.pinCode} · {row.phone} · {row.email} · accepts {row.acceptedCategories.map((c) => categoryById(c).short).join(', ') || '—'} · source {row.source}</p>
      {!done && (
        <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_1fr]">
          <div className="space-y-2">
            <Checkbox checked={row.addressVerified} onChange={(v) => patch({ addressVerified: v })}>Address verified</Checkbox>
            <Checkbox checked={row.contactVerified} onChange={(v) => patch({ contactVerified: v })}>Contact details verified</Checkbox>
            <Checkbox checked={row.permissionConfirmed} onChange={(v) => patch({ permissionConfirmed: v, state: v ? 'confirmed' : 'contacted' })}>Organisation contacted and gave permission to be listed</Checkbox>
            <Select aria-label="Pipeline state" value={row.state} onChange={(e) => patch({ state: e.target.value as ImportRow['state'] })} className="h-10 w-auto py-0 text-[13px]">
              <option value="staged">Staged</option><option value="contacted">Contacted</option><option value="confirmed">Confirmed</option>
            </Select>
          </div>
          <div className="space-y-2">
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} onBlur={() => note !== (row.evidenceNote ?? '') && patch({ evidenceNote: note })} placeholder="Evidence: what was checked, by whom, when (e.g. ‘Called listed number 12 Oct, spoke to manager; visited site 14 Oct’)" className="min-h-[90px]" />
            <div className="flex gap-2">
              <Button size="sm" loading={busy === 'pub'} onClick={async () => { if (note !== (row.evidenceNote ?? '')) await backend.adminUpdateImport(row.id, { evidenceNote: note }); run('pub', () => backend.adminPublishImport(row.id), 'Published as verified organisation') }}>Publish</Button>
              <Button size="sm" variant="danger" icon={<X className="h-3.5 w-3.5" />} onClick={() => patch({ state: 'discarded' })}>Discard</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------ categories / audit / data */

function Categories() {
  const backend = useBackend()
  const { run } = useAction()
  const { data } = useData((b) => b.listCategories(), [])
  const [all, setAll] = useState<Category[] | null>(null)
  const list = all ?? data
  if (!list) return <Spinner />
  return (
    <div className="space-y-3">
      <p className="text-[13.5px] text-charcoal-600">Inactive categories are hidden from donors. Category IDs are fixed because search and policies reference them.</p>
      {list.map((c, i) => (
        <div key={c.id} className="card grid gap-3 p-4 sm:grid-cols-[160px_1fr_1.4fr_auto] sm:items-center">
          <code className="text-[12px] text-charcoal-500">{c.id}</code>
          <Input value={c.label} onChange={(e) => setAll(list.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
          <Input value={c.blurb} onChange={(e) => setAll(list.map((x, j) => (j === i ? { ...x, blurb: e.target.value } : x)))} />
          <div className="flex items-center gap-3">
            <Toggle checked={c.active} onChange={(v) => setAll(list.map((x, j) => (j === i ? { ...x, active: v } : x)))} label="Active" />
            <Button size="sm" onClick={() => run('c' + c.id, () => backend.adminSaveCategory(list[i]), 'Category saved')}>Save</Button>
          </div>
        </div>
      ))}
    </div>
  )
}

function Audit() {
  const { data } = useData((b) => b.adminListAudit(), [], { poll: 20_000 })
  const [q, setQ] = useState('')
  const rows = useMemo(() => (data ?? []).filter((a) => !q || `${a.action} ${a.entity} ${a.entityId} ${a.details ?? ''}`.toLowerCase().includes(q.toLowerCase())), [data, q])
  if (!data) return <Spinner />
  return (
    <div>
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by action, entity or detail…" className="mb-4 max-w-md" />
      <div className="overflow-x-auto rounded-3xl border border-forest/10 bg-white">
        <table className="w-full min-w-[720px] text-left text-[12.5px]">
          <thead className="bg-ivory text-[11px] uppercase tracking-wider text-charcoal-500"><tr><th className="px-4 py-3">When</th><th className="px-4 py-3">Actor</th><th className="px-4 py-3">Action</th><th className="px-4 py-3">Entity</th><th className="px-4 py-3">Details</th></tr></thead>
          <tbody>{rows.map((a) => <tr key={a.id} className="border-t border-forest/10"><td className="whitespace-nowrap px-4 py-2.5 text-charcoal-500">{formatDateTime(a.at)}</td><td className="px-4 py-2.5 font-mono">{a.actorId.slice(0, 12)}</td><td className="px-4 py-2.5 font-bold text-forest">{a.action}</td><td className="px-4 py-2.5">{a.entity} · <span className="font-mono">{a.entityId.slice(0, 10)}</span></td><td className="px-4 py-2.5 text-charcoal-600">{a.details}</td></tr>)}</tbody>
        </table>
      </div>
    </div>
  )
}

function DataTab() {
  const backend = useBackend()
  const { run, busy } = useAction()
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="card p-6">
        <h2 className="flex items-center gap-2 font-display text-xl text-forest"><Trash2 className="h-5 w-5" /> Document retention</h2>
        <p className="mt-2 text-[13.5px] text-charcoal-600">Verification documents carry a retention date (12 months for organisations, 6 months for partners). Rejected documents are removed 30 days after upload.</p>
        <Button className="mt-5" variant="outline" loading={busy === 'purge'} onClick={async () => { const r = await run('purge', () => backend.adminPurgeExpiredDocuments()); if (r.ok) alert(`${r.value} expired document(s) deleted.`) }}>Purge expired documents now</Button>
      </section>
      <section className="card p-6">
        <h2 className="flex items-center gap-2 font-display text-xl text-forest"><Database className="h-5 w-5" /> Demo vs production data</h2>
        <p className="mt-2 text-[13.5px] text-charcoal-600">{backend.mode === 'demo' ? 'You are in the demo environment. Every record here is flagged is_demo and lives only in this browser. Production impact counters exclude demo records.' : 'Production backend. Demo records (is_demo = true) are excluded from public impact counters and should be maintained in a separate Supabase project.'}</p>
        {backend.mode === 'demo' && <Button className="mt-5" variant="danger" icon={<RotateCcw className="h-4 w-4" />} loading={busy === 'reset'} onClick={() => confirm('Reset the demo dataset to its seeded state?') && run('reset', () => backend.adminResetDemo(), 'Demo data reset')}>Reset demo dataset</Button>}
      </section>
    </div>
  )
}
