// Database integration tests: the real migrations on real PostgreSQL (PGlite), called the way
// PostgREST calls them (role + JWT claims). Covers test plan items A–O at the data layer.
import { beforeAll, describe, expect, it } from 'vitest'
import { bootDatabase, type TestDb } from './harness'

let db: TestDb
const today = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10) // IST
const plusDays = (n: number) => new Date(Date.now() + 5.5 * 3600_000 + n * 86_400_000).toISOString().slice(0, 10)
const uuid = () => crypto.randomUUID()

// actors
let admin: string, donor: string, donor2: string, unverified: string, staffA: string, staffB: string, partner1: string, partner2: string, pendingPartner: string
let orgA: string, orgB: string, orgPending: string

type Req = { id: string; code: string; status: string; orgId: string }
type View = { viewer: string; request: Req & Record<string, unknown>; donor: Record<string, unknown>; org: Record<string, unknown>; events: Array<{ from: string | null; to: string; actor: string }>; job?: { id: string; version: number; state: string } }

const booksDonation = (orgId: string, extra: Record<string, unknown> = {}) => ({
  clientRequestId: uuid(),
  items: [{ orgId, categoryId: 'books', name: 'Class 7 textbooks', quantity: 10, unit: 'pieces', condition: 'gently_used' }],
  methods: { [orgId]: 'partner_pickup' },
  donor: { fullName: 'Riya Tester', contactMethod: 'phone' },
  pickup: { line1: 'Flat 4, Test Residency, Lane 7', locality: 'Kothrud', pinCode: '411038' },
  preferredDate: plusDays(2),
  preferredSlot: '09:00 – 12:00',
  consent: true,
  ...extra,
})

async function rejects(p: Promise<unknown>, pattern: RegExp) {
  await expect(p).rejects.toThrow(pattern)
}

async function registerAndApprove(staff: string, name: string, cats: string[], approve = true) {
  const org = await db.rpc<{ id: string }>(staff, 'register_organization', {
    payload: { name, type: 'children_home', intro: 'Fictional test organisation', locality: 'Kothrud', address: '1 Test Road, Kothrud, Pune', pinCode: '411038',
      lat: 18.5074, lng: 73.8077, publicPhone: '+910000000099', publicEmail: 'org@example.org', registrationType: 'Trust', registrationNumber: 'TEST-123',
      deliveryMethods: ['partner_pickup', 'donor_dropoff'], acceptedCategories: cats },
  })
  if (approve) {
    await db.as(staff, (q) => q.rows(`insert into storage.objects (bucket_id, name) values ('verification-docs', $1)`, [`${staff}/reg.pdf`]))
    await db.rpc(staff, 'org_add_document', { p_type: 'Registration certificate', p_file_name: 'reg.pdf', p_path: `${staff}/reg.pdf` })
    const [doc] = await db.admin<{ id: string }>('select id from organization_verification_documents where org_id = $1', [org.id])
    await db.rpc(admin, 'admin_review_document', { p_doc: doc.id, p_status: 'accepted', p_note: 'Checked' })
    await db.rpc(admin, 'admin_review_organization', { p_org: org.id, p_decision: 'approved', p_note: 'Test approval', p_contact: true, p_address: true })
  }
  return org.id
}

async function makePartner(user: string, approve: boolean) {
  await db.as(user, (q) => q.rows(`insert into storage.objects (bucket_id, name) values ('verification-docs', $1)`, [`${user}/id.jpg`]))
  const p = await db.rpc<{ id: string }>(user, 'apply_as_partner', { payload: { fullName: 'Test Partner ' + user.slice(0, 4), vehicle: 'van', serviceLocalities: [], idFileName: 'id.jpg', idStoragePath: `${user}/id.jpg`, consent: true } })
  if (approve) {
    const [doc] = await db.admin<{ id: string }>('select id from partner_verification_documents where partner_id = $1', [p.id])
    await db.rpc(admin, 'admin_review_document', { p_doc: doc.id, p_status: 'accepted', p_note: 'ID checked' })
    await db.rpc(admin, 'admin_review_partner', { p_partner: p.id, p_decision: 'approved', p_note: 'Approved for tests' })
    await db.rpc(user, 'set_partner_availability', { p_available: true })
  }
  return p.id
}

let donorSeq = 100
/** a fresh verified donor submits → orgA accepts → returns the request, its open job and the donor */
async function acceptedRequest() {
  const d = await db.createUser({ phone: `+9198000${donorSeq++}00`, name: 'Riya Tester' })
  const [r] = await db.rpc<Req[]>(d, 'submit_donation', { payload: booksDonation(orgA) })
  await db.rpc(staffA, 'org_decide', { p_request: r.id, p_decision: 'accept' })
  const view = await db.rpc<View>(d, 'get_donation', { p_id_or_code: r.code })
  return { r, job: view.job!, d }
}
let completedDonor = ''

