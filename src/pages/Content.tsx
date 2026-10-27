import { useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Ban, Check, ChevronDown, ClipboardList, FileCheck2, Mail, ShieldCheck, Truck, UserCheck, Users } from 'lucide-react'
import { PageHeader, OtpForm } from '../components/domain'
import { Button, EmptyState, Field, Notice, Select, Textarea, btn } from '../components/ui'
import { CategoryIcon } from '../components/CategoryIcon'
import { STATUS_META, TRANSITIONS } from '../lib/status'
import { CATEGORIES } from '../data/categories'
import { useAction, useBackend, useSession } from '../state/app'
import type { DonationStatus, Report } from '../lib/types'

const Prose = ({ children }: { children: ReactNode }) => <div className="prose-kr container-x max-w-3xl pb-10">{children}</div>

function About() {
  return (
    <>
      <PageHeader eyebrow="About KindRoute" title={<>Routing what we have to <em className="text-coral-700">where it matters.</em></>} body="KindRoute is a donation-coordination platform for Pune. We help households give useful things to verified children’s homes, old-age homes, shelters, community kitchens and NGOs — and get them there." />
      <Prose>
        <h2>Why it exists</h2>
        <p>Most homes have something useful sitting unused: last year’s textbooks, a spare blanket, a sealed bag of rice. Meanwhile care organisations spend time turning away donations they can’t use. KindRoute matches the two using each organisation’s own current needs and acceptance rules.</p>
        <h2>What we are — and aren’t</h2>
        <ul>
          <li>We coordinate requests, verification and delivery. We never take custody of goods or handle money.</li>
          <li>Organisations decide what they accept. A request is never “confirmed” until they say so.</li>
          <li>We publish only aggregate, receipt-confirmed figures. We never publish residents’ names, photos or locations.</li>
        </ul>
        <h2>Status of this project</h2>
        <p>KindRoute is a provisional name and an early build. The organisations shown in demo mode are fictional. A real launch requires verified partner organisations, configured SMS/notification providers and legal review of the policies on this site.</p>
      </Prose>
    </>
  )
}

const ACTOR_LABEL = { donor: 'Donor', org: 'Organisation', partner: 'Delivery partner', admin: 'Admin', system: 'Automatic' } as const

