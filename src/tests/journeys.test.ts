import { describe, it, expect, beforeEach } from 'vitest'
import { DemoBackend, memoryStore } from '../services/demoBackend'
import type { DonationSubmission } from '../services/backend'
import { searchOrganizations } from '../lib/search'
import { localDateIso } from '../lib/format'

// Controllable clock: each sign-in advances time past the 30 s OTP cooldown.
let clock = Date.now()
const now = () => new Date(clock)
const tomorrow = () => localDateIso(new Date(clock + 86_400_000))

async function signIn(b: DemoBackend, phone: string, signup?: { fullName: string }) {
  clock += 31_000
  const { demoCode } = await b.requestOtp(phone)
  return b.verifyOtp(phone, demoCode!, signup)
}

const booksSubmission = (orgId: string): DonationSubmission => ({
  clientRequestId: crypto.randomUUID(),
  items: [{ orgId, categoryId: 'books', name: 'Class 7 textbooks', quantity: 10, unit: 'pieces', condition: 'gently_used' }],
  methods: { [orgId]: 'partner_pickup' },
  donor: { fullName: 'Test Donor', contactMethod: 'phone' },
  pickup: { line1: '12 Test Lane, Test Society', locality: 'Kothrud', pinCode: '411038' },
  preferredDate: tomorrow(),
  preferredSlot: '09:00 – 12:00',
  consent: true,
})

