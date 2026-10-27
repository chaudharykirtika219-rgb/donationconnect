// DEMO DATA ONLY. Every organisation, person and contact detail below is fictional.
// Phone numbers use the unassignable 00000 prefix; emails use the reserved example.org domain.

import type { CategoryId, Condition, Organization, OrgItemPolicy, Urgency, Unit, DonationStatus } from '../lib/types'
import { CATEGORIES } from './categories'
import { localityByName } from './localities'
import { DB_VERSION, type DB } from '../services/db'

export const DEMO_ACCOUNTS = [
  { id: 'u-donor', phone: '+910000000001', name: 'Meera Demo', role: 'donor', label: 'Donor', note: 'Has donation history' },
  { id: 'u-org-sunbeam', phone: '+910000000002', name: 'Anil Demo', role: 'org_staff', orgId: 'org-sunbeam', label: 'Organisation rep', note: "Sunbeam Children's Home (demo)" },
  { id: 'u-org-banyan', phone: '+910000000003', name: 'Farah Demo', role: 'org_staff', orgId: 'org-banyan', label: 'Organisation rep', note: "Banyan Elders' Residence (demo)" },
  { id: 'u-org-hearth', phone: '+910000000006', name: 'Joseph Demo', role: 'org_staff', orgId: 'org-hearth', label: 'Organisation rep', note: 'Open Hearth Kitchen (demo)' },
  { id: 'u-partner-1', phone: '+910000000004', name: 'Arjun (demo partner)', role: 'delivery_partner', label: 'Delivery partner', note: 'Approved · two-wheeler' },
  { id: 'u-partner-2', phone: '+910000000005', name: 'Sana (demo partner)', role: 'delivery_partner', label: 'Delivery partner', note: 'Approved · van' },
  { id: 'u-admin', phone: '+910000000009', name: 'Platform Admin (demo)', role: 'admin', label: 'Administrator', note: 'Reviews verification' },
] as const

const ALL: Condition[] = ['new', 'like_new', 'gently_used']

interface OrgSeed {
  id: string
  name: string
  type: Organization['type']
  locality: string
  intro: string
  status: Organization['status']
  methods: Organization['deliveryMethods']
  rules: string
  restrictions: string[]
  policies: Array<[CategoryId, Condition[], Partial<OrgItemPolicy>?]>
  needs: Array<[CategoryId, string, string[], number | undefined, Unit | undefined, Urgency, number /*days since confirmed*/]>
  reviewOverdue?: boolean
}

