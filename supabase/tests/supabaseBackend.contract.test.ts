// Contract test: the REAL SupabaseBackend (src/services/supabaseBackend.ts) + REAL supabase-js client +
// REAL migrations on PostgreSQL. Only the HTTP servers (PostgREST / GoTrue / Storage) are emulated —
// see fakeSupabase.ts for exactly what that does and does not prove.
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { bootDatabase, type TestDb } from './harness'
import { fakeSupabase } from './fakeSupabase'
import { SupabaseBackend } from '../../src/services/supabaseBackend'
import { AppError } from '../../src/services/backend'

vi.stubEnv('VITE_SUPABASE_PHONE_AUTH', 'true')
;(globalThis as { location?: { origin: string } }).location ??= { origin: 'http://localhost:5173' }

const JPEG = 'data:image/jpeg;base64,' + Buffer.from('fake-jpeg-bytes').toString('base64')
const PDF = 'data:application/pdf;base64,' + Buffer.from('%PDF-1.4 test').toString('base64')
const plusDays = (n: number) => new Date(Date.now() + 5.5 * 3600_000 + n * 86_400_000).toISOString().slice(0, 10)

let db: TestDb
let fake: ReturnType<typeof fakeSupabase>
const backend = () => new SupabaseBackend('http://kindroute.test', 'test-anon-key', { client: fake.client(), realtime: false })

async function signUpVerified(b: SupabaseBackend, email: string, name: string, phone: string) {
  const r = await b.signUpWithEmail({ email, password: 'secret123', fullName: name })
  expect(r.needsEmailConfirmation).toBe(false)
  await b.startPhoneVerification(phone)
  await b.confirmPhoneVerification(phone, fake.sent.sms.at(-1)!)
}

const expectCode = async (p: Promise<unknown>, code: string, msg?: RegExp) => {
  const e = await p.then(() => null, (x) => x)
  expect(e).toBeInstanceOf(AppError)
  expect((e as AppError).code).toBe(code)
  if (msg) expect((e as AppError).message).toMatch(msg)
}

let donor: SupabaseBackend, staff: SupabaseBackend, admin: SupabaseBackend, p1: SupabaseBackend, p2: SupabaseBackend, anon: SupabaseBackend
let orgId = ''

beforeAll(async () => {
  db = await bootDatabase()
  await db.admin('update app_settings set max_submissions_per_day = 100')
  fake = fakeSupabase(db)
  anon = backend()
  admin = backend()
  await admin.signUpWithEmail({ email: 'admin@example.org', password: 'secret123', fullName: 'Ada Admin' })
  await db.admin(`select kr_bootstrap_first_admin('admin@example.org')`)
}, 120_000)

describe('A. auth through supabase-js', () => {
  it('sign-up, duplicate detection, wrong password, sign-out and session restoration', async () => {
    const client = fake.client()
    const b1 = new SupabaseBackend('x', 'y', { client, realtime: false })
    const r = await b1.signUpWithEmail({ email: 'riya@example.org', password: 'secret123', fullName: 'Riya Tester' })
    expect(r.session?.roles.map((x) => x.role)).toEqual(['donor'])
    await expectCode(backend().signUpWithEmail({ email: 'riya@example.org', password: 'secret123', fullName: 'Dup' }), 'invalid', /already exists/)
    await expectCode(backend().signInWithEmail('riya@example.org', 'wrong-pass1'), 'invalid', /Incorrect email or password/)
    // a new backend instance over the same stored session = page reload
    const reloaded = new SupabaseBackend('x', 'y', { client, realtime: false })
    expect((await reloaded.getSession())?.user.fullName).toBe('Riya Tester')
    await reloaded.signOut()
    expect(await reloaded.getSession()).toBeNull()
    const s = await reloaded.signInWithEmail('riya@example.org', 'secret123')
    expect(s.user.email).toBe('riya@example.org')
    await reloaded.requestPasswordReset('riya@example.org')
    expect(fake.sent.recoveryEmails).toContain('riya@example.org')
    await reloaded.updatePassword('newsecret456')
    await reloaded.signOut()
    await reloaded.signInWithEmail('riya@example.org', 'newsecret456')
    donor = reloaded
    await donor.startPhoneVerification('9876512345')
    const verified = await donor.confirmPhoneVerification('9876512345', fake.sent.sms.at(-1)!)
    expect(verified.user.phoneVerified).toBe(true)
    expect(verified.user.phone).toBe('+919876512345')
  })
  it('with "Confirm email" on, sign-up returns no session and sign-in is refused until confirmed', async () => {
    const strict = fakeSupabase(db, { confirmEmail: true })
    const b = new SupabaseBackend('x', 'y', { client: strict.client(), realtime: false })
    const r = await b.signUpWithEmail({ email: 'pending@example.org', password: 'secret123', fullName: 'Pending Person' })
    expect(r).toEqual({ session: null, needsEmailConfirmation: true })
    await expectCode(b.signInWithEmail('pending@example.org', 'secret123'), 'invalid', /Incorrect|Confirm your email/)
  })
  it('signed-out visitors get null sessions and public data only', async () => {
    expect(await anon.getSession()).toBeNull()
    expect((await anon.listCategories()).length).toBe(10)
    await expectCode(anon.listMyDonations(), 'unauthenticated')
  })
})