beforeAll(async () => {
  db = await bootDatabase()
  await db.admin('update app_settings set max_submissions_per_day = 100') // the limit itself is tested in N
  admin = await db.createUser({ email: 'admin@example.org', name: 'Ada Admin' })
  await db.admin(`select kr_bootstrap_first_admin('admin@example.org')`)
  donor = await db.createUser({ phone: '+919800000001', email: 'donor@example.org', name: 'Riya Tester' })
  donor2 = await db.createUser({ phone: '+919800000002', name: 'Other Donor' })
  unverified = await db.createUser({ email: 'new@example.org', emailConfirmed: false, name: 'New Person' })
  staffA = await db.createUser({ email: 'a@example.org', name: 'Staff A' })
  staffB = await db.createUser({ email: 'b@example.org', name: 'Staff B' })
  partner1 = await db.createUser({ phone: '+919800000011', name: 'Partner One' })
  partner2 = await db.createUser({ phone: '+919800000012', name: 'Partner Two' })
  pendingPartner = await db.createUser({ phone: '+919800000013', name: 'Pending Partner' })
  orgA = await registerAndApprove(staffA, 'Sunbeam Test Home', ['books', 'clothes', 'packaged_food'])
  orgB = await registerAndApprove(staffB, 'Banyan Test Residence', ['bedding', 'fresh_food'])
  const staffP = await db.createUser({ email: 'p@example.org', name: 'Staff P' })
  orgPending = await registerAndApprove(staffP, 'Pending Books Trust', ['books'], false)
  await makePartner(partner1, true)
  await makePartner(partner2, true)
  await makePartner(pendingPartner, false)
}, 120_000)

describe('A. sign-up, profile and session', () => {
  it('creates a profile and only the donor role — even if user metadata claims admin', async () => {
    const u = await db.createUser({ email: 'sneaky@example.org', name: 'Sneaky', meta: { role: 'admin', roles: ['admin'] } })
    const s = await db.rpc<{ user: { fullName: string; emailVerified: boolean }; roles: { role: string }[] }>(u, 'get_my_session')
    expect(s.user.fullName).toBe('Sneaky')
    expect(s.user.emailVerified).toBe(true)
    expect(s.roles.map((r) => r.role)).toEqual(['donor'])
  })
  it('restores the session from the JWT and returns null when signed out', async () => {
    expect(await db.rpc(null, 'get_my_session')).toBeNull()
    expect((await db.rpc<{ user: { id: string } }>(donor, 'get_my_session')).user.id).toBe(donor)
  })
  it('repairs an incomplete account with ensure_my_profile', async () => {
    const u = await db.createUser({ email: 'orphan@example.org', name: 'Orphan Profile' })
    await db.admin('delete from profiles where id = $1', [u])
    expect(await db.rpc(u, 'get_my_session')).toBeNull()
    const s = await db.rpc<{ roles: { role: string }[] }>(u, 'ensure_my_profile')
    expect(s.roles.map((r) => r.role)).toEqual(['donor'])
  })
  it('syncs email confirmation and phone verification from auth.users', async () => {
    await db.admin('update auth.users set email_confirmed_at = now() where id = $1', [unverified])
    expect((await db.admin<{ email_verified: boolean }>('select email_verified from profiles where id = $1', [unverified]))[0].email_verified).toBe(true)
    await db.admin('update auth.users set email_confirmed_at = null where id = $1', [unverified])
  })
})

