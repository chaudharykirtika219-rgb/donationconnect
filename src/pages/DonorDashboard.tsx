import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowUpRight, Gift, PackageOpen, Receipt } from 'lucide-react'
import { StatusPill, UpdatedLabel, ProofList } from '../components/domain'
import { PhoneVerifyForm, RequireAuth } from '../components/auth'
import { Button, EmptyState, ErrorState, Field, Input, Skeleton, Stat, Tabs, btn, DemoTag } from '../components/ui'
import { CategoryIcon } from '../components/CategoryIcon'
import { useAction, useBackend, useData, useSession } from '../state/app'
import { isOpen } from '../lib/status'
import { categoryById } from '../data/categories'
import { formatDate, plural } from '../lib/format'
import type { CategoryId, DonationView } from '../lib/types'

export default function DonorDashboard() {
  return (
    <RequireAuth title="Sign in to see your donations">
      <Inner />
    </RequireAuth>
  )
}

type Tab = 'overview' | 'history' | 'receipts' | 'profile'

function Inner() {
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') as Tab) || 'overview'
  const { session } = useSession()
  const { data, error, loading, reload, updatedAt } = useData((b) => b.listMyDonations(), [session?.user.id], { poll: 15_000 })

  const stats = useMemo(() => {
    const all = data ?? []
    const accepted = all.filter((v) => v.events.some((e) => e.to === 'organization_accepted'))
    const completed = all.filter((v) => v.request.status === 'completed')
    const orgs = new Map<string, { name: string; slug: string; n: number }>()
    completed.forEach((v) => orgs.set(v.org.id, { name: v.org.name, slug: v.org.slug, n: (orgs.get(v.org.id)?.n ?? 0) + 1 }))
    const cats = new Map<CategoryId, number>()
    completed.forEach((v) => v.items.forEach((i) => cats.set(i.categoryId, (cats.get(i.categoryId) ?? 0) + i.quantity)))
    return { all, accepted, completed, active: all.filter((v) => isOpen(v.request.status)), orgs: [...orgs.values()], cats: [...cats.entries()] }
  }, [data])

  return (
    <div className="container-x pb-10 pt-8 sm:pt-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Donor dashboard</p>
          <h1 className="display-md mt-3 text-forest">Hello, {session!.user.fullName.split(' ')[0]}</h1>
        </div>
        <div className="flex items-center gap-3"><UpdatedLabel at={updatedAt} /><Link to="/donate" className={btn('coral')}>New donation</Link></div>
      </div>
      <div className="mt-8">
        <Tabs value={tab} onChange={(t) => setParams(t === 'overview' ? {} : { tab: t })} tabs={[{ id: 'overview', label: 'Overview' }, { id: 'history', label: 'History', count: stats.all.length }, { id: 'receipts', label: 'Receipts & proofs', count: stats.completed.length }, { id: 'profile', label: 'Profile' }]} />
      </div>
      <div className="mt-8">
        {error ? <ErrorState error={error} onRetry={reload} /> : loading && !data ? <Skeleton className="h-64" /> : (
          <>
            {tab === 'overview' && (
              <div className="space-y-10">
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  <Stat label="Submitted" value={stats.all.length} />
                  <Stat label="Accepted" value={stats.accepted.length} sub="Accepted by an organisation" />
                  <Stat label="Completed" value={stats.completed.length} sub="Receipt confirmed" />
                  <Stat label="In progress" value={stats.active.length} />
                </div>
                <section>
                  <h2 className="mb-4 font-display text-2xl text-forest">Current deliveries</h2>
                  {stats.active.length ? <div className="space-y-3">{stats.active.map((v) => <DonationRow key={v.request.id} v={v} />)}</div> : <EmptyState icon={<PackageOpen className="h-6 w-6" />} title="Nothing in progress" body="When you submit a donation, you’ll follow every step here." action={<Link to="/explore" className={btn('primary')}>Find what’s needed</Link>} />}
                </section>
                <div className="grid gap-6 lg:grid-cols-2">
                  <section className="card p-6">
                    <h2 className="font-display text-xl text-forest">Organisations you’ve supported</h2>
                    {stats.orgs.length ? <ul className="mt-4 space-y-2">{stats.orgs.map((o) => <li key={o.slug} className="flex items-center justify-between text-[14px]"><Link to={`/org/${o.slug}`} className="link-u font-semibold text-forest">{o.name}</Link><span className="text-charcoal-500">{plural(o.n, 'donation')}</span></li>)}</ul> : <p className="mt-3 text-[14px] text-charcoal-500">Completed donations will appear here.</p>}
                  </section>
                  <section className="card p-6">
                    <h2 className="font-display text-xl text-forest">What you’ve given</h2>
                    {stats.cats.length ? <ul className="mt-4 flex flex-wrap gap-2">{stats.cats.map(([c, n]) => <li key={c} className="chip"><CategoryIcon id={c} className="h-4 w-4" /> {categoryById(c).short} · {n}</li>)}</ul> : <p className="mt-3 text-[14px] text-charcoal-500">Item categories from completed donations.</p>}
                  </section>
                </div>
              </div>
            )}
            {tab === 'history' && (stats.all.length ? <div className="space-y-3">{stats.all.map((v) => <DonationRow key={v.request.id} v={v} />)}</div> : <EmptyState icon={<Gift className="h-6 w-6" />} title="No donations yet" action={<Link to="/donate" className={btn('primary')}>Start a donation</Link>} />)}
            {tab === 'receipts' && (stats.completed.length ? (
              <div className="grid gap-4 md:grid-cols-2">
                {stats.completed.map((v) => (
                  <div key={v.request.id} className="card p-6">
                    <div className="flex items-center justify-between gap-2"><span className="font-mono text-[12.5px] font-bold text-forest-400">{v.request.code}</span>{v.request.isDemo && <DemoTag />}</div>
                    <p className="mt-2 font-display text-xl text-forest">{v.org.name}</p>
                    <p className="mb-4 text-[13px] text-charcoal-500">{v.items.map((i) => `${i.quantity} × ${i.name}`).join(', ')}</p>
                    <ProofList view={v} />
                    <Button variant="ghost" size="sm" className="mt-4" icon={<Receipt className="h-4 w-4" />} onClick={() => printReceipt(v)}>Print acknowledgement</Button>
                  </div>
                ))}
              </div>
            ) : <EmptyState icon={<Receipt className="h-6 w-6" />} title="No receipts yet" body="Receipts appear once an organisation confirms it received your items." />)}
            {tab === 'profile' && <Profile />}
          </>
        )}
      </div>
    </div>
  )
}

