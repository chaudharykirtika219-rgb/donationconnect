import { Link } from 'react-router-dom'
import { Flag, MapPin, Phone, Truck, User, Store, Package, Mail } from 'lucide-react'
import type { DonationView } from '../lib/types'
import { Badge, DemoTag } from './ui'
import { ProofList, StatusPill, StatusTimeline } from './domain'
import { CategoryIcon } from './CategoryIcon'
import { CONDITIONS, UNITS, VEHICLES } from '../data/categories'
import { formatDate, formatDateTime } from '../lib/format'

export function ItemsList({ view }: { view: DonationView }) {
  return (
    <ul className="divide-y divide-forest/10">
      {view.items.map((i) => (
        <li key={i.id} className="flex gap-3 py-3 first:pt-0 last:pb-0">
          {i.photo ? <img src={i.photo} alt="" className="h-12 w-12 rounded-xl object-cover" /> : <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-ivory text-forest"><CategoryIcon id={i.categoryId} /></span>}
          <div className="min-w-0 flex-1 text-[13.5px]">
            <p className="font-bold text-forest">{i.name}</p>
            <p className="text-charcoal-500">{i.quantity} {UNITS[i.unit]} · {CONDITIONS[i.condition]}</p>
            {i.food && <p className="text-[12.5px] text-[#7A5410]">{i.food.kind === 'packaged' ? `Expires ${i.food.expiryDate ? formatDate(i.food.expiryDate) : '—'}` : `Prepared ${i.food.preparedAt ? formatDateTime(i.food.preparedAt) : '—'}`} · {i.food.storage}{i.food.allergens ? ` · ${i.food.allergens}` : ''}</p>}
            {i.description && <p className="text-[12.5px] text-charcoal-500">{i.description}</p>}
          </div>
        </li>
      ))}
    </ul>
  )
}

/** Role-aware detail panel. All redaction already happened server-side; this only renders what it got. */
export function DonationDetail({ view, actions }: { view: DonationView; actions?: React.ReactNode }) {
  const r = view.request
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <div className="space-y-6">
        <section className="card p-6 sm:p-7">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[13px] font-bold tracking-wider text-forest-400">{r.code}</span>
            <StatusPill status={r.status} />
            {r.isDemo && <DemoTag />}
            {r.flagged && view.viewer !== 'donor' && <Badge tone="bad" icon={<Flag className="h-3 w-3" />}>Held for review: {r.flagged}</Badge>}
          </div>
          <h2 className="mt-3 font-display text-2xl text-forest">
            {view.viewer === 'org' ? `From ${view.donor.displayName}` : <>To <Link className="link-u" to={`/org/${view.org.slug}`}>{view.org.name}</Link></>}
          </h2>
          <p className="mt-1 text-[13px] text-charcoal-500">Submitted {formatDateTime(r.createdAt)} · {r.deliveryMethod === 'partner_pickup' ? 'Partner pickup' : 'Donor drop-off'} · preferred {formatDate(r.preferredDate)}, {r.preferredSlot}</p>
          {r.notes && <p className="mt-4 rounded-2xl bg-ivory p-3 text-[13.5px] text-charcoal-600">“{r.notes}”</p>}
          {actions && <div className="mt-6 flex flex-wrap gap-2">{actions}</div>}
        </section>
        <section className="card p-6 sm:p-7">
          <h3 className="mb-4 flex items-center gap-2 text-[15px] font-bold text-forest"><Package className="h-4 w-4" /> Items</h3>
          <ItemsList view={view} />
        </section>
        {view.proofs.length > 0 && (
          <section className="card p-6 sm:p-7">
            <h3 className="mb-4 text-[15px] font-bold text-forest">Proof & receipts</h3>
            <ProofList view={view} />
          </section>
        )}
      </div>
      <aside className="space-y-6">
        <section className="card p-6">
          <h3 className="mb-5 text-[15px] font-bold text-forest">Timeline</h3>
          <StatusTimeline view={view} />
          <p className="mt-6 border-t border-forest/10 pt-4 text-[12px] leading-relaxed text-charcoal-500">Status-based tracking. Live GPS location is not enabled on KindRoute.</p>
        </section>
        <section className="card space-y-4 p-6 text-[13.5px]">
          <div>
            <p className="mb-1.5 text-[11.5px] font-bold uppercase tracking-wider text-charcoal-500">Donor</p>
            <p className="flex items-center gap-2 font-semibold text-forest"><User className="h-4 w-4" /> {view.donor.displayName}{view.donor.locality && <span className="font-normal text-charcoal-500">· {view.donor.locality}</span>}</p>
            {view.donor.phone && <p className="mt-1 flex items-center gap-2 text-charcoal-600"><Phone className="h-4 w-4" /> {view.donor.phone}</p>}
            {view.donor.email && <p className="mt-1 flex items-center gap-2 text-charcoal-600"><Mail className="h-4 w-4" /> {view.donor.email}</p>}
            {view.donor.address && (
              <p className="mt-1 flex items-start gap-2 text-charcoal-600"><MapPin className="mt-0.5 h-4 w-4 shrink-0" /> <span>{view.donor.address.line1}{view.donor.address.landmark ? `, ${view.donor.address.landmark}` : ''}, {view.donor.address.locality} {view.donor.address.pinCode}{view.donor.address.instructions && <span className="block text-[12.5px] text-charcoal-500">Note: {view.donor.address.instructions}</span>}</span></p>
            )}
            {view.viewer === 'org' && <p className="mt-2 text-[12px] text-charcoal-500">Donor contact details and address are shared only with the assigned delivery partner.</p>}
          </div>
          <div className="border-t border-forest/10 pt-4">
            <p className="mb-1.5 text-[11.5px] font-bold uppercase tracking-wider text-charcoal-500">Organisation</p>
            <p className="flex items-center gap-2 font-semibold text-forest"><Store className="h-4 w-4" /> {view.org.name}</p>
            {view.org.address && <p className="mt-1 flex items-start gap-2 text-charcoal-600"><MapPin className="mt-0.5 h-4 w-4 shrink-0" /> {view.org.address}</p>}
            {view.org.phone && <p className="mt-1 flex items-center gap-2 text-charcoal-600"><Phone className="h-4 w-4" /> {view.org.phone}</p>}
          </div>
          {view.partner && (
            <div className="border-t border-forest/10 pt-4">
              <p className="mb-1.5 text-[11.5px] font-bold uppercase tracking-wider text-charcoal-500">Delivery partner</p>
              <p className="flex items-center gap-2 font-semibold text-forest"><Truck className="h-4 w-4" /> {view.partner.displayName} · {VEHICLES[view.partner.vehicle]}</p>
              {view.partner.phone && <p className="mt-1 flex items-center gap-2 text-charcoal-600"><Phone className="h-4 w-4" /> {view.partner.phone}</p>}
              {view.partner.isDemo && <p className="mt-1 text-[12px] font-semibold text-coral-700">Demo partner — not a real person.</p>}
            </div>
          )}
        </section>
      </aside>
    </div>
  )
}