describe('B. organisation onboarding and verification', () => {
  it('a new organisation is pending, private, and cannot respond to requests', async () => {
    const pub = await db.rpc<{ id: string }[]>(null, 'list_public_organizations')
    expect(pub.map((o) => o.id)).not.toContain(orgPending)
    expect(await db.rpc(null, 'get_public_organization', { p_slug: 'pending-books-trust' })).toBeNull()
    const ws = await db.admin<{ verification_status: string }>('select verification_status from organizations where id = $1', [orgPending])
    expect(ws[0].verification_status).toBe('pending')
  })
  it('approval requires an accepted document and both checks; only admins can approve', async () => {
    const u = await db.createUser({ email: 'c@example.org', name: 'Staff C' })
    const o = await db.rpc<{ id: string }>(u, 'register_organization', { payload: { name: 'Gate Test Org', type: 'ngo', locality: 'Aundh', address: '2 Test Lane, Aundh, Pune', pinCode: '411007', lat: 18.56, lng: 73.81, publicEmail: 'g@example.org', registrationType: 'Society', registrationNumber: 'S-1', deliveryMethods: ['partner_pickup'], acceptedCategories: ['books'] } })
    await rejects(db.rpc(admin, 'admin_review_organization', { p_org: o.id, p_decision: 'approved', p_note: '', p_contact: true, p_address: true }), /accept at least one verification document/)
    await rejects(db.rpc(u, 'admin_review_organization', { p_org: o.id, p_decision: 'approved', p_note: '', p_contact: true, p_address: true }), /administrator access only/)
    await db.rpc(admin, 'admin_review_organization', { p_org: o.id, p_decision: 'under_review', p_note: '', p_contact: false, p_address: false })
    const ws = await db.rpc<{ org: { status: string } }>(u, 'get_my_organization')
    expect(ws.org.status).toBe('under_review')
    await db.rpc(admin, 'admin_review_organization', { p_org: o.id, p_decision: 'rejected', p_note: 'Registration could not be verified', p_contact: false, p_address: false })
    expect((await db.rpc<{ org: { status: string; verificationNote: string } }>(u, 'get_my_organization')).org.verificationNote).toMatch(/could not be verified/)
  })
  it('staff manage their own profile, policies and needs; verification fields stay admin-only', async () => {
    await db.rpc(staffA, 'org_update_profile', { patch: { intro: 'Updated intro', conditionRules: 'Clean items only' } })
    await db.rpc(staffA, 'org_save_need', { p: { categoryId: 'books', title: 'Class 7 textbooks', quantity: 30, unit: 'pieces', urgency: 'high', tags: ['school'] } })
    await db.rpc(staffA, 'org_save_need', { p: { categoryId: 'clothes', title: 'Winter jackets ages 8–14', urgency: 'medium', tags: ['winter', 'kids'] } })
    await rejects(db.rpc(staffA, 'org_save_need', { p: { categoryId: 'toys', title: 'Board games', urgency: 'low' } }), /set this category to/)
    // no direct table writes at all
    await rejects(db.as(staffA, (q) => q.rows(`update organizations set verification_status = 'approved' where id = $1`, [orgPending])), /permission denied/)
    await rejects(db.as(staffA, (q) => q.rows(`update organizations set intro = 'x'`)), /permission denied|column "intro"/)
    const ws = await db.rpc<{ org: { intro: string; status: string }; needs: { title: string }[] }>(staffA, 'get_my_organization')
    expect(ws.org.intro).toBe('Updated intro')
    expect(ws.needs.map((n) => n.title)).toContain('Class 7 textbooks')
  })
  it('changing contact details resets contact verification', async () => {
    await db.rpc(staffB, 'org_update_profile', { patch: { publicEmail: 'new-contact@example.org' } })
    expect((await db.admin<{ contact_verified: boolean }>('select contact_verified from organizations where id = $1', [orgB]))[0].contact_verified).toBe(false)
  })
})

describe('C/D. search', () => {
  type Page = { total: number; results: Array<{ id: string; name: string; needs: { title: string }[]; policies: { categoryId: string; acceptance: string }[]; registrationNumber?: string; verificationNote?: string }> }
  it('books returns only approved organisations that accept books (no pending orgs, no private fields)', async () => {
    const page = await db.rpc<Page>(null, 'search_organizations', { p: { categories: ['books'] } })
    expect(page.results.map((r) => r.id)).toEqual([orgA])
    expect(page.results[0].registrationNumber).toBeUndefined()
    expect(page.results[0].verificationNote).toBeUndefined()
  })
  it('currently-needed filter uses open needs confirmed within the freshness window', async () => {
    expect((await db.rpc<Page>(null, 'search_organizations', { p: { categories: ['books'], needsOnly: true } })).total).toBe(1)
    await db.admin(`update organization_needs set last_confirmed_at = now() - interval '45 days' where org_id = $1 and category_id = 'books'`, [orgA])
    expect((await db.rpc<Page>(null, 'search_organizations', { p: { categories: ['books'], needsOnly: true } })).total).toBe(0)
    expect((await db.rpc<Page>(null, 'search_organizations', { p: { categories: ['books'] } })).total).toBe(1) // still generally accepted
    const [n] = await db.admin<{ id: string }>(`select id from organization_needs where org_id = $1 and category_id = 'books'`, [orgA])
    await db.rpc(staffA, 'org_confirm_need', { p_need: n.id })
    expect((await db.rpc<Page>(null, 'search_organizations', { p: { categories: ['books'], needsOnly: true } })).total).toBe(1)
  })
  it('temporarily unavailable categories are excluded from results but visible on the profile', async () => {
    await db.rpc(staffA, 'org_save_policy', { p: { categoryId: 'clothes', acceptance: 'temporarily_unavailable', conditionsAccepted: ['new'] } })
    expect((await db.rpc<Page>(null, 'search_organizations', { p: { categories: ['clothes'] } })).total).toBe(0)
    const prof = await db.rpc<Page['results'][0]>(null, 'get_public_organization', { p_slug: 'sunbeam-test-home' })
    expect(prof.policies.find((p) => p.categoryId === 'clothes')?.acceptance).toBe('temporarily_unavailable')
    await db.rpc(staffA, 'org_save_policy', { p: { categoryId: 'clothes', acceptance: 'accepts', conditionsAccepted: ['new', 'like_new', 'gently_used'] } })
  })
  it('food search respects each organisation’s food policy', async () => {
    const both = await db.rpc<Page>(null, 'search_organizations', { p: { categories: ['packaged_food', 'fresh_food'] } })
    expect(both.results.map((r) => r.id).sort()).toEqual([orgA, orgB].sort())
    const fresh = await db.rpc<Page>(null, 'search_organizations', { p: { categories: ['fresh_food'] } })
    expect(fresh.results.map((r) => r.id)).toEqual([orgB])
  })
  it('filters by locality, type, text and paginates', async () => {
    expect((await db.rpc<Page>(null, 'search_organizations', { p: { localities: ['Aundh'] } })).total).toBe(0)
    expect((await db.rpc<Page>(null, 'search_organizations', { p: { orgTypes: ['old_age_home'] } })).total).toBe(0)
    expect((await db.rpc<Page>(null, 'search_organizations', { p: { residual: ['banyan'], textOnly: true } })).results.map((r) => r.id)).toEqual([orgB])
    const p1 = await db.rpc<Page>(null, 'search_organizations', { p: { limit: 1, offset: 0 } })
    const p2 = await db.rpc<Page>(null, 'search_organizations', { p: { limit: 1, offset: 1 } })
    expect(p1.total).toBe(2)
    expect(p1.results[0].id).not.toBe(p2.results[0].id)
  })
})