const ORGS: OrgSeed[] = [
  {
    id: 'org-sunbeam', name: "Sunbeam Children's Home", type: 'children_home', locality: 'Kothrud', status: 'approved',
    intro: 'A residential home for around forty school-going children, focused on steady schooling, reading habits and a calm home routine.',
    methods: ['partner_pickup', 'donor_dropoff'],
    rules: 'Clothes must be washed and free of tears. Books should be complete with all pages. Toys must be clean and have no small detachable parts for under-5s.',
    restrictions: ['No used innerwear', 'No toy weapons', 'No food without a printed expiry date', 'Please do not photograph children during drop-off'],
    policies: [['books', ALL], ['clothes', ALL], ['toys', ['new', 'like_new']], ['hygiene', ['new']], ['packaged_food', ['new'], { minShelfLifeDays: 30 }], ['bedding', ALL]],
    needs: [
      ['books', 'School textbooks, classes 5–8 (State Board)', ['school', 'kids'], 40, 'pieces', 'high', 2],
      ['books', 'School bags', ['school bag', 'school', 'kids'], 25, 'pieces', 'medium', 5],
      ['clothes', 'Winter jackets and sweaters, ages 8–14', ['winter', 'kids'], 30, 'pieces', 'high', 3],
      ['hygiene', 'Toothpaste and soap', ['kids'], 60, 'pieces', 'low', 12],
    ],
  },
  {
    id: 'org-banyan', name: "Banyan Elders' Residence", type: 'old_age_home', locality: 'Aundh', status: 'approved',
    intro: 'A home for elderly residents who need daily assistance, with a small infirmary and a reading corner.',
    methods: ['partner_pickup', 'donor_dropoff'],
    rules: 'Clothing should be soft cotton and easy to wear. Mobility aids must be in safe working order. Food must have at least 60 days of shelf life.',
    restrictions: ['No medicines of any kind', 'No fried or sugary snacks', 'Mobility aids are inspected before use'],
    policies: [['clothes', ALL], ['bedding', ALL], ['hygiene', ['new']], ['medical', ['new', 'like_new', 'gently_used']], ['packaged_food', ['new'], { minShelfLifeDays: 60 }], ['books', ALL]],
    needs: [
      ['bedding', 'Warm blankets for winter', ['winter', 'elderly'], 35, 'pieces', 'high', 1],
      ['clothes', 'Cotton sarees, kurtas and cardigans', ['elderly', 'women', 'winter'], 40, 'pieces', 'medium', 4],
      ['hygiene', 'Adult diapers (sizes M, L)', ['elderly'], 20, 'boxes', 'high', 2],
      ['medical', 'Walkers and wheelchairs', ['elderly'], 4, 'pieces', 'medium', 9],
    ],
  },
  {
    id: 'org-hearth', name: 'Open Hearth Community Kitchen', type: 'community_kitchen', locality: 'Hadapsar', status: 'approved',
    intro: 'A community kitchen cooking daily meals for construction-site families and daily-wage workers.',
    methods: ['partner_pickup', 'donor_dropoff'],
    rules: 'Packaged staples must be sealed with 30+ days of shelf life. Cooked food must reach us within 3 hours of preparation, covered and kept hot or chilled.',
    restrictions: ['No home-canned food', 'No opened packets', 'Cooked food only on prior confirmation'],
    policies: [['packaged_food', ['new'], { minShelfLifeDays: 30 }], ['fresh_food', ['new'], { maxHoursSincePrep: 3 }], ['other', ['new', 'like_new', 'gently_used']]],
    needs: [
      ['packaged_food', 'Rice, dal and atta', ['staples'], 200, 'kg', 'high', 1],
      ['packaged_food', 'Cooking oil', ['staples'], 40, 'litres', 'medium', 3],
      ['fresh_food', 'Fresh vegetables (same day)', [], undefined, 'kg', 'low', 6],
      ['other', 'Large steel cooking vessels', [], 6, 'pieces', 'low', 20],
    ],
  },
  {
    id: 'org-lanterns', name: 'Little Lanterns Learning Shelter', type: 'shelter', locality: 'Yerawada', status: 'approved',
    intro: 'A day-and-night shelter with an after-school learning room for children of migrant families.',
    methods: ['partner_pickup'],
    rules: 'Stationery should be new. Furniture must be sturdy and child-safe. Books in Marathi, Hindi and English are all welcome.',
    restrictions: ['No electronics', 'No glass items', 'Furniture pickup needs a van-capable partner'],
    policies: [['books', ALL], ['toys', ALL], ['clothes', ALL], ['furniture', ['like_new', 'gently_used']], ['hygiene', ['new']]],
    needs: [
      ['toys', 'Board games and puzzles', ['kids'], 20, 'pieces', 'medium', 4],
      ['books', 'Storybooks in Marathi and Hindi', ['kids'], 60, 'pieces', 'medium', 8],
      ['furniture', 'Low study tables', ['kids', 'school'], 8, 'pieces', 'high', 2],
    ],
  },
  {
    id: 'org-harbour', name: "Harbour Women's Shelter", type: 'shelter', locality: 'Kondhwa', status: 'approved',
    intro: 'A short-stay shelter supporting women and their young children through transitions.',
    methods: ['partner_pickup'],
    rules: 'Drop-offs happen at a separate collection point; the shelter location is never shared publicly.',
    restrictions: ['Address shared only with the assigned delivery partner', 'No used innerwear', 'New hygiene products only'],
    policies: [['hygiene', ['new']], ['bedding', ALL], ['clothes', ALL], ['packaged_food', ['new'], { minShelfLifeDays: 30 }]],
    needs: [
      ['hygiene', 'Sanitary pads and hygiene kits', ['women'], 100, 'pieces', 'high', 1],
      ['bedding', 'Bedsheets and pillows', [], 20, 'sets', 'medium', 6],
      ['clothes', "Women's salwar suits", ['women'], 25, 'pieces', 'low', 34],
    ],
  },
  {
    id: 'org-meadow', name: 'Meadow Senior Day Centre', type: 'old_age_home', locality: 'Kharadi', status: 'approved', reviewOverdue: true,
    intro: 'A day centre offering meals, games and companionship to senior citizens living alone.',
    methods: ['donor_dropoff'],
    rules: 'Large-print books and board games are especially welcome.',
    restrictions: ['Drop-off only, weekdays'],
    policies: [['books', ALL], ['toys', ALL], ['clothes', ALL]],
    needs: [['books', 'Large-print books', ['elderly'], 30, 'pieces', 'low', 40]],
  },
  // Not public: pending / needs-info registrations awaiting admin review.
  {
    id: 'org-greenleaf', name: 'Greenleaf Care Foundation', type: 'ngo', locality: 'Wakad', status: 'pending',
    intro: 'Runs weekend distribution drives for families in nearby labour camps.',
    methods: ['partner_pickup'], rules: 'Clean, usable items only.', restrictions: [],
    policies: [['clothes', ALL], ['packaged_food', ['new'], { minShelfLifeDays: 30 }]],
    needs: [['clothes', 'Children’s clothing', ['kids'], 50, 'pieces', 'medium', 1]],
  },
  {
    id: 'org-riverside', name: 'Riverside Night Shelter', type: 'shelter', locality: 'Shivajinagar', status: 'needs_info',
    intro: 'A night shelter for homeless adults.',
    methods: ['donor_dropoff'], rules: 'Blankets and mats welcome in winter.', restrictions: [],
    policies: [['bedding', ALL]],
    needs: [['bedding', 'Blankets and floor mats', ['winter'], 80, 'pieces', 'high', 1]],
  },
]

