// LIVE end-to-end journey against a SEPARATE Supabase TEST project (never production).
// Runs the real SupabaseBackend + supabase-js against real PostgREST, GoTrue, Storage and Realtime.
//
// Opt-in: skipped unless .env.testproject.local (git-ignored) has KR_TEST_SUPABASE_URL and KR_TEST_SUPABASE_KEY.
// Test project setup (README → "Live test project"): apply the 4 migrations, turn OFF "Confirm email",
// run `update app_settings set environment = 'staging', require_phone_for_donation = false;`,
// then bootstrap the test admin printed by the first run.
//
// Accounts and organisations created here are named "[TEST]" and live only in the test project.
// The test is re-runnable: accounts, the organisation and partner approvals are reused; each run adds one donation.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { SupabaseBackend } from '../../src/services/supabaseBackend'
import { AppError } from '../../src/services/backend'

const ENV_FILE = join(__dirname, '..', '..', '.env.testproject.local')
const env: Record<string, string> = existsSync(ENV_FILE)
  ? Object.fromEntries(readFileSync(ENV_FILE, 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]))
  : {}
const URL_ = env.KR_TEST_SUPABASE_URL
const KEY = env.KR_TEST_SUPABASE_KEY
const PASSWORD = env.KR_TEST_PASSWORD
const DOMAIN = env.KR_TEST_EMAIL_DOMAIN || 'example.com'
const enabled = !!(URL_ && KEY && PASSWORD)

;(globalThis as { location?: { origin: string } }).location ??= { origin: 'http://localhost:5199' }

// 1×1 JPEG
const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA='
const PDF = 'data:application/pdf;base64,' + Buffer.from('%PDF-1.4\n% KindRoute TEST document\n%%EOF').toString('base64')
const email = (role: string) => `kindroute.test.${role}@${DOMAIN}`
const plusDays = (n: number) => new Date(Date.now() + 5.5 * 3600_000 + n * 86_400_000).toISOString().slice(0, 10)

function backend(realtime = false) {
  const mem = new Map<string, string>()
  const client = createClient(URL_, KEY, {
    // each simulated browser needs its own storage key: in one Node process supabase-js shares its auth lock per key
    auth: { storageKey: `kr-live-${crypto.randomUUID()}`, persistSession: true, autoRefreshToken: false, detectSessionInUrl: false, storage: { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, v), removeItem: (k) => void mem.delete(k) } },
  })
  return { b: new SupabaseBackend(URL_, KEY, { client, realtime }), client }
}

async function account(role: string, name: string, realtime = false) {
  const x = backend(realtime)
  try {
    await x.b.signInWithEmail(email(role), PASSWORD)
  } catch (e) {
    if (!(e instanceof AppError) || !/Incorrect email or password/.test(e.message)) throw e
    const r = await x.b.signUpWithEmail({ email: email(role), password: PASSWORD, fullName: name })
    if (r.needsEmailConfirmation) throw new Error('The TEST project still has "Confirm email" ON — turn it off for the test project only (Authentication → Sign In / Providers → Email).')
  }
  return x
}

const code = async (p: Promise<unknown>) => p.then(() => 'ok', (e) => (e instanceof AppError ? e.code : String(e)))