describe('D/E. donation submission', () => {
  it('requires a verified phone (server setting) and blocks unsafe items', async () => {
    await rejects(db.rpc(unverified, 'submit_donation', { payload: booksDonation(orgA) }), /verify your phone/)
    const bad = booksDonation(orgA, { items: [{ orgId: orgA, categoryId: 'books', name: 'Paracetamol tablets', quantity: 1, unit: 'pieces', condition: 'new' }] })
    await rejects(db.rpc(donor, 'submit_donation', { payload: bad }), /not an accepted item/)
    const expired = booksDonation(orgA, { items: [{ orgId: orgA, categoryId: 'packaged_food', name: 'Rice bags', quantity: 2, unit: 'kg', condition: 'new', food: { kind: 'packaged', expiryDate: plusDays(-1), sealed: true, packaging: 'bag', storage: 'room' } }] })
    await rejects(db.rpc(donor, 'submit_donation', { payload: expired }), /packaged food/)
    const wrongOrg = booksDonation(orgB)
    await rejects(db.rpc(donor, 'submit_donation', { payload: wrongOrg }), /does not accept books/)
    await rejects(db.rpc(donor, 'submit_donation', { payload: booksDonation(orgPending) }), /not available/)
    await rejects(db.rpc(null, 'submit_donation', { payload: booksDonation(orgA) }), /permission denied/)
  })
  it('creates the request + items atomically with status pending_organization_confirmation and a status event', async () => {
    const [r] = await db.rpc<Req[]>(donor, 'submit_donation', { payload: booksDonation(orgA) })
    expect(r.code).toMatch(/^KR-[A-Z0-9]{4}-[A-Z0-9]{4}$/)
    expect(r.status).toBe('pending_organization_confirmation')
    const v = await db.rpc<View>(donor, 'get_donation', { p_id_or_code: r.code })
    expect(v.events.map((e) => e.to)).toEqual(['pending_organization_confirmation'])
    const notes = await db.rpc<{ title: string }[]>(staffA, 'list_my_notifications')
    expect(notes.some((n) => n.title === 'New donation request')).toBe(true)
  })
  it('O. a repeated submission with the same client id returns the original request (no duplicate)', async () => {
    const payload = booksDonation(orgA)
    const [a] = await db.rpc<Req[]>(donor, 'submit_donation', { payload })
    const [b] = await db.rpc<Req[]>(donor, 'submit_donation', { payload })
    expect(b.id).toBe(a.id)
    const n = await db.admin<{ n: number }>('select count(*)::int n from donation_requests where client_request_id = $1', [payload.clientRequestId])
    expect(n[0].n).toBe(1)
  })
  it('a failed validation writes nothing (atomic)', async () => {
    const before = await db.admin<{ n: number }>('select count(*)::int n from pickup_addresses')
    const mixed = booksDonation(orgA, { items: [{ orgId: orgA, categoryId: 'books', name: 'Story books', quantity: 3, unit: 'pieces', condition: 'new' }, { orgId: orgA, categoryId: 'toys', name: 'Puzzles', quantity: 1, unit: 'pieces', condition: 'new' }] })
    await rejects(db.rpc(donor, 'submit_donation', { payload: mixed }), /does not accept toys/)
    expect((await db.admin<{ n: number }>('select count(*)::int n from pickup_addresses'))[0].n).toBe(before[0].n)
  })
})