function HowItWorks() {
  const order: DonationStatus[] = ['draft', 'pending_organization_confirmation', 'organization_accepted', 'awaiting_delivery_partner', 'delivery_partner_assigned', 'pickup_scheduled', 'picked_up', 'in_transit', 'delivered_pending_receipt_confirmation', 'completed', 'rejected', 'cancelled', 'failed']
  return (
    <>
      <PageHeader eyebrow="How it works" title={<>Every step is <em className="text-coral-700">confirmed by someone.</em></>} body="Donor → items → matching organisations → request → organisation confirms → partner accepts → pickup → delivery → organisation confirms receipt → completed." />
      <div className="container-x">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[
            { icon: ClipboardList, t: 'You list items', b: 'Category, quantity, condition, photos, and food-safety details where relevant.' },
            { icon: UserCheck, t: 'The organisation decides', b: 'Authorised staff accept or decline with a reason. Flagged requests are reviewed by an admin first.' },
            { icon: Truck, t: 'A partner delivers', b: 'Approved partners claim jobs one at a time — two partners can never claim the same job.' },
            { icon: FileCheck2, t: 'Receipt closes it', b: 'Delivery proof is recorded, then the organisation confirms receipt. Only then is it complete.' },
          ].map((s) => (
            <div key={s.t} className="card p-6"><s.icon className="h-7 w-7 text-forest" strokeWidth={1.6} /><h3 className="mt-4 font-bold text-forest">{s.t}</h3><p className="mt-1.5 text-[14px] text-charcoal-600">{s.b}</p></div>
          ))}
        </div>
        <h2 className="mt-16 font-display text-3xl text-forest">Every status, explained</h2>
        <div className="mt-6 overflow-x-auto rounded-3xl border border-forest/10 bg-white">
          <table className="w-full min-w-[720px] text-left text-[14px]">
            <thead className="bg-ivory text-[12px] uppercase tracking-wider text-charcoal-500"><tr><th className="px-5 py-3">#</th><th className="px-5 py-3">Status</th><th className="px-5 py-3">Meaning</th><th className="px-5 py-3">Who moves it here</th></tr></thead>
            <tbody>
              {order.map((s, i) => (
                <tr key={s} className="border-t border-forest/10 align-top">
                  <td className="px-5 py-4 font-display text-coral-700">{i + 1}</td>
                  <td className="px-5 py-4 font-bold text-forest">{STATUS_META[s].label}</td>
                  <td className="px-5 py-4 text-charcoal-600">{STATUS_META[s].explain}</td>
                  <td className="px-5 py-4 text-charcoal-600">{[...new Set(TRANSITIONS.filter((t) => t.to === s).flatMap((t) => t.by))].map((a) => ACTOR_LABEL[a]).join(', ') || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-10"><Link to="/explore" className={btn('primary', 'lg')}>Find what’s needed</Link></div>
      </div>
    </>
  )
}

function Guidelines() {
  const rules: Record<string, { ok: string[]; no: string[] }> = {
    books: { ok: ['Complete textbooks and storybooks', 'New notebooks, pens, geometry boxes', 'School bags in good condition'], no: ['Books with missing pages or mould', 'Used workbooks with answers filled in'] },
    clothes: { ok: ['Washed, wearable clothes without tears', 'Winter wear, shoes in pairs', 'New innerwear only'], no: ['Used innerwear', 'Stained or damp clothing'] },
    packaged_food: { ok: ['Sealed, unopened packets', 'Printed expiry date, with the organisation’s minimum shelf life left'], no: ['Expired or opened packets', 'Home-canned or unlabelled food'] },
    fresh_food: { ok: ['Freshly cooked meals within the organisation’s time window', 'Covered, food-grade containers'], no: ['Food older than 24 hours', 'Leftovers from plates', 'Anything not kept hot or chilled'] },
    bedding: { ok: ['Clean blankets, sheets, pillows, mats'], no: ['Torn mattresses', 'Bedding with bed-bugs or damp'] },
    toys: { ok: ['Complete, clean toys and games', 'Age-appropriate items'], no: ['Broken toys or toys with sharp parts', 'Toy weapons', 'Small parts for under-5s'] },
    hygiene: { ok: ['New, sealed hygiene products'], no: ['Opened or partly used products'] },
    furniture: { ok: ['Sturdy tables, chairs, shelves'], no: ['Wobbly or broken furniture', 'Anything with exposed nails'] },
    medical: { ok: ['Walkers, wheelchairs, crutches in safe working order', 'Sealed first-aid kits'], no: ['Medicines of any kind', 'Syringes, prescription devices', 'Damaged mobility aids'] },
    other: { ok: ['Utensils, buckets, working small appliances'], no: ['Electronics needing repair', 'Hazardous items'] },
  }
  return (
    <>
      <PageHeader eyebrow="Donation item guidelines" title={<>Give what’s <em className="text-coral-700">safe and useful.</em></>} body="These platform-wide rules apply everywhere. Each organisation may add stricter rules — you’ll see them while building a donation." />
      <div className="container-x space-y-6">
        <Notice tone="bad" icon={<Ban className="h-4 w-4" />} title="Never accepted on KindRoute">Medicines and prescription products · expired food · alcohol, tobacco · gas cylinders, fuels, firecrackers, pesticides, acids · weapons and knives · used innerwear.</Notice>
        <div className="grid gap-4 md:grid-cols-2">
          {CATEGORIES.map((c) => (
            <div key={c.id} className="card p-6">
              <p className="flex items-center gap-2 font-bold text-forest"><CategoryIcon id={c.id} /> {c.label}</p>
              <ul className="mt-4 space-y-1.5 text-[14px]">
                {rules[c.id].ok.map((r) => <li key={r} className="flex gap-2 text-charcoal-600"><Check className="mt-0.5 h-4 w-4 shrink-0 text-forest-400" /> {r}</li>)}
                {rules[c.id].no.map((r) => <li key={r} className="flex gap-2 text-charcoal-600"><Ban className="mt-0.5 h-4 w-4 shrink-0 text-coral-700" /> {r}</li>)}
              </ul>
            </div>
          ))}
        </div>
        <Notice tone="info" icon={<ShieldCheck className="h-4 w-4" />} title="Photos & privacy">Photograph only the items. Never photograph children or residents during drop-off or delivery, and never share their names.</Notice>
      </div>
    </>
  )
}

function ForOrganizations() {
  return (
    <>
      <PageHeader eyebrow="For organisations" title={<>Receive what you need — <em className="text-coral-700">only that.</em></>} body="List current needs, set condition and food-safety rules, accept or decline each request, and confirm receipts. Delivery partners handle pickups." />
      <div className="container-x grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <div className="prose-kr">
          <h2>How onboarding works</h2>
          <ul>
            <li><b>Register</b> with your registered name, type, address, public contact and registration number.</li>
            <li><b>Upload documents</b> — registration certificate, trust deed / MoA, address proof, authorised signatory ID.</li>
            <li><b>Verification</b> — an administrator reviews documents and independently confirms your address and contact details. Uploading alone never verifies you.</li>
            <li><b>Go live</b> — your profile becomes public with the date it was verified. Reviews repeat every 12 months.</li>
          </ul>
          <h2>Safeguarding</h2>
          <p>Never share residents’ names, photos or personal records through KindRoute. For confidential locations (e.g. women’s shelters) list a collection point — your exact address is shared only with the assigned partner.</p>
        </div>
        <div className="card self-start p-7">
          <Users className="h-8 w-8 text-forest" strokeWidth={1.5} />
          <h3 className="mt-4 font-display text-2xl text-forest">Ready to register?</h3>
          <p className="mt-2 text-[14px] text-charcoal-600">Sign in with the mobile number of an authorised staff member.</p>
          <Link to="/signup?as=organization" className={btn('primary', 'lg', 'mt-6 w-full')}>Open organisation portal</Link>
        </div>
      </div>
    </>
  )
}

function BecomePartner() {
  return (
    <>
      <PageHeader eyebrow="Become a delivery partner" title={<>Carry kindness <em className="text-coral-700">across town.</em></>} body="Pick up donations from homes and deliver them to verified organisations, on your own schedule." />
      <div className="container-x grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <div className="prose-kr">
          <h2>Requirements</h2>
          <ul>
            <li>18+ with a verified Indian mobile number and a valid government photo ID.</li>
            <li>A bicycle, two-wheeler, auto, car or van — larger items need larger vehicles.</li>
            <li>Agree to identity verification and to use donor details only for assigned deliveries.</li>
          </ul>
          <h2>How jobs work</h2>
          <ul>
            <li>Go online to see open jobs in your service area — pickup and destination locality only.</li>
            <li>Accept a job and it’s yours alone. Full addresses and phone numbers appear only then, and disappear when the job ends.</li>
            <li>Confirm the slot, pickup, transit and delivery. Delivery needs proof: a photo or the receiver’s name.</li>
          </ul>
          <p>KindRoute does not currently pay delivery fees — no fee model is configured in this build.</p>
        </div>
        <div className="card self-start bg-forest p-7 text-ivory">
          <Truck className="h-8 w-8 text-sage" strokeWidth={1.5} />
          <h3 className="mt-4 font-display text-2xl">Apply in five minutes</h3>
          <p className="mt-2 text-[14px] text-ivory/75">An administrator reviews your ID before you can go online.</p>
          <Link to="/signup?as=partner" className={btn('coral', 'lg', 'mt-6 w-full')}>Start application</Link>
        </div>
      </div>
    </>
  )
}

const FAQS: Array<[string, string]> = [
  ['Is my donation confirmed once I submit it?', 'No. It is a request until the organisation accepts it. Pickup happens only after a verified delivery partner accepts the job. It is complete only after the organisation confirms receipt.'],
  ['Who can see my phone number and address?', 'You, administrators, and — only while the job is active — the assigned delivery partner. Organisations see your first name and locality.'],
  ['How are organisations verified?', 'An administrator reviews uploaded registration documents and independently confirms the address and contact details. Profiles show the verification date and are reviewed yearly.'],
  ['Can I donate medicines?', 'No. Medicines of any kind are not accepted. Mobility aids and sealed first-aid kits may be accepted by some organisations.'],
  ['Is there live GPS tracking?', 'No. Tracking is status-based — each step is recorded by the person responsible, with timestamps.'],
  ['Do I get a tax receipt?', 'KindRoute provides a donation acknowledgement. 80G tax receipts must be requested directly from the organisation, if they are eligible to issue them.'],
  ['Is there a delivery fee?', 'No delivery or service fee is configured. If one is ever introduced it will be shown clearly before you submit.'],
  ['Are the organisations on the site real?', 'In demo mode, no — they are fictional and labelled “Demo data”. In production only administrator-verified organisations are listed.'],
]

function Faq() {
  const [open, setOpen] = useState<number | null>(0)
  return (
    <>
      <PageHeader eyebrow="FAQ" title="Questions, answered." />
      <div className="container-x max-w-3xl">
        <div className="divide-y divide-forest/10 rounded-3xl border border-forest/10 bg-white">
          {FAQS.map(([q, a], i) => (
            <div key={q}>
              <button onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i} className="flex w-full items-center justify-between gap-4 px-6 py-5 text-left text-[16px] font-bold text-forest">
                {q}<ChevronDown className={`h-5 w-5 shrink-0 transition ${open === i ? 'rotate-180' : ''}`} />
              </button>
              {open === i && <p className="px-6 pb-6 text-[15px] leading-relaxed text-charcoal-600">{a}</p>}
            </div>
          ))}
        </div>
      </div>
    </>
  )
}

function Contact() {
  const { session } = useSession()
  const backend = useBackend()
  const { run, busy } = useAction()
  const [kind, setKind] = useState<Report['kind']>('other')
  const [msg, setMsg] = useState('')
  return (
    <>
      <PageHeader eyebrow="Contact & support" title="We’re here to help." body="Questions, problems with a donation, or a safeguarding concern — send us a message and an administrator will follow up." />
      <div className="container-x grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <div className="card p-6 sm:p-8">
          {session ? (
            <form className="space-y-4" onSubmit={async (e) => { e.preventDefault(); const r = await run('c', () => backend.fileReport({ kind, message: msg }), 'Message sent'); if (r.ok) setMsg('') }}>
              <Field label="Topic">{(id) => <Select id={id} value={kind} onChange={(e) => setKind(e.target.value as Report['kind'])}><option value="other">General question</option><option value="dispute">Problem with a donation</option><option value="complaint">Complaint</option><option value="safety">Safety / safeguarding concern</option></Select>}</Field>
              <Field label="Message" required>{(id) => <Textarea id={id} value={msg} onChange={(e) => setMsg(e.target.value)} className="min-h-[140px]" />}</Field>
              <Button type="submit" size="lg" loading={busy === 'c'}>Send</Button>
            </form>
          ) : (
            <>
              <p className="mb-5 text-[14.5px] text-charcoal-600">Sign in so we can reply to you securely.</p>
              <OtpForm onDone={() => undefined} />
            </>
          )}
        </div>
        <div className="space-y-4">
          <Notice tone="info" icon={<Mail className="h-4 w-4" />} title="Email">support@example.org — placeholder address until a support inbox is configured.</Notice>
          <Notice tone="bad" title="Emergencies">If a child or adult is in immediate danger, call 112 (national emergency) or 1098 (Childline). KindRoute is not an emergency service.</Notice>
        </div>
      </div>
    </>
  )
}

function Privacy() {
  return (
    <>
      <PageHeader eyebrow="Privacy policy" title="Privacy policy" body="Draft template — must be reviewed by a qualified lawyer (including for India’s Digital Personal Data Protection Act, 2023) before real-world launch." />
      <Prose>
        <h2>What we collect</h2>
        <ul>
          <li><b>Donors:</b> name, verified mobile number, optional email, pickup addresses, donation details and optional item photos.</li>
          <li><b>Organisation staff:</b> name, mobile number, organisation registration details and verification documents.</li>
          <li><b>Delivery partners:</b> name, mobile number, vehicle type, service area and a government ID document.</li>
        </ul>
        <h2>How we use it</h2>
        <p>Only to verify identities, coordinate donations, prevent abuse and provide support. We do not sell personal data or use it for advertising.</p>
        <h2>Who sees what</h2>
        <ul>
          <li>Organisations see a donor’s first name, locality and items — not phone numbers or addresses.</li>
          <li>The assigned delivery partner sees the pickup address and phone number only while the job is active.</li>
          <li>Administrators can access records to verify, moderate and resolve disputes. Their actions are audit-logged.</li>
        </ul>
        <h2>Children and vulnerable residents</h2>
        <p>We do not collect or publish information about residents of partner organisations. Users must not upload photos of residents or share their names.</p>
        <h2>Retention and deletion</h2>
        <p>Verification documents are retained for 12 months (organisations) or 6 months (partners) and then deleted unless renewed. You can ask us to delete your account; donation records may be kept in anonymised form for audit purposes.</p>
        <h2>Contact</h2>
        <p>Privacy requests: support@example.org (placeholder).</p>
      </Prose>
    </>
  )
}

function Terms() {
  return (
    <>
      <PageHeader eyebrow="Terms & conditions" title="Terms & conditions" body="Draft template — requires legal review before real-world use." />
      <Prose>
        <h2>The service</h2>
        <p>KindRoute connects donors, organisations and delivery partners. We do not own, inspect or take custody of donated items, and we are not party to the donation itself.</p>
        <h2>Donors</h2>
        <ul>
          <li>You confirm items are yours to give, clean, safe and as described, and comply with the item guidelines.</li>
          <li>A submitted request is not a confirmed pickup until accepted by the organisation and a delivery partner.</li>
        </ul>
        <h2>Organisations</h2>
        <ul>
          <li>You must be a legitimate, registered organisation and keep your needs and rules accurate.</li>
          <li>Confirm receipt only when items are physically received. Never share residents’ personal data.</li>
        </ul>
        <h2>Delivery partners</h2>
        <ul>
          <li>Use donor and organisation details only to complete assigned deliveries.</li>
          <li>Hand items only to the destination organisation and record honest proof.</li>
        </ul>
        <h2>Prohibited use</h2>
        <p>Fraudulent requests, impersonation, harassment, misuse of personal data or attempts to circumvent verification lead to suspension and may be reported to authorities.</p>
        <h2>Liability</h2>
        <p>To the extent permitted by law, KindRoute is not liable for the condition of donated items or for losses during delivery. Disputes can be raised through Contact & support.</p>
      </Prose>
    </>
  )
}

const PAGES: Record<string, () => JSX.Element> = {
  about: About, 'how-it-works': HowItWorks, guidelines: Guidelines, 'for-organizations': ForOrganizations, 'become-a-partner': BecomePartner, faq: Faq, contact: Contact, privacy: Privacy, terms: Terms,
}

export default function Content() {
  const { page = '' } = useParams()
  const P = PAGES[page]
  if (!P) return <div className="container-x py-20"><EmptyState title="Page not found" body="That page doesn’t exist." action={<Link to="/" className={btn('primary')}>Go home</Link>} /></div>
  return <P />
}
