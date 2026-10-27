import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AlertOctagon, ArrowLeft, Ban, CalendarClock, Check, Clock, Flag, Globe, Mail, MapPin, Phone, ShieldCheck, Store, Truck } from 'lucide-react'
import { LocalityMap, NeedRow, OtpForm, VerificationBadge } from '../components/domain'
import { Badge, Button, DemoTag, EmptyState, ErrorState, Field, Modal, Notice, Select, Spinner, Textarea, btn } from '../components/ui'
import { CategoryIcon, CATEGORY_TINT } from '../components/CategoryIcon'
import { useAction, useBackend, useData, useSession } from '../state/app'
import { CONDITIONS, ORG_TYPES, categoryById } from '../data/categories'
import { mapboxToken } from '../services'
import { formatDate } from '../lib/format'
import type { Report } from '../lib/types'
import { policyAccepts } from '../lib/search'

export default function Organization() {
  const { slug = '' } = useParams()
  const { data: org, loading, error, reload } = useData((b) => b.getPublicOrganization(slug), [slug])
  const [reportOpen, setReportOpen] = useState(false)

  if (loading) return <Spinner />
  if (error) return <div className="container-x py-16"><ErrorState error={error} onRetry={reload} /></div>
  if (!org)
    return (
      <div className="container-x py-16">
        <EmptyState title="Organisation not found" body="It may not be verified yet, or its listing was paused by an administrator." action={<Link to="/explore" className={btn('primary')}>Explore organisations</Link>} />
      </div>
    )

  const accepted = org.policies.filter(policyAccepts)
  const paused = org.policies.filter((p) => p.acceptance === 'temporarily_unavailable')
  return (
    <div className="container-x pb-10 pt-8 sm:pt-12">
      <Link to="/explore" className="inline-flex items-center gap-1.5 text-[13px] font-bold text-forest-400 hover:text-forest"><ArrowLeft className="h-4 w-4" /> All organisations</Link>

      <header className="mt-6 grid gap-8 lg:grid-cols-[1fr_380px] lg:items-end">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <VerificationBadge org={org} />
            {org.isDemo && <DemoTag label="Fictional demo organisation" />}
            <Badge>{ORG_TYPES[org.type]}</Badge>
          </div>
          <h1 className="display-lg mt-5 text-balance text-forest">{org.name}</h1>
          <p className="mt-3 flex items-center gap-1.5 text-[15px] text-charcoal-600"><MapPin className="h-4 w-4" /> {org.locality}, Pune</p>
          {org.intro && <p className="mt-6 max-w-2xl text-[17px] leading-relaxed text-charcoal-600">{org.intro}</p>}
        </div>
        <div className="card p-6">
          <p className="text-[13px] font-bold text-forest">Ready to give?</p>
          <p className="mt-1 text-[13px] text-charcoal-500">You’ll choose items, check them against this organisation’s rules and pick a pickup slot.</p>
          <Link to={`/donate?org=${org.slug}`} className={btn('primary', 'lg', 'mt-5 w-full')}>Donate here</Link>
          <button onClick={() => setReportOpen(true)} className="mt-3 flex w-full items-center justify-center gap-1.5 text-[12.5px] font-bold text-charcoal-500 hover:text-coral-700"><Flag className="h-3.5 w-3.5" /> Report a concern</button>
        </div>
      </header>

      <div className="mt-12 grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <section className="card p-6 sm:p-8" aria-labelledby="needs-h">
            <div className="flex items-baseline justify-between gap-4">
              <h2 id="needs-h" className="font-display text-2xl text-forest">Current needs</h2>
              <span className="text-[12px] text-charcoal-500">Updated by the organisation</span>
            </div>
            <div className="mt-6 space-y-5">
              {org.needs.length ? org.needs.map((n) => <NeedRow key={n.id} need={n} />) : <p className="text-[14px] text-charcoal-500">No specific needs listed right now. The items below are generally accepted.</p>}
            </div>
          </section>

          <section className="card p-6 sm:p-8" aria-labelledby="acc-h">
            <h2 id="acc-h" className="font-display text-2xl text-forest">Accepted items & conditions</h2>
            <ul className="mt-6 grid gap-3 sm:grid-cols-2">
              {accepted.map((p) => (
                <li key={p.id} className="flex gap-3 rounded-2xl bg-ivory p-4">
                  <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${CATEGORY_TINT[p.categoryId].bg} ${CATEGORY_TINT[p.categoryId].fg}`}><CategoryIcon id={p.categoryId} /></span>
                  <div className="text-[13px]">
                    <p className="text-[14px] font-bold text-forest">{categoryById(p.categoryId).label}</p>
                    <p className="text-charcoal-600">{p.conditionsAccepted.map((c) => CONDITIONS[c]).join(' · ')}</p>
                    {p.minShelfLifeDays != null && <p className="mt-1 font-semibold text-[#7A5410]">At least {p.minShelfLifeDays} days before expiry</p>}
                    {p.maxHoursSincePrep != null && <p className="mt-1 font-semibold text-[#7A5410]">Within {p.maxHoursSincePrep} h of preparation</p>}
                    {p.notes && <p className="mt-1 text-charcoal-500">{p.notes}</p>}
                  </div>
                </li>
              ))}
            </ul>
            {paused.length > 0 && (
              <div className="mt-6">
                <h3 className="text-[14px] font-bold text-forest">Temporarily unavailable</h3>
                <p className="mt-1 text-[13px] text-charcoal-500">Usually accepted, but paused right now — please don’t send these until the organisation reopens them.</p>
                <div className="mt-2 flex flex-wrap gap-1.5">{paused.map((p) => <Badge key={p.id} tone="warn">{categoryById(p.categoryId).label}</Badge>)}</div>
              </div>
            )}
            {org.conditionRules && (
              <div className="mt-6">
                <h3 className="text-[14px] font-bold text-forest">Condition requirements</h3>
                <p className="mt-1.5 text-[14px] leading-relaxed text-charcoal-600">{org.conditionRules}</p>
              </div>
            )}
            {org.restrictions.length > 0 && (
              <div className="mt-6">
                <h3 className="text-[14px] font-bold text-forest">Restrictions</h3>
                <ul className="mt-2 space-y-1.5">
                  {org.restrictions.map((r) => <li key={r} className="flex items-start gap-2 text-[14px] text-charcoal-600"><Ban className="mt-0.5 h-4 w-4 shrink-0 text-coral-700" /> {r}</li>)}
                </ul>
              </div>
            )}
            <Notice tone="info" icon={<AlertOctagon className="h-4 w-4" />}>
              KindRoute never accepts medicines, expired food or hazardous items for any organisation. See the <Link to="/guidelines" className="link-u font-bold">donation item guidelines</Link>.
            </Notice>
          </section>

          <section className="card p-6 sm:p-8" aria-labelledby="del-h">
            <h2 id="del-h" className="font-display text-2xl text-forest">Delivery & drop-off</h2>
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <div className={`rounded-2xl p-4 ${org.deliveryMethods.includes('partner_pickup') ? 'bg-sage-100/70' : 'bg-ivory opacity-60'}`}>
                <p className="flex items-center gap-2 font-bold text-forest"><Truck className="h-4 w-4" /> Partner pickup {org.deliveryMethods.includes('partner_pickup') ? <Check className="h-4 w-4" /> : '— not offered'}</p>
                {org.deliveryMethods.includes('partner_pickup') && <p className="mt-1.5 text-[13px] text-charcoal-600">Preferred delivery windows: {org.pickupSlots.join(', ')}</p>}
              </div>
              <div className={`rounded-2xl p-4 ${org.deliveryMethods.includes('donor_dropoff') ? 'bg-sage-100/70' : 'bg-ivory opacity-60'}`}>
                <p className="flex items-center gap-2 font-bold text-forest"><Store className="h-4 w-4" /> Drop-off {org.deliveryMethods.includes('donor_dropoff') ? <Check className="h-4 w-4" /> : '— not offered'}</p>
                {org.dropoffHours && <p className="mt-1.5 text-[13px] text-charcoal-600">{org.dropoffHours}, after the organisation accepts your request</p>}
              </div>
            </div>
          </section>

          {org.impact && (
            <section className="card p-6 sm:p-8" aria-labelledby="imp-h">
              <h2 id="imp-h" className="font-display text-2xl text-forest">Received through KindRoute</h2>
              <p className="mt-1 text-[13px] text-charcoal-500">Shown with the organisation’s consent. Counts receipt-confirmed donations only{org.isDemo ? ' · demo figures' : ''}.</p>
              <div className="mt-5 flex gap-10">
                <div><p className="font-display text-4xl text-forest">{org.impact.completed}</p><p className="text-[13px] text-charcoal-500">donations completed</p></div>
                <div><p className="font-display text-4xl text-forest">{org.impact.items}</p><p className="text-[13px] text-charcoal-500">items received</p></div>
              </div>
            </section>
          )}
        </div>

        <aside className="space-y-6">
          <section className="card p-6" aria-labelledby="contact-h">
            <h2 id="contact-h" className="font-display text-xl text-forest">Contact</h2>
            {org.isDemo && <p className="mt-1 text-[12px] font-semibold text-coral-700">Fictional demo contact details — do not call.</p>}
            <ul className="mt-4 space-y-3 text-[14px]">
              <li className="flex items-center gap-2.5 text-charcoal-600"><Phone className="h-4 w-4 text-forest-400" /> {org.publicPhone}</li>
              <li className="flex items-center gap-2.5 text-charcoal-600"><Mail className="h-4 w-4 text-forest-400" /> {org.publicEmail}</li>
              {org.website && <li className="flex items-center gap-2.5 text-charcoal-600"><Globe className="h-4 w-4 text-forest-400" /> {org.website}</li>}
              <li className="flex items-start gap-2.5 text-charcoal-600"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-forest-400" /> {org.address}</li>
            </ul>
            <p className="mt-4 flex items-center gap-1.5 text-[12px] text-charcoal-500">{org.contactVerified ? <><ShieldCheck className="h-3.5 w-3.5 text-forest-400" /> Contact details checked by an administrator</> : 'Contact details not yet re-verified'}</p>
            <div className="mt-5">
              {mapboxToken ? (
                <img className="w-full rounded-3xl" alt={`Map of ${org.locality}`} src={`https://api.mapbox.com/styles/v1/mapbox/light-v11/static/pin-l+c9694b(${org.lng},${org.lat})/${org.lng},${org.lat},${org.coordsPrecision === 'locality' ? 12 : 15}/600x400@2x?access_token=${mapboxToken}`} />
              ) : (
                <LocalityMap lat={org.lat} lng={org.lng} label={org.locality} precision={org.coordsPrecision} />
              )}
            </div>
          </section>

          <section className="card p-6" aria-labelledby="ver-h">
            <h2 id="ver-h" className="font-display text-xl text-forest">Verification</h2>
            <dl className="mt-4 space-y-3 text-[13.5px]">
              <div className="flex justify-between gap-3"><dt className="text-charcoal-500">Status</dt><dd><VerificationBadge org={org} compact /></dd></div>
              {org.verifiedAt && <div className="flex justify-between gap-3"><dt className="text-charcoal-500">Reviewed</dt><dd className="font-semibold">{formatDate(org.verifiedAt)}</dd></div>}
              {org.nextReviewDue && <div className="flex justify-between gap-3"><dt className="flex items-center gap-1 text-charcoal-500"><CalendarClock className="h-3.5 w-3.5" /> Next review</dt><dd className="font-semibold">{formatDate(org.nextReviewDue)}</dd></div>}
              {org.registrationType && <div className="flex justify-between gap-3"><dt className="text-charcoal-500">Registered as</dt><dd className="text-right font-semibold">{org.registrationType}</dd></div>}
            </dl>
            <p className="mt-4 flex items-start gap-1.5 text-[12px] leading-snug text-charcoal-500"><Clock className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Verification means an administrator reviewed documents and contact details. It is not an endorsement or audit of the organisation’s work.</p>
          </section>
        </aside>
      </div>

      <ReportModal open={reportOpen} onClose={() => setReportOpen(false)} orgId={org.id} />
    </div>
  )
}

export function ReportModal({ open, onClose, orgId, requestId }: { open: boolean; onClose: () => void; orgId?: string; requestId?: string }) {
  const { session } = useSession()
  const backend = useBackend()
  const { run, busy } = useAction()
  const [kind, setKind] = useState<Report['kind']>(requestId ? 'dispute' : 'complaint')
  const [message, setMessage] = useState('')
  return (
    <Modal open={open} onClose={onClose} title="Report a concern">
      {!session ? (
        <>
          <p className="mb-5 text-[14px] text-charcoal-600">Sign in so an administrator can follow up with you. Reports are private.</p>
          <OtpForm onDone={() => undefined} />
        </>
      ) : (
        <form onSubmit={async (e) => { e.preventDefault(); const r = await run('report', () => backend.fileReport({ kind, message, orgId, requestId }), 'Report sent to administrators'); if (r.ok) { setMessage(''); onClose() } }} className="space-y-4">
          <Field label="Type">{(id) => (
            <Select id={id} value={kind} onChange={(e) => setKind(e.target.value as Report['kind'])}>
              <option value="complaint">Complaint</option>
              <option value="dispute">Dispute about a donation</option>
              <option value="safety">Safety or safeguarding concern</option>
              <option value="other">Other</option>
            </Select>
          )}</Field>
          <Field label="What happened?" hint="Please don’t include children’s or residents’ names.">{(id) => <Textarea id={id} value={message} onChange={(e) => setMessage(e.target.value)} />}</Field>
          <Button type="submit" className="w-full" size="lg" loading={busy === 'report'}>Send report</Button>
        </form>
      )}
    </Modal>
  )
}