describe('F/G. organisation decisions and isolation', () => {
  it('accepts (opening a delivery job) and rejects with a reason', async () => {
    const { r, job, d } = await acceptedRequest()
    expect(job.state).toBe('open')
    const v = await db.rpc<View>(d, 'get_donation', { p_id_or_code: r.id })
    expect(v.request.status).toBe('awaiting_delivery_partner')
    expect(v.events.map((e) => e.to)).toEqual(['pending_organization_confirmation', 'organization_accepted', 'awaiting_delivery_partner'])
    const [r2] = await db.rpc<Req[]>(donor, 'submit_donation', { payload: booksDonation(orgA) })
    await rejects(db.rpc(staffA, 'org_decide', { p_request: r2.id, p_decision: 'reject', p_reason: '' }), /reason/)
    await db.rpc(staffA, 'org_decide', { p_request: r2.id, p_decision: 'reject', p_reason: 'We have enough books this month' })
    const v2 = await db.rpc<View>(donor, 'get_donation', { p_id_or_code: r2.id })
    expect(v2.request.status).toBe('rejected')
    expect(v2.request.organizationResponse).toBe('We have enough books this month')
  })
  it('the organisation sees first name + locality only — never the donor’s address or phone', async () => {
    const [r] = await db.rpc<Req[]>(donor, 'submit_donation', { payload: booksDonation(orgA) })
    const v = await db.rpc<View>(staffA, 'get_donation', { p_id_or_code: r.id })
    expect(v.viewer).toBe('org')
    expect(v.donor).toEqual({ displayName: 'Riya', locality: 'Kothrud' })
  })
  it('another organisation cannot view or change the request', async () => {
    const [r] = await db.rpc<Req[]>(donor, 'submit_donation', { payload: booksDonation(orgA) })
    await rejects(db.rpc(staffB, 'get_donation', { p_id_or_code: r.id }), /no access/)
    await rejects(db.rpc(staffB, 'org_decide', { p_request: r.id, p_decision: 'accept' }), /not addressed to your organisation/)
    expect(await db.as(staffB, (q) => q.rows('select id from donation_requests where id = $1', [r.id]))).toEqual([])
    expect((await db.rpc<unknown[]>(staffB, 'list_org_requests')).length).toBe(0)
    await rejects(db.rpc(donor, 'org_decide', { p_request: r.id, p_decision: 'accept' }), /not addressed to your organisation/)
  })
})