describe('KindRoute end-to-end journeys (demo backend)', () => {
  let b: DemoBackend
  let s1: ReturnType<typeof memoryStore>
  beforeEach(() => {
    s1 = memoryStore()
    b = new DemoBackend(s1, { now })
  })

  it('A–D: donor submits → org accepts → partner delivers → org confirms → completed', async () => {
    // TEST A — donor searches books and submits
    const orgs = await b.listPublicOrganizations()
    const { results } = searchOrganizations(orgs, { q: 'books' })
    expect(results.length).toBeGreaterThan(0)
    const target = results.find((r) => r.org.slug === 'sunbeam')!
    expect(target).toBeTruthy()

    await signIn(b, '9876500000', { fullName: 'Test Donor' })
    const [req] = await b.submitDonation(booksSubmission(target.org.id))
    expect(req.status).toBe('pending_organization_confirmation')
    expect(req.code).toMatch(/^KR-[A-Z0-9]{4}-[A-Z0-9]{4}$/)
    expect((await b.getDonation(req.code)).request.status).toBe('pending_organization_confirmation')

    // TEST B — organisation accepts
    await b.signOut()
    await signIn(b, '0000000002')
    const incoming = await b.listOrgRequests()
    const mine = incoming.find((v) => v.request.id === req.id)!
    expect(mine.donor.phone).toBeUndefined()
    expect(mine.donor.address).toBeUndefined()
    expect(mine.donor.displayName).toBe('Test')
    await b.orgDecide(req.id, 'accept')
    expect((await b.getDonation(req.id)).request.status).toBe('awaiting_delivery_partner')

    // TEST C — partner accepts, picks up, delivers
    await b.signOut()
    await signIn(b, '0000000004')
    const jobs = await b.listAvailableJobs()
    const job = jobs.find((j) => j.requestCode === req.code)!
    expect(job.pickupLocality).toBe('Kothrud')
    expect(JSON.stringify(job)).not.toContain('Test Lane') // no address before claim
    await b.claimJob(job.job.id, job.job.version)
    let v = await b.getDonation(req.id)
    expect(v.donor.address?.line1).toContain('Test Lane') // assigned partner sees address
    await b.partnerAdvance(req.id, 'pickup_scheduled')
    await b.partnerAdvance(req.id, 'picked_up', { note: 'Collected 10 books' })
    await b.partnerAdvance(req.id, 'in_transit')
    await expect(b.partnerAdvance(req.id, 'delivered_pending_receipt_confirmation')).rejects.toThrow(/proof/i)
    await b.partnerAdvance(req.id, 'delivered_pending_receipt_confirmation', { note: 'Received by front desk' })
    v = await b.getDonation(req.id)
    expect(v.request.status).toBe('delivered_pending_receipt_confirmation')

    // TEST D — org confirms receipt, donor sees completed
    await b.signOut()
    await signIn(b, '0000000002')
    await b.orgConfirmReceipt(req.id, 'All good')
    await b.signOut()
    await signIn(b, '9876500000')
    const history = await b.listMyDonations()
    expect(history[0].request.status).toBe('completed')
    expect(history[0].events.map((e) => e.to)).toEqual([
      'pending_organization_confirmation', 'organization_accepted', 'awaiting_delivery_partner', 'delivery_partner_assigned', 'pickup_scheduled', 'picked_up', 'in_transit', 'delivered_pending_receipt_confirmation', 'completed',
    ])
    const notes = await b.listNotifications()
    expect(notes.some((n) => n.title === 'Donation completed')).toBe(true)
  })

  it('cannot skip states or let the wrong role act', async () => {
    await signIn(b, '9876500000', { fullName: 'Test Donor' })
    const [req] = await b.submitDonation(booksSubmission('org-sunbeam'))
    await expect(b.orgDecide(req.id, 'accept')).rejects.toThrow(/organisation staff/i) // donor is not staff
    await b.signOut()
    await signIn(b, '0000000003') // staff of a different org
    await expect(b.orgDecide(req.id, 'accept')).rejects.toMatchObject({ code: 'forbidden' })
    await b.signOut()
    await signIn(b, '0000000002')
    await expect(b.orgConfirmReceipt(req.id)).rejects.toThrow(/cannot move/)
  })

  it('E: search for food returns only organisations accepting food', async () => {
    const orgs = await b.listPublicOrganizations()
    const { results } = searchOrganizations(orgs, { q: 'food' })
    const slugs = results.map((r) => r.org.slug).sort()
    expect(slugs).toEqual(['banyan', 'harbour', 'hearth', 'sunbeam'])
    expect(slugs).not.toContain('lanterns')
    expect(results[0].org.slug).toBe('hearth') // has current high-urgency food needs
    const books = searchOrganizations(orgs, { q: 'orphanages needing books' }).results.map((r) => r.org.slug)
    expect(books).toEqual(['sunbeam'])
    const elderClothes = searchOrganizations(orgs, { q: 'old-age homes needing clothes' }).results.map((r) => r.org.slug)
    expect(elderClothes).toContain('banyan')
    expect(elderClothes).not.toContain('sunbeam')
    const near = searchOrganizations(orgs, { q: 'organisations near Kothrud' })
    expect(near.results.every((r) => (r.distanceKm ?? 99) <= 8)).toBe(true)
    expect(searchOrganizations(orgs, { q: 'winter clothes', needsOnly: true }).results.map((r) => r.org.slug)).toContain('sunbeam')
    // pending / needs-info orgs are never public
    expect(orgs.some((o) => o.slug === 'greenleaf' || o.slug === 'riverside')).toBe(false)
  })

  it('F: unauthorised users cannot reach private data or admin features', async () => {
    await expect(b.listMyDonations()).rejects.toMatchObject({ code: 'unauthenticated' })
    await signIn(b, '9876500000', { fullName: 'Nosy User' })
    await expect(b.getDonation('KR-DEMO-0001')).rejects.toMatchObject({ code: 'forbidden' })
    await expect(b.adminListOrganizations()).rejects.toMatchObject({ code: 'forbidden' })
    await expect(b.adminListAudit()).rejects.toMatchObject({ code: 'forbidden' })
    await expect(b.listAvailableJobs()).rejects.toMatchObject({ code: 'forbidden' })
    await expect(b.listOrgRequests()).rejects.toMatchObject({ code: 'forbidden' })
    const session = await b.getSession()
    expect(session!.roles.map((r) => r.role)).toEqual(['donor']) // signup never grants elevated roles
    // public org data never includes registration numbers
    const pub = await b.getPublicOrganization('sunbeam')
    expect(pub && 'registrationNumber' in pub).toBe(false)
  })

  it('prevents two partners claiming the same job', async () => {
    await signIn(b, '9876500000', { fullName: 'Test Donor' })
    const [req] = await b.submitDonation(booksSubmission('org-sunbeam'))
    await b.signOut()
    await signIn(b, '0000000002')
    await b.orgDecide(req.id, 'accept')
    await b.signOut()
    await signIn(b, '0000000004')
    const [job] = (await b.listAvailableJobs()).filter((j) => j.requestCode === req.code)
    // A second tab/partner sharing the same store
    const b2 = new DemoBackend(s1, { now })
    await b.claimJob(job.job.id, job.job.version)
    await b2.signOut()
    await signIn(b2, '0000000005')
    await expect(b2.claimJob(job.job.id, job.job.version)).rejects.toMatchObject({ code: 'conflict' })
    // the losing partner cannot see the donor address
    await expect(b2.getDonation(req.id)).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('enforces item safety and organisation policies', async () => {
    await signIn(b, '9876500000', { fullName: 'Test Donor' })
    const base = booksSubmission('org-hearth')
    const expired = { ...base, items: [{ orgId: 'org-hearth', categoryId: 'packaged_food' as const, name: 'Rice', quantity: 5, unit: 'kg' as const, condition: 'new' as const, food: { kind: 'packaged' as const, expiryDate: '2020-01-01', packaging: 'bag', storage: 'room' as const, sealed: true } }] }
    await expect(b.submitDonation(expired)).rejects.toThrow(/expiry/i)
    const meds = { ...base, items: [{ orgId: 'org-banyan', categoryId: 'medical' as const, name: 'Paracetamol tablets', quantity: 5, unit: 'pieces' as const, condition: 'new' as const }] }
    await expect(b.submitDonation(meds)).rejects.toThrow(/medicines/i)
    await expect(b.submitDonation(base)).rejects.toThrow(/does not accept books/i) // community kitchen
    const unconsented = { ...booksSubmission('org-sunbeam'), consent: false }
    await expect(b.submitDonation(unconsented)).rejects.toThrow(/privacy/i)
  })

  it('organisations become public only after admin verification', async () => {
    await signIn(b, '9876500001', { fullName: 'New Org Rep' })
    const org = await b.registerOrganization({
      name: 'Test Care Trust', type: 'ngo', intro: 'x', locality: 'Baner', address: '1 Test Road, Baner', pinCode: '411045',
      publicPhone: '9876500001', publicEmail: 'test@example.org', registrationType: 'Trust', registrationNumber: 'T-1',
      deliveryMethods: ['partner_pickup'], acceptedCategories: ['books'],
    })
    expect((await b.listPublicOrganizations()).some((o) => o.id === org.id)).toBe(false)
    await b.signOut()
    await signIn(b, '0000000009')
    await expect(b.adminReviewOrganization(org.id, 'approved', '', { contactVerified: true, addressVerified: true })).rejects.toThrow(/document/i)
    const row = (await b.adminListOrganizations()).find((r) => r.org.id === org.id)!
    expect(row.docs.length).toBe(0)
    await b.signOut()
    await signIn(b, '9876500001')
    await b.uploadOrgDocument('Registration certificate', { name: 'cert.png', dataUrl: 'data:image/png;base64,AAAA' })
    await b.signOut()
    await signIn(b, '0000000009')
    const doc = (await b.adminListOrganizations()).find((r) => r.org.id === org.id)!.docs[0]
    await b.adminReviewDocument(doc.id, 'accepted')
    await b.adminReviewOrganization(org.id, 'approved', 'Checked', { contactVerified: true, addressVerified: true })
    expect((await b.listPublicOrganizations()).some((o) => o.id === org.id)).toBe(true)
    expect((await b.adminListAudit()).some((a) => a.action === 'organization.approved' && a.entityId === org.id)).toBe(true)
  })

  it('rate-limits OTP requests and rejects wrong codes', async () => {
    await b.requestOtp('9876500002')
    await expect(b.requestOtp('9876500002')).rejects.toMatchObject({ code: 'rate_limited' })
    await expect(b.verifyOtp('9876500002', '000000', { fullName: 'X Y' })).rejects.toThrow(/incorrect/i)
  })
})