describe('B–L. full workflow through the Supabase adapter', () => {
  it('organisation registers, uploads a document, gets approved; manages rules and needs', async () => {
    staff = backend()
    await staff.signUpWithEmail({ email: 'staff@example.org', password: 'secret123', fullName: 'Sunita Staff' })
    const org = await staff.registerOrganization({ name: 'Sunbeam Contract Home', type: 'children_home', intro: 'Fictional', locality: 'Kothrud', address: '1 Test Road, Kothrud', pinCode: '411038',
      publicPhone: '+910000000001', publicEmail: 'sunbeam@example.org', registrationType: 'Trust', registrationNumber: 'T-1', deliveryMethods: ['partner_pickup'], acceptedCategories: ['books', 'packaged_food'] })
    orgId = org.id
    expect(org.status).toBe('pending')
    expect((await anon.listPublicOrganizations()).length).toBe(0)
    await staff.uploadOrgDocument('Registration certificate', { name: 'reg.pdf', dataUrl: PDF })
    await expectCode(staff.uploadOrgDocument('Bad', { name: 'x.html', dataUrl: 'data:text/html;base64,PGgxPg==' }), 'invalid', /PDF, JPG/)
    const rows = await admin.adminListOrganizations()
    const row = rows.find((r) => r.org.id === orgId)!
    expect(row.org.registrationNumber).toBe('T-1') // admins see private fields
    expect(await admin.getDocumentUrl(row.docs[0])).toMatch(/object\/sign\/verification-docs/)
    await expectCode(donor.getDocumentUrl(row.docs[0]), 'unavailable') // signing refused for non-owners
    await admin.adminReviewDocument(row.docs[0].id, 'accepted', 'Checked')
    await admin.adminReviewOrganization(orgId, 'approved', 'Contract test approval', { contactVerified: true, addressVerified: true })
    await staff.savePolicy({ categoryId: 'books', acceptance: 'accepts', conditionsAccepted: ['new', 'like_new', 'gently_used'], quantityLimit: 50 })
    await staff.saveNeed({ categoryId: 'books', title: 'Class 7 textbooks', urgency: 'high', quantity: 40, unit: 'pieces', tags: ['school'] })
    await staff.updateMyOrganization({ intro: 'Updated intro' })
    const ws = (await staff.getMyOrganization())!
    expect(ws.org.status).toBe('approved')
    expect(ws.needs[0].title).toBe('Class 7 textbooks')
    expect(ws.policies.find((p) => p.categoryId === 'books')?.quantityLimit).toBe(50)
  })
  it('search runs server-side and returns standing labels and no private fields', async () => {
    const page = await anon.searchOrganizations({ q: 'books' }, { offset: 0, limit: 12 })
    expect(page.total).toBe(1)
    expect(page.results[0].standing.books).toBe('currently_needed')
    expect(page.results[0].topUrgency).toBe('high')
    expect((page.results[0].org as Record<string, unknown>).registrationNumber).toBeUndefined()
    expect((await anon.searchOrganizations({ q: 'blankets' }, { offset: 0, limit: 12 })).total).toBe(0)
    const prof = await anon.getPublicOrganization('sunbeam-contract-home')
    expect(prof?.intro).toBe('Updated intro')
  })
  it('donor submits (with photo) idempotently; org sees a redacted view and accepts', async () => {
    const input = {
      clientRequestId: crypto.randomUUID(),
      items: [{ orgId, categoryId: 'books' as const, name: 'Class 7 textbooks', quantity: 10, unit: 'pieces' as const, condition: 'gently_used' as const, photo: JPEG }],
      methods: { [orgId]: 'partner_pickup' as const }, donor: { fullName: 'Riya Tester', contactMethod: 'phone' as const },
      pickup: { line1: 'Flat 4, Test Residency', locality: 'Kothrud', pinCode: '411038' }, preferredDate: plusDays(2), preferredSlot: '09:00 – 12:00', consent: true,
    }
    const [r] = await donor.submitDonation(input)
    expect(r.status).toBe('pending_organization_confirmation')
    const [again] = await donor.submitDonation(input)
    expect(again.id).toBe(r.id)
    const mine = await donor.getDonation(r.code)
    expect(mine.items[0].photo).toMatch(/object\/sign\/donation-photos/) // private photo → signed URL
    const [ov] = await staff.listOrgRequests()
    expect(ov.donor).toEqual({ displayName: 'Riya', locality: 'Kothrud' })
    expect(ov.items[0].photo).toMatch(/object\/sign\/donation-photos/) // org may view item photos of its requests
    await expectCode(donor.orgDecide(r.id, 'accept'), 'forbidden')
    await staff.orgDecide(r.id, 'accept')
    expect((await donor.getDonation(r.id)).request.status).toBe('awaiting_delivery_partner')
    expect((await donor.listNotifications()).some((n) => /accepted your donation/.test(n.title))).toBe(true)
  })
  it('partners apply and get approved; exactly one claim wins; delivery with photo proof; org completes', async () => {
    p1 = backend()
    p2 = backend()
    await signUpVerified(p1, 'p1@example.org', 'Pavan One', '9800000011')
    await signUpVerified(p2, 'p2@example.org', 'Priya Two', '9800000012')
    for (const p of [p1, p2]) await p.applyAsPartner({ fullName: 'Test Partner', vehicle: 'van', serviceLocalities: [], idDocument: { name: 'id.jpg', dataUrl: JPEG }, consent: true })
    await expectCode(p1.listAvailableJobs(), 'forbidden') // not approved yet
    for (const { partner, docs } of await admin.adminListPartners()) {
      await admin.adminReviewDocument(docs[0].id, 'accepted', 'ID ok')
      await admin.adminReviewPartner(partner.id, 'approved', 'Approved')
    }
    await p1.setAvailability(true)
    await p2.setAvailability(true)
    const [job] = await p2.listAvailableJobs()
    expect(JSON.stringify(job)).not.toContain('Test Residency')
    const results = await Promise.allSettled([p1.claimJob(job.job.id, job.job.version), p2.claimJob(job.job.id, job.job.version)])
    expect(results.filter((x) => x.status === 'fulfilled').length).toBe(1)
    const lost = results.find((x) => x.status === 'rejected') as PromiseRejectedResult
    expect((lost.reason as AppError).code).toBe('conflict')
    const winner = results[0].status === 'fulfilled' ? p1 : p2
    const [mine] = await winner.listMyJobs()
    expect(mine.donor.address?.line1).toBe('Flat 4, Test Residency')
    const id = mine.request.id
    await winner.partnerAdvance(id, 'pickup_scheduled')
    await winner.partnerAdvance(id, 'picked_up', { note: 'Collected', photo: JPEG })
    await winner.partnerAdvance(id, 'in_transit')
    await winner.partnerAdvance(id, 'delivered_pending_receipt_confirmation', { note: 'Front desk', photo: JPEG })
    await expectCode(winner.orgConfirmReceipt(id), 'forbidden')
    await staff.orgConfirmReceipt(id, 'All received', JPEG)
    const done = (await donor.listMyDonations()).find((v) => v.request.id === id)!
    expect(done.request.status).toBe('completed')
    expect(done.events.map((e) => e.to).slice(-6)).toEqual(['delivery_partner_assigned', 'pickup_scheduled', 'picked_up', 'in_transit', 'delivered_pending_receipt_confirmation', 'completed'])
    expect(done.proofs.filter((p) => p.photo).every((p) => /object\/sign\/delivery-proofs/.test(p.photo!))).toBe(true)
    await donor.markNotificationsRead()
    expect((await donor.listNotifications()).every((n) => n.read)).toBe(true)
  })
  it('admin tools work and are refused to everyone else', async () => {
    const stats = await admin.adminStats()
    expect(stats.byStatus.completed).toBe(1)
    await expectCode(donor.adminStats(), 'forbidden', /administrator/i)
    const imp = await admin.adminImportCsv('name,type,locality,address,pin_code,phone,email,accepted_categories\nTest Import Trust,ngo,Aundh,2 Lane,411007,,,books;clothes\nBad Row,ngo,Atlantis,,,,,books', 'contract test')
    expect(imp.added).toBe(1)
    expect(imp.errors[0]).toMatch(/Atlantis/)
    const [row] = await admin.adminListImports()
    await expectCode(admin.adminPublishImport(row.id), 'invalid', /verify address/i)
    expect((await admin.adminListAudit()).length).toBeGreaterThan(5)
    expect(await admin.adminPurgeExpiredDocuments()).toBe(0)
  })
})