describe('H/I/J/K/L. delivery workflow', () => {
  it('I. an unapproved partner cannot list or claim jobs, nor go online', async () => {
    const { job } = await acceptedRequest()
    await rejects(db.rpc(pendingPartner, 'list_available_jobs'), /approved delivery partners/)
    await rejects(db.rpc(pendingPartner, 'claim_delivery_job', { p_job: job.id, p_expected_version: job.version }), /approved delivery partners/)
    await rejects(db.rpc(pendingPartner, 'set_partner_availability', { p_available: true }), /approved delivery partners/)
    await rejects(db.rpc(donor, 'claim_delivery_job', { p_job: job.id, p_expected_version: job.version }), /approved delivery partners/)
  })
  it('H/O. a job can be claimed only once; stale versions and second claims conflict', async () => {
    const { r, job, d } = await acceptedRequest()
    const listed = await db.rpc<Array<{ requestCode: string; pickupLocality: string } & Record<string, unknown>>>(partner2, 'list_available_jobs')
    const mine = listed.find((j) => j.requestCode === r.code)!
    expect(mine.pickupLocality).toBe('Kothrud')
    expect(JSON.stringify(mine)).not.toContain('Test Residency') // no address before claiming
    await db.rpc(partner1, 'claim_delivery_job', { p_job: job.id, p_expected_version: job.version })
    await rejects(db.rpc(partner2, 'claim_delivery_job', { p_job: job.id, p_expected_version: job.version }), /another partner has just accepted/)
    await rejects(db.rpc(partner2, 'claim_delivery_job', { p_job: job.id, p_expected_version: job.version + 1 }), /another partner has just accepted/)
    const j = await db.admin<{ partner_user_id: string }>('select partner_user_id from delivery_jobs where id = $1', [job.id])
    expect(j[0].partner_user_id).toBe(partner1)
  })
  it('partners cannot assign themselves by writing rows, nor skip steps', async () => {
    const { r, job, d } = await acceptedRequest()
    await rejects(db.as(partner2, (q) => q.rows(`update delivery_jobs set partner_id = (select id from delivery_partners where user_id = auth.uid()), assignment_status = 'claimed' where id = $1`, [job.id])), /permission denied/)
    await rejects(db.as(partner2, (q) => q.rows(`update donation_requests set status = 'completed' where id = $1`, [r.id])), /permission denied/)
    await db.rpc(partner2, 'claim_delivery_job', { p_job: job.id, p_expected_version: job.version })
    await rejects(db.rpc(partner2, 'partner_advance', { p_request: r.id, p_to: 'picked_up', p_note: null, p_photo: null }), /cannot move from delivery partner assigned to picked up/)
    await rejects(db.rpc(partner2, 'partner_advance', { p_request: r.id, p_to: 'completed', p_note: null, p_photo: null }), /partners cannot set this status/)
    await db.rpc(partner2, 'release_job', { p_request: r.id, p_reason: 'Vehicle problem' })
    expect((await db.rpc<View>(d, 'get_donation', { p_id_or_code: r.id })).request.status).toBe('awaiting_delivery_partner')
  })
  it('J/K/L. pickup → delivery → receipt: status history, timestamps, proofs, and only the org can complete', async () => {
    const { r, job, d } = await acceptedRequest()
    await db.rpc(partner1, 'claim_delivery_job', { p_job: job.id, p_expected_version: job.version })
    const pv = await db.rpc<View>(partner1, 'get_donation', { p_id_or_code: r.id })
    expect(pv.viewer).toBe('partner')
    expect((pv.donor.address as { line1: string }).line1).toContain('Test Residency') // authorised pickup details after claiming
    for (const to of ['pickup_scheduled', 'picked_up', 'in_transit']) await db.rpc(partner1, 'partner_advance', { p_request: r.id, p_to: to, p_note: 'ok', p_photo: null })
    await rejects(db.rpc(partner1, 'partner_advance', { p_request: r.id, p_to: 'delivered_pending_receipt_confirmation', p_note: '', p_photo: null }), /delivery proof is required/)
    await rejects(db.rpc(partner1, 'partner_advance', { p_request: r.id, p_to: 'delivered_pending_receipt_confirmation', p_note: null, p_photo: `${d}/x.jpg` }), /uploaded by you/)
    await db.as(partner1, (q) => q.rows(`insert into storage.objects (bucket_id, name) values ('delivery-proofs', $1)`, [`${partner1}/proof.jpg`]))
    await db.rpc(partner1, 'partner_advance', { p_request: r.id, p_to: 'delivered_pending_receipt_confirmation', p_note: 'Front desk', p_photo: `${partner1}/proof.jpg` })
    // K: nobody but the receiving organisation can complete
    await rejects(db.rpc(partner1, 'org_confirm_receipt', { p_request: r.id, p_note: null, p_photo: null }), /only the receiving organisation/)
    await rejects(db.rpc(d, 'org_confirm_receipt', { p_request: r.id, p_note: null, p_photo: null }), /only the receiving organisation/)
    await rejects(db.rpc(staffB, 'org_confirm_receipt', { p_request: r.id, p_note: null, p_photo: null }), /only the receiving organisation/)
    await rejects(db.rpc(admin, 'admin_transition', { p_request: r.id, p_to: 'completed', p_note: 'force complete' }), /cannot move/)
    await db.rpc(staffA, 'org_confirm_receipt', { p_request: r.id, p_note: '10 textbooks received', p_photo: null })
    const v = await db.rpc<View>(d, 'get_donation', { p_id_or_code: r.id })
    expect(v.events.map((e) => e.to)).toEqual(['pending_organization_confirmation', 'organization_accepted', 'awaiting_delivery_partner', 'delivery_partner_assigned',
      'pickup_scheduled', 'picked_up', 'in_transit', 'delivered_pending_receipt_confirmation', 'completed'])
    expect(v.events.map((e) => e.actor)).toEqual(['donor', 'org', 'system', 'partner', 'partner', 'partner', 'partner', 'partner', 'org'])
    for (const k of ['submittedAt', 'acceptedAt', 'pickedUpAt', 'deliveredAt', 'completedAt']) expect(v.request[k]).toBeTruthy()
    const j = await db.admin<Record<string, unknown>>('select pickup_confirmed_at, delivery_confirmed_at, delivery_proof_path, assignment_status from delivery_jobs where id = $1', [job.id])
    expect(j[0]).toMatchObject({ delivery_proof_path: `${partner1}/proof.jpg`, assignment_status: 'done' })
    // the partner no longer receives the donor's address once the job is finished
    expect((await db.rpc<View>(partner1, 'get_donation', { p_id_or_code: r.id })).donor.address).toBeUndefined()
    completedDonor = d
    // L: completed donation in the donor's history
    const mine = await db.rpc<View[]>(d, 'list_my_donations')
    expect(mine.find((m) => m.request.id === r.id)?.request.status).toBe('completed')
    // receipt counted against the open need
    expect((await db.admin<{ fulfilled_quantity: number }>(`select fulfilled_quantity from organization_needs where org_id = $1 and category_id = 'books'`, [orgA]))[0].fulfilled_quantity).toBeGreaterThan(0)
  })
  it('the "not received" dispute moves the request to failed, opens a report, and can be re-offered', async () => {
    const { r, job, d } = await acceptedRequest()
    await db.rpc(partner1, 'claim_delivery_job', { p_job: job.id, p_expected_version: job.version })
    for (const to of ['pickup_scheduled', 'picked_up', 'in_transit']) await db.rpc(partner1, 'partner_advance', { p_request: r.id, p_to: to, p_note: null, p_photo: null })
    await db.rpc(partner1, 'partner_advance', { p_request: r.id, p_to: 'delivered_pending_receipt_confirmation', p_note: 'Left at gate', p_photo: null })
    await db.rpc(staffA, 'org_report_not_received', { p_request: r.id, p_reason: 'Nothing arrived at the gate' })
    expect((await db.rpc<View>(d, 'get_donation', { p_id_or_code: r.id })).request.status).toBe('failed')
    expect((await db.rpc<unknown[]>(admin, 'admin_list_reports')).length).toBeGreaterThan(0)
    await db.rpc(staffA, 'org_reoffer', { p_request: r.id })
    expect((await db.rpc<View>(d, 'get_donation', { p_id_or_code: r.id })).job?.state).toBe('open')
  })
})