const iso = (d: Date) => d.toISOString()
const daysAgo = (now: Date, d: number, h = 0) => new Date(now.getTime() - d * 86_400_000 - h * 3_600_000)

export function buildSeed(now = new Date()): DB {
  const t = iso(now)
  const db: DB = {
    version: DB_VERSION, seededAt: t, profiles: [], userRoles: [], organizations: [], verificationDocs: [], itemPolicies: [],
    needs: [], categories: CATEGORIES.map((c) => ({ ...c })), requests: [], requestItems: [], pickupAddresses: [], partners: [],
    jobs: [], events: [], proofs: [], notifications: [], reports: [], audit: [], imports: [], otps: [], submissionsLog: [], credentials: [], resetTokens: [], submissionKeys: [],
  }

  for (const a of DEMO_ACCOUNTS) {
    db.profiles.push({ id: a.id, fullName: a.name, phone: a.phone, phoneVerified: true, email: `${a.id}@example.org`, createdAt: iso(daysAgo(now, 60)), updatedAt: t, isDemo: true })
    db.userRoles.push({ userId: a.id, role: 'donor', grantedBy: 'system', createdAt: t })
    if (a.role !== 'donor')
      db.userRoles.push({ userId: a.id, role: a.role, orgId: 'orgId' in a ? a.orgId : undefined, grantedBy: 'seed', createdAt: t })
  }

  ORGS.forEach((o, i) => {
    const loc = localityByName(o.locality)!
    const approved = o.status === 'approved'
    db.organizations.push({
      id: o.id, slug: o.id.replace('org-', ''), name: o.name, type: o.type, intro: o.intro, locality: o.locality,
      address: o.id === 'org-harbour' ? `Private location, ${o.locality}, Pune (shared only with assigned partner)` : `Demo address — ${o.locality}, Pune ${loc.pin} (not a real location)`,
      pinCode: loc.pin, lat: loc.lat, lng: loc.lng, coordsPrecision: 'locality',
      publicPhone: `+91 00000 0${String(100 + i).padStart(4, '0')}`, publicEmail: `${o.id.replace('org-', '')}@example.org`,
      contactVerified: approved, registrationType: 'Public charitable trust (demo)', registrationNumber: `DEMO/TRUST/${1000 + i}`,
      status: o.status,
      verifiedAt: approved ? iso(daysAgo(now, o.reviewOverdue ? 400 : 20 + i * 5)) : undefined,
      verifiedBy: approved ? 'u-admin' : undefined,
      verificationNote: approved ? 'Demo review: registration certificate and address proof checked against sample documents. Not a real verification.' : o.status === 'needs_info' ? 'Please upload a current address proof.' : undefined,
      nextReviewDue: approved ? iso(o.reviewOverdue ? daysAgo(now, 35) : new Date(now.getTime() + (300 - i * 10) * 86_400_000)) : undefined,
      deliveryMethods: o.methods, dropoffHours: o.methods.includes('donor_dropoff') ? 'Mon–Sat, 10:00 – 17:00' : undefined,
      pickupSlots: ['09:00 – 12:00', '15:00 – 18:00'], conditionRules: o.rules, restrictions: o.restrictions,
      showImpact: o.id !== 'org-harbour', isDemo: true, createdAt: iso(daysAgo(now, 90)), updatedAt: t,
    })
    for (const [cat, conds, extra] of o.policies)
      db.itemPolicies.push({ id: `pol-${o.id}-${cat}`, orgId: o.id, categoryId: cat, acceptance: 'accepts', conditionsAccepted: conds, ...extra })
    o.needs.forEach(([cat, title, tags, qty, unit, urgency, ago], j) =>
      db.needs.push({ id: `need-${o.id}-${j}`, orgId: o.id, categoryId: cat, title, tags, quantity: qty, unit, fulfilledQty: 0, urgency, lastConfirmedAt: iso(daysAgo(now, ago)), status: 'open' }),
    )
    db.verificationDocs.push({
      id: `doc-${o.id}`, ownerKind: 'organization', ownerId: o.id, kind: 'Registration certificate', fileName: 'sample-registration.pdf',
      status: approved ? 'accepted' : 'submitted', uploadedAt: iso(daysAgo(now, 30)), retainUntil: iso(new Date(now.getTime() + 365 * 86_400_000)),
    })
  })

  db.partners.push(
    { id: 'p-1', userId: 'u-partner-1', fullName: 'Arjun (demo partner)', phone: '+910000000004', vehicle: 'two_wheeler', serviceLocalities: ['Kothrud', 'Aundh', 'Baner', 'Deccan', 'Shivajinagar', 'Warje', 'Sinhagad Road'], status: 'approved', available: true, isDemo: true, createdAt: iso(daysAgo(now, 50)), updatedAt: t },
    { id: 'p-2', userId: 'u-partner-2', fullName: 'Sana (demo partner)', phone: '+910000000005', vehicle: 'van', serviceLocalities: [], status: 'approved', available: true, isDemo: true, createdAt: iso(daysAgo(now, 40)), updatedAt: t },
  )
  db.verificationDocs.push(
    { id: 'doc-p-1', ownerKind: 'partner', ownerId: 'p-1', kind: 'Government photo ID', fileName: 'sample-id.jpg', status: 'accepted', uploadedAt: iso(daysAgo(now, 50)), retainUntil: iso(new Date(now.getTime() + 365 * 86_400_000)) },
    { id: 'doc-p-2', ownerKind: 'partner', ownerId: 'p-2', kind: 'Government photo ID', fileName: 'sample-id.jpg', status: 'accepted', uploadedAt: iso(daysAgo(now, 40)), retainUntil: iso(new Date(now.getTime() + 365 * 86_400_000)) },
  )

  db.pickupAddresses.push({ id: 'addr-donor', userId: 'u-donor', line1: 'Flat 0, Demo Residency (fictional)', landmark: 'Near demo park', locality: 'Kothrud', pinCode: '411038' })

  // Historical demo donations so dashboards and impact counters have illustrative data.
  const hist: Array<[string, string, DonationStatus, number, Array<[CategoryId, string, number, Unit]>]> = [
    ['org-sunbeam', 'KR-DEMO-0001', 'completed', 24, [['books', 'Class 6 textbooks', 12, 'pieces'], ['clothes', "Children's sweaters", 6, 'pieces']]],
    ['org-banyan', 'KR-DEMO-0002', 'completed', 15, [['bedding', 'Woollen blankets', 4, 'pieces']]],
    ['org-hearth', 'KR-DEMO-0003', 'completed', 8, [['packaged_food', 'Rice (sealed 5 kg bags)', 20, 'kg']]],
    ['org-lanterns', 'KR-DEMO-0004', 'in_transit', 0, [['toys', 'Board games', 3, 'pieces']]],
  ]
  const path: DonationStatus[] = ['pending_organization_confirmation', 'organization_accepted', 'awaiting_delivery_partner', 'delivery_partner_assigned', 'pickup_scheduled', 'picked_up', 'in_transit', 'delivered_pending_receipt_confirmation', 'completed']
  hist.forEach(([orgId, code, status, ago, items], k) => {
    const id = `req-demo-${k + 1}`
    const created = daysAgo(now, ago, 6)
    db.requests.push({ id, code, batchId: `batch-demo-${k + 1}`, donorId: 'u-donor', orgId, status, deliveryMethod: 'partner_pickup', pickupAddressId: 'addr-donor', preferredDate: iso(created).slice(0, 10), preferredSlot: '09:00 – 12:00', contactMethod: 'phone', createdAt: iso(created), updatedAt: t, isDemo: true })
    items.forEach(([cat, name, qty, unit], j) =>
      db.requestItems.push({ id: `${id}-i${j}`, requestId: id, categoryId: cat, name, quantity: qty, unit, condition: cat === 'packaged_food' ? 'new' : 'like_new', food: cat === 'packaged_food' ? { kind: 'packaged', expiryDate: iso(new Date(now.getTime() + 200 * 86_400_000)).slice(0, 10), packaging: 'Sealed bags', storage: 'room', sealed: true } : undefined }),
    )
    const partnerUser = k % 2 ? 'u-partner-2' : 'u-partner-1'
    db.jobs.push({ id: `job-demo-${k + 1}`, requestId: id, partnerId: k % 2 ? 'p-2' : 'p-1', state: status === 'completed' ? 'done' : 'claimed', packageSize: 'small', version: 1, claimedAt: iso(created), createdAt: iso(created), updatedAt: t })
    const upto = path.indexOf(status)
    let prev: DonationStatus | null = 'draft'
    for (let s = 0; s <= upto; s++) {
      const to = path[s]
      const actor = to === 'pending_organization_confirmation' ? 'donor' : ['organization_accepted', 'completed'].includes(to) ? 'org' : to === 'awaiting_delivery_partner' ? 'system' : 'partner'
      const actorId = actor === 'donor' ? 'u-donor' : actor === 'org' ? DEMO_ACCOUNTS.find((a) => 'orgId' in a && a.orgId === orgId)?.id ?? 'u-admin' : actor === 'partner' ? partnerUser : 'system'
      db.events.push({ id: `${id}-e${s}`, requestId: id, from: prev, to, actorId, actor, at: iso(new Date(created.getTime() + s * 40 * 60_000)) })
      prev = to
    }
    const orgRep = DEMO_ACCOUNTS.find((a) => 'orgId' in a && a.orgId === orgId)?.id ?? 'u-admin'
    if (status === 'completed')
      db.proofs.push(
        { id: `${id}-pd`, requestId: id, kind: 'delivery', uploadedBy: partnerUser, note: 'Handed over at reception (demo).', at: iso(new Date(created.getTime() + 7 * 40 * 60_000)) },
        { id: `${id}-pr`, requestId: id, kind: 'receipt', uploadedBy: orgRep, note: 'Received in good condition (demo).', at: iso(new Date(created.getTime() + 8 * 40 * 60_000)) },
      )
  })

  db.notifications.push({ id: 'n-welcome', userId: 'u-donor', title: 'Welcome to the KindRoute demo', body: 'Everything here is sample data stored only in this browser.', read: false, at: t })
  db.audit.push({ id: 'a-seed', actorId: 'system', action: 'demo.seed', entity: 'database', entityId: 'demo', details: 'Demo dataset created', at: t })

  db.imports.push(
    { id: 'imp-1', name: 'Sunrise Balgram (sample import)', type: 'children_home', locality: 'Katraj', address: 'Sample address, Katraj', pinCode: '411046', phone: '+91 00000 09001', email: 'sunrise@example.org', acceptedCategories: ['books', 'clothes'], source: 'sample-org-import.csv', state: 'staged', addressVerified: false, contactVerified: false, permissionConfirmed: false, createdAt: t },
    { id: 'imp-2', name: "Sunbeam Childrens Home", type: 'children_home', locality: 'Kothrud', address: 'Sample address, Kothrud', pinCode: '411038', phone: '+91 00000 09002', email: 'dup@example.org', acceptedCategories: ['books'], source: 'sample-org-import.csv', state: 'staged', duplicateOf: 'org-sunbeam', addressVerified: false, contactVerified: false, permissionConfirmed: false, createdAt: t },
  )
  return db
}