function DonationRow({ v }: { v: DonationView }) {
  return (
    <Link to={`/track/${v.request.code}`} className="card group flex flex-col gap-3 p-5 transition hover:shadow-lift sm:flex-row sm:items-center">
      <div className="flex -space-x-2">
        {[...new Set(v.items.map((i) => i.categoryId))].slice(0, 3).map((c) => <span key={c} className="grid h-10 w-10 place-items-center rounded-full border-2 border-white bg-sage-100 text-forest"><CategoryIcon id={c} className="h-4 w-4" /></span>)}
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-mono text-[12px] font-bold text-forest-400">{v.request.code}</p>
        <p className="truncate text-[15px] font-bold text-forest">{v.org.name}</p>
        <p className="truncate text-[13px] text-charcoal-500">{v.items.map((i) => `${i.quantity} ${i.name}`).join(' · ')} · {formatDate(v.request.createdAt)}</p>
      </div>
      <StatusPill status={v.request.status} />
      <ArrowUpRight className="hidden h-4 w-4 text-charcoal-400 transition group-hover:text-forest sm:block" />
    </Link>
  )
}

function Profile() {
  const { session, refresh } = useSession()
  const backend = useBackend()
  const { run, busy } = useAction()
  const [name, setName] = useState(session!.user.fullName)
  const [email, setEmail] = useState(session!.user.email ?? '')
  const [pw, setPw] = useState('')
  const u = session!.user
  return (
    <div className="grid max-w-4xl gap-6 lg:grid-cols-2">
      <form className="card space-y-4 p-6 sm:p-7" onSubmit={async (e) => { e.preventDefault(); const r = await run('p', () => backend.updateProfile({ fullName: name, email }), 'Profile saved'); if (r.ok) refresh() }}>
        <h2 className="font-display text-xl text-forest">Your details</h2>
        <Field label="Full name">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
        <Field label="Email" hint={u.email ? (u.emailVerified ? 'Confirmed' : 'Not confirmed yet') : undefined}>{(id) => <Input id={id} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
        <p className="text-[12.5px] text-charcoal-500">Roles: {session!.roles.map((r) => r.role.replace('_', ' ')).join(', ')}. To delete your account and data, contact support (see Privacy policy).</p>
        <Button type="submit" loading={busy === 'p'}>Save</Button>
      </form>
      <div className="space-y-6">
        <section className="card p-6 sm:p-7">
          <h2 className="font-display text-xl text-forest">Mobile number</h2>
          {u.phoneVerified ? <p className="mt-2 text-[14px] text-charcoal-600">Verified: <b className="text-forest">{u.phone}</b></p> : <div className="mt-4"><PhoneVerifyForm /></div>}
        </section>
        {u.email && (
          <form className="card space-y-4 p-6 sm:p-7" onSubmit={async (e) => { e.preventDefault(); const r = await run('pw', () => backend.updatePassword(pw), 'Password updated'); if (r.ok) setPw('') }}>
            <h2 className="font-display text-xl text-forest">Password</h2>
            <Field label="New password" hint="At least 8 characters, letters and numbers.">{(id) => <Input id={id} type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" />}</Field>
            <Button type="submit" variant="outline" loading={busy === 'pw'} disabled={!pw}>Set password</Button>
          </form>
        )}
      </div>
    </div>
  )
}

function printReceipt(v: DonationView) {
  const w = window.open('', '_blank', 'width=640,height=800')
  if (!w) return
  const receipt = v.proofs.find((p) => p.kind === 'receipt')
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
  w.document.write(`<!doctype html><title>${esc(v.request.code)}</title><body style="font-family:system-ui;padding:40px;color:#252925">
    <h2 style="color:#173D32">KindRoute — donation acknowledgement</h2>
    ${v.request.isDemo ? '<p style="color:#A9533A"><b>DEMO DATA — not a real donation receipt.</b></p>' : ''}
    <p><b>Request:</b> ${esc(v.request.code)}<br><b>Organisation:</b> ${esc(v.org.name)}<br><b>Donor:</b> ${esc(v.donor.displayName)}<br><b>Receipt confirmed:</b> ${receipt ? esc(new Date(receipt.at).toLocaleString('en-IN')) : '—'}</p>
    <ul>${v.items.map((i) => `<li>${i.quantity} ${esc(i.unit)} — ${esc(i.name)}</li>`).join('')}</ul>
    <p style="font-size:12px;color:#636963">This acknowledges an in-kind donation recorded on KindRoute. It is not a tax-exemption certificate; request an 80G receipt directly from the organisation if eligible.</p>
    <script>print()</script></body>`)
  w.document.close()
}