describe('M. private data', () => {
  it('users cannot read other users’ pickup addresses, profiles or verification documents', async () => {
    expect((await db.as(donor2, (q) => q.rows('select * from pickup_addresses'))).length).toBe(0)
    expect((await db.as(donor, (q) => q.rows('select * from pickup_addresses'))).length).toBeGreaterThan(0)
    expect((await db.as(donor2, (q) => q.rows('select id from profiles'))).map((p) => p.id)).toEqual([donor2])
    expect((await db.as(staffB, (q) => q.rows('select * from organization_verification_documents where org_id = $1', [orgA]))).length).toBe(0)
    expect((await db.as(partner1, (q) => q.rows('select * from partner_verification_documents'))).length).toBe(1)
    // signed-out visitors cannot touch the raw tables at all (they use the public RPCs)
    await rejects(db.as(null, (q) => q.rows('select * from pickup_addresses')), /permission denied/)
    await rejects(db.as(null, (q) => q.rows('select * from organizations')), /permission denied/)
    await rejects(db.as(null, (q) => q.rows('select * from donation_requests')), /permission denied/)
  })
  it('private storage objects are readable only by their owner (and admins)', async () => {
    expect((await db.as(staffB, (q) => q.rows(`select name from storage.objects where bucket_id = 'verification-docs'`))).map((o) => o.name)).toEqual([`${staffB}/reg.pdf`])
    expect((await db.as(admin, (q) => q.rows(`select name from storage.objects where bucket_id = 'verification-docs'`))).length).toBeGreaterThan(3)
    expect((await db.as(completedDonor, (q) => q.rows(`select name from storage.objects where bucket_id = 'delivery-proofs'`))).map((o) => o.name)).toEqual([`${partner1}/proof.jpg`]) // proof of the donor's own completed donation
    expect((await db.as(donor2, (q) => q.rows(`select name from storage.objects where bucket_id = 'delivery-proofs'`))).length).toBe(0)
  })
  it('uploads are confined to the user’s folder, allowed file types, and (for proofs) partners/staff', async () => {
    await rejects(db.as(donor, (q) => q.rows(`insert into storage.objects (bucket_id, name) values ('donation-photos', $1)`, [`${donor2}/x.jpg`])), /row-level security/)
    await rejects(db.as(donor, (q) => q.rows(`insert into storage.objects (bucket_id, name) values ('donation-photos', $1)`, [`${donor}/payload.html`])), /row-level security/)
    await rejects(db.as(donor, (q) => q.rows(`insert into storage.objects (bucket_id, name) values ('delivery-proofs', $1)`, [`${donor}/fake.jpg`])), /row-level security/)
    await db.as(donor, (q) => q.rows(`insert into storage.objects (bucket_id, name) values ('donation-photos', $1)`, [`${donor}/ok.jpg`]))
    const b = await db.admin<{ public: boolean; allowed_mime_types: string[] }>('select public, allowed_mime_types from storage.buckets order by id')
    expect(b.every((x) => x.public === false)).toBe(true)
  })
})