describe.skipIf(!enabled)('LIVE journey on the Supabase TEST project', () => {
  let admin: SupabaseBackend, staff: SupabaseBackend, donor: SupabaseBackend, p1: SupabaseBackend, p2: SupabaseBackend
  let donorClient: ReturnType<typeof createClient>
  let orgId = ''
  let requestId = ''

  beforeAll(async () => {
    admin = (await account('admin', '[TEST] Admin')).b
    const s = await admin.getSession()
    if (!s?.roles.some((r) => r.role === 'admin'))
      throw new Error(`Test admin is not an admin yet. In the TEST project's SQL Editor run:  select kr_bootstrap_first_admin('${email('admin')}');  then re-run.`)
    // TEST project only: the test donor submits every run, so lift the 5-per-day limit (the limit itself is covered by the offline tests)
    await admin.getAuthCapabilities()
    await (admin as unknown as { rpc: (fn: string, a: unknown) => Promise<unknown> }).rpc('admin_update_settings', { p: { maxSubmissionsPerDay: 100 } })
    staff = (await account('org', '[TEST] Org Staff')).b
    const d = await account('donor', '[TEST] Donor', true)
    donor = d.b
    donorClient = d.client
    p1 = (await account('partner1', '[TEST] Partner One')).b
    p2 = (await account('partner2', '[TEST] Partner Two')).b
    const settings = await (await admin.getAuthCapabilities())
    if (settings.requirePhoneForDonation) throw new Error("Run in the TEST project: update app_settings set environment = 'staging', require_phone_for_donation = false;")
  }, 120_000)

  it('A. session restore and sign-out with real Supabase Auth', async () => {
    const x = await account('donor', '[TEST] Donor')
    expect((await x.b.getSession())?.user.email).toBe(email('donor'))
    const again = new SupabaseBackend(URL_, KEY, { client: x.client, realtime: false }) // same stored session = page reload
    expect((await again.getSession())?.user.fullName).toBe('[TEST] Donor')
    await again.signOut()
    expect(await again.getSession()).toBeNull()
    expect(await code(backend().b.signInWithEmail(email('donor'), PASSWORD + 'x'))).toBe('invalid')
    expect(await code(backend().b.signUpWithEmail({ email: email('donor'), password: PASSWORD, fullName: 'dup' }))).toBe('invalid')
  })

  it('B. organisation onboarding with a private document upload and admin approval', async () => {
    let ws = await staff.getMyOrganization()
    if (!ws) {
      await staff.registerOrganization({ name: '[TEST] KindRoute Test Organisation', type: 'children_home', intro: 'Test-only record in the TEST project.', locality: 'Kothrud', address: 'TEST ONLY — not a real address, Kothrud', pinCode: '411038',
        publicPhone: '', publicEmail: email('org'), registrationType: 'Trust', registrationNumber: 'TEST-0001', deliveryMethods: ['partner_pickup', 'donor_dropoff'], acceptedCategories: ['books', 'packaged_food'] })
      ws = (await staff.getMyOrganization())!
    }
    orgId = ws.org.id
    if (!ws.docs.length) await staff.uploadOrgDocument('Registration certificate (TEST)', { name: 'test.pdf', dataUrl: PDF })
    ws = (await staff.getMyOrganization())!
    const docUrl = await admin.getDocumentUrl(ws.docs[0])
    expect((await fetch(docUrl!)).status).toBe(200) // signed URL works for admin
    expect(await code(donor.getDocumentUrl(ws.docs[0]))).not.toBe('ok') // and is refused to anyone else
    if (ws.org.status !== 'approved') {
      await admin.adminReviewDocument(ws.docs[0].id, 'accepted', 'TEST document')
      await admin.adminReviewOrganization(orgId, 'approved', 'TEST approval', { contactVerified: true, addressVerified: true })
    }
    await staff.savePolicy({ categoryId: 'books', acceptance: 'accepts', conditionsAccepted: ['new', 'like_new', 'gently_used'] })
    ws = (await staff.getMyOrganization())!
    if (!ws.needs.some((n) => n.status === 'open' && n.categoryId === 'books')) await staff.saveNeed({ categoryId: 'books', title: '[TEST] Class 7 textbooks', urgency: 'high', quantity: 500, unit: 'pieces', tags: ['school'] })
    else await staff.confirmNeed(ws.needs.find((n) => n.status === 'open' && n.categoryId === 'books')!.id)
    expect((await staff.getMyOrganization())!.org.status).toBe('approved')
  })

  it('C/D. server-side search', async () => {
    const page = await backend().b.searchOrganizations({ q: 'books' }, { offset: 0, limit: 12 })
    const hit = page.results.find((r) => r.org.id === orgId)!
    expect(hit.standing.books).toBe('currently_needed')
    expect((hit.org as Record<string, unknown>).registrationNumber).toBeUndefined()
    const fresh = await backend().b.searchOrganizations({ q: 'cooked meals' }, { offset: 0, limit: 12 })
    expect(fresh.results.some((r) => r.org.id === orgId)).toBe(false) // org does not accept fresh food
  })

  it('E/F/O. submission with photo, idempotent retry, redacted org view, accept — with a realtime notification', async () => {
    const input = {
      clientRequestId: crypto.randomUUID(),
      items: [{ orgId, categoryId: 'books' as const, name: '[TEST] Class 7 textbooks', quantity: 5, unit: 'pieces' as const, condition: 'gently_used' as const, photo: JPEG }],
      methods: { [orgId]: 'partner_pickup' as const }, donor: { fullName: '[TEST] Donor', contactMethod: 'email' as const },
      pickup: { line1: 'TEST ONLY pickup address', locality: 'Kothrud', pinCode: '411038' }, preferredDate: plusDays(2), preferredSlot: '09:00 – 12:00', consent: true,
    }
    const [r] = await donor.submitDonation(input)
    requestId = r.id
    expect(r.status).toBe('pending_organization_confirmation')
    expect((await donor.submitDonation(input))[0].id).toBe(r.id)
    const v = await donor.getDonation(r.code)
    expect((await fetch(v.items[0].photo!)).status).toBe(200) // private photo via signed URL
    const ov = (await staff.listOrgRequests()).find((x) => x.request.id === r.id)!
    expect(ov.donor.address).toBeUndefined()
    expect(ov.donor.displayName).toBe('[TEST]')
    expect(await code(donor.orgDecide(r.id, 'accept'))).toBe('forbidden')

    const { data: me } = await donorClient.auth.getUser()
    const got = new Promise<boolean>((resolve) => {
      const ch = donorClient.channel('live-test').on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `recipient_user_id=eq.${me.user!.id}` }, () => { resolve(true); void ch.unsubscribe() })
      ch.subscribe(async (status) => {
        if (status === 'SUBSCRIBED') await staff.orgDecide(r.id, 'accept')
      })
      setTimeout(() => resolve(false), 20_000)
    })
    const realtimeWorked = await got
    expect((await donor.getDonation(r.id)).request.status).toBe('awaiting_delivery_partner')
    console.log('Realtime notification received:', realtimeWorked)
    expect(realtimeWorked).toBe(true)
  }, 60_000)

  it('H/I/O. partners: unapproved refused; two simultaneous claims → exactly one wins', async () => {
    for (const p of [p1, p2]) if (!(await p.getMyPartnerProfile())) await p.applyAsPartner({ fullName: '[TEST] Partner', vehicle: 'van', serviceLocalities: [], idDocument: { name: 'id.jpg', dataUrl: JPEG }, consent: true })
    for (const { partner, docs } of await admin.adminListPartners()) {
      if (partner.status === 'approved') continue
      // I: before approval the partner is refused (only observable on the first run, while still pending)
      const pending = partner.userId === (await p1.getSession())!.user.id ? p1 : p2
      expect(await code(pending.listAvailableJobs())).toBe('forbidden')
      expect(await code(pending.setAvailability(true))).toBe('forbidden')
      await admin.adminReviewDocument(docs[0].id, 'accepted', 'TEST ID')
      await admin.adminReviewPartner(partner.id, 'approved', 'TEST approval')
    }
    await p1.setAvailability(true)
    await p2.setAvailability(true)
    const job = (await p1.listAvailableJobs()).find((j) => j.job.requestId === requestId)!
    expect(JSON.stringify(job)).not.toContain('TEST ONLY pickup address')
    const results = await Promise.allSettled([p1.claimJob(job.job.id, job.job.version), p2.claimJob(job.job.id, job.job.version)])
    expect(results.filter((x) => x.status === 'fulfilled').length).toBe(1)
    expect(((results.find((x) => x.status === 'rejected') as PromiseRejectedResult).reason as AppError).code).toBe('conflict')
  }, 60_000)

  it('J/K/L/M. pickup → delivery with proof → only the org completes → donor history', async () => {
    const winner = (await p1.listMyJobs()).some((v) => v.request.id === requestId) ? p1 : p2
    const loser = winner === p1 ? p2 : p1
    expect(await code(loser.getDonation(requestId))).toBe('forbidden')
    const mine = (await winner.listMyJobs()).find((v) => v.request.id === requestId)!
    expect(mine.donor.address?.line1).toBe('TEST ONLY pickup address')
    await winner.partnerAdvance(requestId, 'pickup_scheduled')
    await winner.partnerAdvance(requestId, 'picked_up', { note: 'TEST pickup', photo: JPEG })
    await winner.partnerAdvance(requestId, 'in_transit')
    await winner.partnerAdvance(requestId, 'delivered_pending_receipt_confirmation', { note: 'TEST front desk', photo: JPEG })
    expect(await code(winner.orgConfirmReceipt(requestId))).toBe('forbidden')
    expect(await code(admin.adminTransition(requestId, 'completed', 'TEST force'))).toBe('invalid')
    await staff.orgConfirmReceipt(requestId, 'TEST received')
    const done = (await donor.listMyDonations()).find((v) => v.request.id === requestId)!
    expect(done.request.status).toBe('completed')
    expect(done.events.map((e) => e.to)).toEqual(['pending_organization_confirmation', 'organization_accepted', 'awaiting_delivery_partner', 'delivery_partner_assigned',
      'pickup_scheduled', 'picked_up', 'in_transit', 'delivered_pending_receipt_confirmation', 'completed'])
    const proof = done.proofs.find((p) => p.photo)!
    expect((await fetch(proof.photo!)).status).toBe(200)
    // M: the storage object is not reachable without a signed URL
    const raw = proof.photo!.split('?')[0].replace('/object/sign/', '/object/public/')
    expect((await fetch(raw)).status).not.toBe(200)
  }, 90_000)

  it('N. privilege escalation over the live API is refused', async () => {
    expect(await code(donor.adminStats())).toBe('forbidden')
    const { error } = await donorClient.from('user_roles').insert({ user_id: (await donorClient.auth.getUser()).data.user!.id, role: 'admin' })
    expect(error).not.toBeNull()
    const { error: e2 } = await donorClient.rpc('kr_apply_transition', { p_request: requestId, p_to: 'cancelled', p_actor: 'admin' })
    expect(e2?.message).toMatch(/permission denied/)
    const { data: addrs } = await (await account('partner2', '[TEST] Partner Two')).client.from('pickup_addresses').select('*')
    expect(addrs ?? []).toEqual([])
  }, 60_000)
})