describe('N. privilege escalation and workflow bypass', () => {
  it('clients cannot grant themselves roles or edit protected columns', async () => {
    await rejects(db.as(donor, (q) => q.rows(`insert into user_roles (user_id, role) values (auth.uid(), 'admin')`)), /permission denied/)
    await rejects(db.as(donor, (q) => q.rows(`update profiles set phone_verified = true, account_status = 'active' where id = auth.uid()`)), /permission denied/)
    await rejects(db.as(donor, (q) => q.rows(`insert into delivery_partners (user_id, full_name, transport_type, approval_status) values (auth.uid(), 'x', 'van', 'approved')`)), /permission denied/)
    await rejects(db.as(donor, (q) => q.rows(`insert into donation_requests (code) values ('x')`)), /permission denied/)
  })
  it('internal SECURITY DEFINER helpers are not callable over the API', async () => {
    const [r] = await db.rpc<Req[]>(donor, 'submit_donation', { payload: booksDonation(orgA) })
    await rejects(db.rpc(donor, 'kr_apply_transition', { p_request: r.id, p_to: 'organization_accepted', p_actor: 'org' }), /permission denied for function/)
    await rejects(db.rpc(donor, 'kr_open_job', { p_request: r.id, p_actor: 'system' }), /permission denied for function/)
    await rejects(db.rpc(donor, 'kr_notify', { p_users: [donor2], p_type: 'x', p_title: 'phish', p_message: 'x' }), /permission denied for function/)
    await rejects(db.rpc(donor, 'kr_bootstrap_first_admin', { p_email: 'donor@example.org' }), /permission denied for function/)
    await rejects(db.rpc(null, 'admin_stats'), /permission denied for function/)
    await rejects(db.rpc(donor, 'admin_stats'), /administrator access only/)
    await rejects(db.rpc(donor, 'admin_grant_admin', { p_user: donor, p_note: 'please make me admin' }), /administrator access only/)
  })
  it('bootstrap refuses to create a second first-admin', async () => {
    await rejects(db.admin(`select kr_bootstrap_first_admin('donor@example.org')`), /administrator already exists/)
  })
  it('suspended accounts are locked out of every write', async () => {
    const u = await db.createUser({ phone: '+919800000099', name: 'To Suspend' })
    await db.rpc(admin, 'admin_set_account_status', { p_user: u, p_status: 'suspended', p_note: 'Abuse report confirmed' })
    await rejects(db.rpc(u, 'submit_donation', { payload: booksDonation(orgA) }), /suspended/)
  })
  it('notifications: users read and mark only their own', async () => {
    await db.rpc(donor2, 'mark_notifications_read', { p_ids: null })
    const before = await db.admin<{ n: number }>('select count(*)::int n from notifications where recipient_user_id = $1 and read_at is null', [donor])
    expect(before[0].n).toBeGreaterThan(0)
    await rejects(db.as(donor2, (q) => q.rows(`update notifications set read_at = now()`)), /permission denied/)
  })
  it('the daily submission limit is enforced server-side', async () => {
    await db.admin('update app_settings set max_submissions_per_day = 5')
    const u = await db.createUser({ phone: '+919800000098', name: 'Busy Donor' })
    for (let i = 0; i < 5; i++) await db.rpc(u, 'submit_donation', { payload: booksDonation(orgA) })
    await rejects(db.rpc(u, 'submit_donation', { payload: booksDonation(orgA) }), /limit of 5/)
    await db.admin('update app_settings set max_submissions_per_day = 100')
  })
  it('impact counters exclude demo records and audit logs are admin-only', async () => {
    const stats = await db.rpc<{ donationsCompleted: number; isDemo: boolean }>(null, 'impact_stats')
    expect(stats.isDemo).toBe(false)
    expect((await db.as(donor, (q) => q.rows('select * from audit_logs'))).length).toBe(0)
    expect((await db.rpc<unknown[]>(admin, 'admin_list_audit')).length).toBeGreaterThan(0)
  })
  it('the date window uses Pune time', async () => {
    await rejects(db.rpc(donor, 'submit_donation', { payload: booksDonation(orgA, { preferredDate: today() }) }), /between tomorrow/)
  })
})

describe('Demo seed isolation', () => {
  it('refuses to run on production and labels every record as demo on staging', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const seed = readFileSync(join(__dirname, '..', 'seed', 'demo_seed.sql'), 'utf8')
    await expect(db.raw.exec(seed)).rejects.toThrow(/demo seed refused/)
    await db.admin(`update app_settings set environment = 'staging'`)
    await db.raw.exec(seed)
    const demo = await db.rpc<Array<{ isDemo: boolean; name: string }>>(null, 'list_public_organizations')
    const seeded = demo.filter((o) => o.name.endsWith('(demo)'))
    expect(seeded.length).toBe(4)
    expect(seeded.every((o) => o.isDemo)).toBe(true)
    expect((await db.rpc<{ organizationsVerified: number }>(null, 'impact_stats')).organizationsVerified).toBe(2) // only the two real test orgs: demo rows excluded
    await db.admin(`update app_settings set environment = 'production'`)
  })
})
