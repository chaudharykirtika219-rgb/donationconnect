// Browser-local implementation of the Backend contract, used when Supabase is not configured.
// It enforces the same rules the SQL layer enforces (roles, redaction, state machine, atomic claims),
// but because it runs in the browser it is a functional simulation, NOT a security boundary.

import type {
  Actor, ApprovalStatus, AppNotification, CategoryId, DonationItem, DonationRequest, DonationStatus,
  DonationView, ImpactStats, JobListing, Organization, OrgItemPolicy, PackageSize, PickupAddress, Profile, PublicOrganization,
  Report, Role, Session, ViewerKind, OrgType,
} from '../lib/types'
import {
  AppError, type Backend, type DonationSubmission, type OrgRegistration, type PartnerApplication, type PartnerStep,
  type AdminStats, type OrgEditable, type AuthCapabilities, type EmailSignUp,
} from './backend'
import { DB_VERSION, type DB } from './db'
import { buildSeed } from '../data/seed'
import { canTransition, STATUS_META, isOpen } from '../lib/status'
import { policyAccepts, searchOrganizations, type SearchParams } from '../lib/search'
import { checkAgainstPolicy, firstName, FLAG_QTY, isEmail, normalizePhone, passwordProblem, validateItem } from '../lib/validation'
import { distanceKm, isPunePin, localityByName } from '../data/localities'
import { nameKey, parseCsv } from '../lib/csv'
import { ORG_TYPES, PICKUP_SLOTS } from '../data/categories'
import { localDateIso } from '../lib/format'

export interface KVStore {
  get(key: string): string | null
  set(key: string, value: string): void
  remove(key: string): void
}

export const memoryStore = (): KVStore => {
  const m = new Map<string, string>()
  return { get: (k) => m.get(k) ?? null, set: (k, v) => void m.set(k, v), remove: (k) => void m.delete(k) }
}

export const browserStore = (): KVStore => ({
  get: (k) => {
    try {
      return localStorage.getItem(k)
    } catch {
      return null
    }
  },
  set: (k, v) => {
    try {
      localStorage.setItem(k, v)
    } catch {
      throw new AppError('unavailable', 'Browser storage is full or blocked. Remove photos or reset the demo data.')
    }
  },
  remove: (k) => {
    try {
      localStorage.removeItem(k)
    } catch {
      /* ignore */
    }
  },
})

const DB_KEY = 'kindroute.demo.db'
const SESSION_KEY = 'kindroute.demo.session'
const OTP_TTL = 5 * 60_000
const OTP_COOLDOWN = 30_000
const MAX_PHOTO = 450_000
const MAX_ACTIVE_JOBS = 3

const uid = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`)
const codeChars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const requestCode = () => {
  const pick = () => codeChars[Math.floor(Math.random() * codeChars.length)]
  return `KR-${Array.from({ length: 4 }, pick).join('')}-${Array.from({ length: 4 }, pick).join('')}`
}

async function sha256(text: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
/** milestone timestamps on the request row (mirrors kr_apply_transition in SQL) */
const STAMP: Partial<Record<DonationStatus, 'submittedAt' | 'acceptedAt' | 'pickedUpAt' | 'deliveredAt' | 'completedAt'>> = {
  pending_organization_confirmation: 'submittedAt',
  organization_accepted: 'acceptedAt',
  picked_up: 'pickedUpAt',
  delivered_pending_receipt_confirmation: 'deliveredAt',
  completed: 'completedAt',
}
const LOGIN_WINDOW = 15 * 60_000
const RESET_TTL = 30 * 60_000

const err = {
  auth: () => new AppError('unauthenticated', 'Please sign in to continue.'),
  forbidden: (m = 'You do not have permission to do that.') => new AppError('forbidden', m),
  notFound: (m = 'Not found.') => new AppError('not_found', m),
  invalid: (m: string) => new AppError('invalid', m),
}

export class DemoBackend implements Backend {
  readonly mode = 'demo' as const
  private listeners = new Set<() => void>()
  private chain: Promise<unknown> = Promise.resolve()
  private channel?: BroadcastChannel
  private now: () => Date
  private latency: number

  constructor(private store: KVStore, opts: { now?: () => Date; latencyMs?: number } = {}) {
    this.now = opts.now ?? (() => new Date())
    this.latency = opts.latencyMs ?? 0
    if (typeof BroadcastChannel !== 'undefined') {
      this.channel = new BroadcastChannel('kindroute-demo')
      this.channel.onmessage = () => this.emit(false)
    }
    if (typeof window !== 'undefined')
      window.addEventListener('storage', (e) => {
        if (e.key === DB_KEY) this.emit(false)
      })
  }

  /* ------------------------------------------------------------ plumbing */

  subscribe(fn: () => void) {
    this.listeners.add(fn)
    return () => void this.listeners.delete(fn)
  }

  private emit(broadcast = true) {
    this.listeners.forEach((f) => f())
    if (broadcast) this.channel?.postMessage('changed')
  }

  private load(): DB {
    const raw = this.store.get(DB_KEY)
    if (raw) {
      try {
        const db = JSON.parse(raw) as DB
        if (db.version === DB_VERSION) return db
      } catch {
        /* fall through and reseed */
      }
    }
    const db = buildSeed(this.now())
    this.store.set(DB_KEY, JSON.stringify(db))
    return db
  }

  /** Serialised read-modify-write. Uses Web Locks across tabs when available. */
  private tx<T>(fn: (db: DB) => T, write = true): Promise<T> {
    const run = async () => {
      if (this.latency) await new Promise((r) => setTimeout(r, this.latency))
      const exec = () => {
        const db = this.load()
        const out = fn(db)
        if (write) this.store.set(DB_KEY, JSON.stringify(db))
        return out
      }
      const locks = (globalThis.navigator as Navigator | undefined)?.locks
      const out = locks ? await locks.request('kindroute-demo-db', async () => exec()) : exec()
      if (write) this.emit()
      return structuredClone(out) as T
    }
    const p = this.chain.then(run, run)
    this.chain = p.catch(() => undefined)
    return p
  }
  private read<T>(fn: (db: DB) => T) {
    return this.tx(fn, false)
  }

  private ts() {
    return this.now().toISOString()
  }
  private sessionUserId() {
    return this.store.get(SESSION_KEY)
  }
  private me(db: DB): Profile {
    const id = this.sessionUserId()
    const p = id && db.profiles.find((x) => x.id === id)
    if (!p) throw err.auth()
    return p
  }
  private roles(db: DB, userId: string) {
    return db.userRoles.filter((r) => r.userId === userId)
  }
  private has(db: DB, userId: string, role: Role) {
    return this.roles(db, userId).some((r) => r.role === role)
  }
  private requireAdmin(db: DB) {
    const me = this.me(db)
    if (!this.has(db, me.id, 'admin')) throw err.forbidden('Administrator access only.')
    return me
  }
  private staffOrg(db: DB, userId: string) {
    const r = this.roles(db, userId).find((x) => x.role === 'org_staff')
    return r?.orgId ? db.organizations.find((o) => o.id === r.orgId) : undefined
  }
  private requireStaff(db: DB) {
    const me = this.me(db)
    const org = this.staffOrg(db, me.id)
    if (!org) throw err.forbidden('Only authorised organisation staff can do this.')
    return { me, org }
  }
  private partnerFor(db: DB, userId: string) {
    return db.partners.find((p) => p.userId === userId)
  }
  private requireApprovedPartner(db: DB) {
    const me = this.me(db)
    const p = this.partnerFor(db, me.id)
    if (!p || p.status !== 'approved' || !this.has(db, me.id, 'delivery_partner'))
      throw err.forbidden('Only approved delivery partners can do this.')
    return { me, partner: p }
  }
  private audit(db: DB, actorId: string, action: string, entity: string, entityId: string, details?: string) {
    db.audit.unshift({ id: uid(), actorId, action, entity, entityId, details, at: this.ts() })
  }
  private notify(db: DB, userIds: string[], n: Omit<AppNotification, 'id' | 'userId' | 'read' | 'at'>) {
    for (const userId of new Set(userIds)) db.notifications.unshift({ id: uid(), userId, read: false, at: this.ts(), ...n })
  }
  private staffIds(db: DB, orgId: string) {
    return db.userRoles.filter((r) => r.role === 'org_staff' && r.orgId === orgId).map((r) => r.userId)
  }
  private adminIds(db: DB) {
    return db.userRoles.filter((r) => r.role === 'admin').map((r) => r.userId)
  }
  private req(db: DB, idOrCode: string) {
    const r = db.requests.find((x) => x.id === idOrCode || x.code === idOrCode.toUpperCase())
    if (!r) throw err.notFound('Donation request not found.')
    return r
  }
  private pickupLocality(db: DB, r: DonationRequest) {
    return db.pickupAddresses.find((a) => a.id === r.pickupAddressId)?.locality
  }

  /** Validates and applies a status change, writes the event + audit trail, sends notifications. */
  private transition(db: DB, r: DonationRequest, to: DonationStatus, actor: Actor, actorId: string, note?: string) {
    if (!canTransition(r.status, to, actor, r.deliveryMethod))
      throw err.invalid(`This request cannot move from “${STATUS_META[r.status].label}” to “${STATUS_META[to].label}”.`)
    const from = r.status
    r.status = to
    r.updatedAt = this.ts()
    const stamp = STAMP[to]
    if (stamp) r[stamp] = this.ts()
    db.events.push({ id: uid(), requestId: r.id, from, to, actorId, actor, note, at: this.ts() })
    this.audit(db, actorId, `donation.${to}`, 'donation_request', r.id, note)

    const org = db.organizations.find((o) => o.id === r.orgId)!
    const staff = this.staffIds(db, r.orgId)
    const job = db.jobs.find((j) => j.requestId === r.id)
    const partnerUser = job?.partnerId ? db.partners.find((p) => p.id === job.partnerId)?.userId : undefined
    const track = `/track/${r.code}`
    const base = { link: track }
    switch (to) {
      case 'pending_organization_confirmation':
        this.notify(db, staff, { title: 'New donation request', body: `${r.code} is waiting for your decision.`, link: '/portal/organization' })
        this.notify(db, [r.donorId], { title: 'Request submitted', body: `${r.code} was sent to ${org.name}. It is not a confirmed pickup yet.`, ...base })
        break
      case 'organization_accepted':
        this.notify(db, [r.donorId], { title: `${org.name} accepted your donation`, body: r.deliveryMethod === 'donor_dropoff' ? 'You can drop the items off during their drop-off hours.' : 'We are finding a delivery partner.', ...base })
        break
      case 'awaiting_delivery_partner': {
        const loc = this.pickupLocality(db, r)
        const eligible = db.partners.filter((p) => p.status === 'approved' && p.available && (!p.serviceLocalities.length || (loc && p.serviceLocalities.includes(loc))))
        this.notify(db, eligible.map((p) => p.userId), { title: 'New delivery job available', body: `Pickup in ${loc ?? 'Pune'} → ${org.locality}.`, link: '/portal/partner' })
        break
      }
      case 'delivery_partner_assigned':
        this.notify(db, [r.donorId, ...staff], { title: 'Delivery partner assigned', body: `A partner accepted ${r.code}.`, ...base })
        break
      case 'pickup_scheduled':
        this.notify(db, [r.donorId], { title: 'Pickup scheduled', body: `Your pickup is confirmed for ${r.preferredDate}, ${r.preferredSlot}.`, ...base })
        break
      case 'picked_up':
      case 'in_transit':
        this.notify(db, [r.donorId, ...staff], { title: STATUS_META[to].label, body: `${r.code}: ${STATUS_META[to].explain}`, ...base })
        break
      case 'delivered_pending_receipt_confirmation':
        this.notify(db, staff, { title: 'Please confirm receipt', body: `${r.code} was marked delivered. Confirm once you have the items.`, link: '/portal/organization' })
        this.notify(db, [r.donorId], { title: 'Delivered', body: `Waiting for ${org.name} to confirm receipt.`, ...base })
        break
      case 'completed':
        this.notify(db, [r.donorId, ...(partnerUser ? [partnerUser] : [])], { title: 'Donation completed', body: `${org.name} confirmed receipt of ${r.code}. Thank you.`, ...base })
        break
      case 'rejected':
        this.notify(db, [r.donorId], { title: 'Request declined', body: `${org.name}: ${r.rejectionReason ?? 'no reason given'}.`, ...base })
        break
      case 'cancelled':
        this.notify(db, [r.donorId, ...staff, ...(partnerUser ? [partnerUser] : [])], { title: 'Request cancelled', body: `${r.code} was cancelled.`, ...base })
        break
      case 'failed':
        this.notify(db, [r.donorId, ...staff, ...this.adminIds(db)], { title: 'Delivery needs rescheduling', body: `${r.code}: ${r.failureReason ?? 'see timeline'}.`, ...base })
        break
    }
  }

  /** Redacted projection of a request for a given viewer. Throws if the viewer has no relationship to it. */
  private view(db: DB, r: DonationRequest, viewerId: string): DonationView {
    const isAdmin = this.has(db, viewerId, 'admin')
    const job = db.jobs.find((j) => j.requestId === r.id)
    const partner = job?.partnerId ? db.partners.find((p) => p.id === job.partnerId) : undefined
    const isAssignedPartner = !!partner && partner.userId === viewerId
    const isStaff = this.staffOrg(db, viewerId)?.id === r.orgId
    const isDonor = r.donorId === viewerId
    let viewer: ViewerKind
    if (isDonor) viewer = 'donor'
    else if (isStaff) viewer = 'org'
    else if (isAssignedPartner) viewer = 'partner'
    else if (isAdmin) viewer = 'admin'
    else throw err.forbidden('You do not have access to this donation request.')
    if (isAdmin && !isDonor) viewer = 'admin'

    const donor = db.profiles.find((p) => p.id === r.donorId)!
    const org = db.organizations.find((o) => o.id === r.orgId)!
    const address = db.pickupAddresses.find((a) => a.id === r.pickupAddressId)
    const fulfilling = isAssignedPartner && job?.state === 'claimed' && ['delivery_partner_assigned', 'pickup_scheduled', 'picked_up', 'in_transit'].includes(r.status)
    const full = viewer === 'donor' || viewer === 'admin'

    return {
      viewer,
      request: { ...r, flagged: viewer === 'partner' ? undefined : r.flagged },
      items: db.requestItems.filter((i) => i.requestId === r.id),
      org: {
        id: org.id, slug: org.slug, name: org.name, type: org.type, locality: org.locality,
        address: viewer === 'partner' ? (fulfilling ? org.address.replace('(shared only with assigned partner)', '') : undefined) : org.address,
        phone: full || fulfilling || viewer === 'org' ? org.publicPhone : undefined,
      },
      donor: {
        displayName: full ? donor.fullName : firstName(donor.fullName),
        locality: address?.locality,
        phone: full || fulfilling ? donor.phone : undefined,
        email: full ? donor.email : undefined,
        address: full || fulfilling ? address : undefined,
      },
      partner: partner && job?.state !== 'open'
        ? { displayName: viewer === 'admin' ? partner.fullName : firstName(partner.fullName), vehicle: partner.vehicle, isDemo: partner.isDemo, phone: viewer === 'admin' || (viewer === 'org' && fulfilling) ? partner.phone : undefined }
        : undefined,
      job,
      events: db.events.filter((e) => e.requestId === r.id).sort((a, b) => a.at.localeCompare(b.at)),
      proofs: db.proofs.filter((p) => p.requestId === r.id),
    }
  }

  private session(db: DB, userId: string): Session {
    return { user: db.profiles.find((p) => p.id === userId)!, roles: this.roles(db, userId) }
  }

  private publicOrg(db: DB, o: Organization): PublicOrganization {
    const { registrationNumber: _r, verifiedBy: _v, verificationNote: _n, ...rest } = o
    const done = db.requests.filter((r) => r.orgId === o.id && r.status === 'completed')
    return {
      ...rest,
      policies: db.itemPolicies.filter((p) => p.orgId === o.id),
      needs: db.needs.filter((n) => n.orgId === o.id && n.status === 'open'),
      impact: o.showImpact ? { completed: done.length, items: db.requestItems.filter((i) => done.some((d) => d.id === i.requestId)).reduce((s, i) => s + i.quantity, 0) } : undefined,
    }
  }

  /* ------------------------------------------------------------ auth */

  async getSession() {
    return this.read((db) => {
      const id = this.sessionUserId()
      return id && db.profiles.some((p) => p.id === id) ? this.session(db, id) : null
    })
  }

  async requestOtp(phoneInput: string) {
    return this.tx((db) => {
      const phone = normalizePhone(phoneInput, true)
      if (!phone) throw err.invalid('Enter a valid 10-digit Indian mobile number.')
      const t = this.now().getTime()
      let rec = db.otps.find((o) => o.phone === phone)
      if (!rec) db.otps.push((rec = { phone, code: '', expiresAt: 0, attempts: 0, sentAt: [] }))
      rec.sentAt = rec.sentAt.filter((s) => t - s < 3_600_000)
      const last = rec.sentAt[rec.sentAt.length - 1]
      if (last && t - last < OTP_COOLDOWN) throw new AppError('rate_limited', `Please wait ${Math.ceil((OTP_COOLDOWN - (t - last)) / 1000)}s before requesting another code.`)
      if (rec.sentAt.length >= 5) throw new AppError('rate_limited', 'Too many codes requested for this number. Try again in an hour.')
      rec.code = String(Math.floor(100000 + Math.random() * 900000))
      rec.expiresAt = t + OTP_TTL
      rec.attempts = 0
      rec.sentAt.push(t)
      // Demo mode: no SMS provider. The code is returned so the UI can show it in a labelled demo inbox.
      return { demoCode: rec.code, cooldownSec: OTP_COOLDOWN / 1000 }
    })
  }

  /** Checks a one-time code. Returns attempts left on a wrong code (the caller throws after the write commits). */
  private checkOtp(db: DB, phoneInput: string, code: string): { ok: true; phone: string } | { ok: false; left: number } {
    const phone = normalizePhone(phoneInput, true)
    if (!phone) throw err.invalid('Enter a valid mobile number.')
    const rec = db.otps.find((o) => o.phone === phone)
    if (!rec || !rec.code) throw err.invalid('Request a code first.')
    if (this.now().getTime() > rec.expiresAt) throw err.invalid('This code has expired. Request a new one.')
    if (rec.attempts >= 5) throw new AppError('rate_limited', 'Too many incorrect attempts. Request a new code.')
    if (rec.code !== code.trim()) {
      rec.attempts++
      return { ok: false, left: 5 - rec.attempts }
    }
    rec.code = ''
    return { ok: true, phone }
  }

  async verifyOtp(phoneInput: string, code: string, signup?: { fullName: string; email?: string }) {
    const result = await this.tx((db) => {
      const check = this.checkOtp(db, phoneInput, code)
      if (!check.ok) return check
      const phone = check.phone
      let profile = db.profiles.find((p) => p.phone === phone)
      if (!profile) {
        const name = signup?.fullName?.trim()
        if (!name || name.length < 2) throw err.invalid('Tell us your name to create an account.')
        if (signup?.email && !isEmail(signup.email)) throw err.invalid('That email address does not look right.')
        profile = { id: uid(), fullName: name, phone, phoneVerified: true, email: signup?.email?.trim() || undefined, createdAt: this.ts(), updatedAt: this.ts(), isDemo: true }
        db.profiles.push(profile)
        // New accounts only ever receive the donor role. Other roles are granted by approval flows.
        db.userRoles.push({ userId: profile.id, role: 'donor', grantedBy: 'system', createdAt: this.ts() })
        this.audit(db, profile.id, 'auth.signup', 'profile', profile.id)
      } else {
        profile.phoneVerified = true
      }
      this.store.set(SESSION_KEY, profile.id)
      this.audit(db, profile.id, 'auth.signin', 'profile', profile.id)
      return { ok: true as const, session: this.session(db, profile.id) }
    })
    if (!result.ok) throw err.invalid(`Incorrect code. ${result.left} attempt${result.left === 1 ? '' : 's'} left.`)
    return result.session
  }

  async updateProfile(patch: { fullName?: string; email?: string }) {
    await this.tx((db) => {
      const me = this.me(db)
      if (patch.fullName !== undefined) {
        if (patch.fullName.trim().length < 2) throw err.invalid('Name is too short.')
        me.fullName = patch.fullName.trim()
      }
      if (patch.email !== undefined) {
        if (patch.email && !isEmail(patch.email)) throw err.invalid('That email address does not look right.')
        me.email = patch.email || undefined
      }
      me.updatedAt = this.ts()
    })
  }

  async signOut() {
    this.store.remove(SESSION_KEY)
    this.emit()
  }

  async getAuthCapabilities(): Promise<AuthCapabilities> {
    return { emailPassword: true, phoneOtp: true, phoneOtpSimulated: true, requirePhoneForDonation: true, emailConfirmationRequired: false }
  }

  async signUpWithEmail(input: EmailSignUp) {
    const email = input.email.trim().toLowerCase()
    if (!isEmail(email)) throw err.invalid('Enter a valid email address.')
    const pw = passwordProblem(input.password)
    if (pw) throw err.invalid(pw)
    if (input.fullName.trim().length < 2) throw err.invalid('Tell us your name.')
    const salt = uid()
    const hash = await sha256(salt + input.password)
    const session = await this.tx((db) => {
      if (db.credentials.some((c) => c.email === email) || db.profiles.some((p) => p.email?.toLowerCase() === email))
        throw err.invalid('An account with this email already exists. Sign in instead, or reset your password.')
      const profile: Profile = { id: uid(), fullName: input.fullName.trim(), phone: '', phoneVerified: false, email, emailVerified: false, accountStatus: 'active', createdAt: this.ts(), updatedAt: this.ts(), isDemo: true }
      db.profiles.push(profile)
      // New accounts only ever receive the donor role. Organisation / partner access comes from approval flows.
      db.userRoles.push({ userId: profile.id, role: 'donor', grantedBy: 'system', createdAt: this.ts() })
      db.credentials.push({ userId: profile.id, email, salt, hash, failed: [] })
      this.store.set(SESSION_KEY, profile.id)
      this.audit(db, profile.id, 'auth.signup', 'profile', profile.id, 'email')
      return this.session(db, profile.id)
    })
    return { session, needsEmailConfirmation: false }
  }

  async signInWithEmail(emailInput: string, password: string) {
    const email = emailInput.trim().toLowerCase()
    const cred = await this.read((db) => db.credentials.find((c) => c.email === email))
    const hash = cred ? await sha256(cred.salt + password) : ''
    const result = await this.tx((db) => {
      const c = db.credentials.find((x) => x.email === email)
      if (!c) return { ok: false as const }
      const t = this.now().getTime()
      c.failed = c.failed.filter((f) => t - f < LOGIN_WINDOW)
      if (c.failed.length >= 5) throw new AppError('rate_limited', 'Too many failed sign-in attempts. Try again in 15 minutes or reset your password.')
      if (c.hash !== hash) {
        c.failed.push(t)
        return { ok: false as const }
      }
      c.failed = []
      this.store.set(SESSION_KEY, c.userId)
      this.audit(db, c.userId, 'auth.signin', 'profile', c.userId, 'email')
      return { ok: true as const, session: this.session(db, c.userId) }
    })
    // Same message whether the email exists or not, so accounts can't be enumerated.
    if (!result.ok) throw err.invalid('Incorrect email or password.')
    return result.session
  }

  async requestPasswordReset(emailInput: string) {
    const email = emailInput.trim().toLowerCase()
    if (!isEmail(email)) throw err.invalid('Enter a valid email address.')
    const token = `${uid()}${uid()}`.replace(/-/g, '')
    const tokenHash = await sha256(token)
    const exists = await this.tx((db) => {
      const c = db.credentials.find((x) => x.email === email)
      if (!c) return false
      db.resetTokens = db.resetTokens.filter((r) => r.userId !== c.userId)
      db.resetTokens.push({ userId: c.userId, tokenHash, expiresAt: this.now().getTime() + RESET_TTL })
      this.audit(db, c.userId, 'auth.password_reset_requested', 'profile', c.userId)
      return true
    })
    // Demo: no email provider. The link is returned so the UI can show it in a labelled demo inbox.
    return { demoLink: exists ? `/reset-password?demo_token=${token}` : undefined }
  }

  async updatePassword(newPassword: string, demoRecoveryToken?: string) {
    const pw = passwordProblem(newPassword)
    if (pw) throw err.invalid(pw)
    const tokenHash = demoRecoveryToken ? await sha256(demoRecoveryToken) : undefined
    const salt = uid()
    const hash = await sha256(salt + newPassword)
    await this.tx((db) => {
      let userId: string
      if (tokenHash) {
        const rec = db.resetTokens.find((r) => r.tokenHash === tokenHash)
        if (!rec || rec.expiresAt < this.now().getTime()) throw err.invalid('This reset link is invalid or has expired. Request a new one.')
        userId = rec.userId
        db.resetTokens = db.resetTokens.filter((r) => r !== rec)
      } else userId = this.me(db).id
      const c = db.credentials.find((x) => x.userId === userId)
      if (c) Object.assign(c, { salt, hash, failed: [] })
      else {
        const email = db.profiles.find((p) => p.id === userId)?.email
        if (!email) throw err.invalid('Add an email address to your profile before setting a password.')
        db.credentials.push({ userId, email: email.toLowerCase(), salt, hash, failed: [] })
      }
      this.store.set(SESSION_KEY, userId)
      this.audit(db, userId, 'auth.password_changed', 'profile', userId)
    })
  }

  async startPhoneVerification(phoneInput: string) {
    const phone = normalizePhone(phoneInput, true)
    if (!phone) throw err.invalid('Enter a valid 10-digit Indian mobile number.')
    await this.read((db) => {
      const me = this.me(db)
      if (db.profiles.some((p) => p.phone === phone && p.id !== me.id)) throw err.invalid('That number is linked to another account. Sign in with it instead.')
    })
    return this.requestOtp(phone)
  }

  async confirmPhoneVerification(phoneInput: string, code: string) {
    const result = await this.tx((db) => {
      const me = this.me(db)
      const check = this.checkOtp(db, phoneInput, code)
      if (!check.ok) return check
      if (db.profiles.some((p) => p.phone === check.phone && p.id !== me.id)) throw err.invalid('That number is linked to another account.')
      Object.assign(me, { phone: check.phone, phoneVerified: true, updatedAt: this.ts() })
      this.audit(db, me.id, 'auth.phone_verified', 'profile', me.id)
      return { ok: true as const, session: this.session(db, me.id) }
    })
    if (!result.ok) throw err.invalid(`Incorrect code. ${result.left} attempt${result.left === 1 ? '' : 's'} left.`)
    return result.session
  }

  /* ------------------------------------------------------------ public */

  async listCategories() {
    return this.read((db) => db.categories.filter((c) => c.active).sort((a, b) => a.sort - b.sort))
  }

  async listPublicOrganizations() {
    return this.read((db) => db.organizations.filter((o) => o.status === 'approved').map((o) => this.publicOrg(db, o)))
  }

  async searchOrganizations(params: SearchParams, page: { offset: number; limit: number }) {
    const orgs = await this.listPublicOrganizations()
    return searchOrganizations(orgs, { ...params, now: this.now() }, page)
  }

  async getPublicOrganization(slug: string) {
    return this.read((db) => {
      const o = db.organizations.find((x) => x.slug === slug && x.status === 'approved')
      return o ? this.publicOrg(db, o) : null
    })
  }

  async getImpactStats(): Promise<ImpactStats> {
    return this.read((db) => {
      const done = db.requests.filter((r) => r.status === 'completed')
      const locs = new Set<string>()
      done.forEach((r) => {
        const l = this.pickupLocality(db, r)
        if (l) locs.add(l)
        locs.add(db.organizations.find((o) => o.id === r.orgId)!.locality)
      })
      return {
        donationsCompleted: done.length,
        organizationsVerified: db.organizations.filter((o) => o.status === 'approved').length,
        itemsDelivered: db.requestItems.filter((i) => done.some((d) => d.id === i.requestId)).reduce((s, i) => s + i.quantity, 0),
        localitiesServed: locs.size,
        isDemo: true,
      }
    })
  }

  /* ------------------------------------------------------------ donor */

  async submitDonation(input: DonationSubmission) {
    return this.tx((db) => {
      const me = this.me(db)
      if (!input.clientRequestId || input.clientRequestId.length < 8) throw err.invalid('Missing submission id — reload the page and try again.')
      // Idempotency: the same draft submitted twice (double click, network retry) returns the original requests.
      const prior = db.submissionKeys.find((k) => k.userId === me.id && k.key === input.clientRequestId)
      if (prior) return db.requests.filter((r) => prior.requestIds.includes(r.id))
      if (!me.phoneVerified) throw err.forbidden('Verify your phone number before submitting a donation.')
      if (!input.consent) throw err.invalid('Please accept the privacy policy and terms.')
      if (!input.items.length) throw err.invalid('Add at least one item.')
      if (input.donor.fullName.trim().length < 2) throw err.invalid('Enter your full name.')
      if (input.donor.email && !isEmail(input.donor.email)) throw err.invalid('That email address does not look right.')
      if (input.donor.contactMethod === 'email' && !input.donor.email) throw err.invalid('Add an email address to be contacted by email.')

      const t = this.now().getTime()
      db.submissionsLog = db.submissionsLog.filter((s) => t - s.at < 86_400_000)
      if (db.submissionsLog.filter((s) => s.userId === me.id).length >= 5)
        throw new AppError('rate_limited', 'You have reached the limit of 5 donation submissions per day. Please try again tomorrow.')

      const date = new Date(input.preferredDate + 'T00:00:00')
      const today = new Date(localDateIso(this.now()) + 'T00:00:00')
      const days = Math.round((date.getTime() - today.getTime()) / 86_400_000)
      if (isNaN(days) || days < 1 || days > 14) throw err.invalid('Choose a preferred date between tomorrow and 14 days from now.')
      if (!PICKUP_SLOTS.includes(input.preferredSlot)) throw err.invalid('Choose a time slot.')

      const byOrg = new Map<string, typeof input.items>()
      for (const item of input.items) {
        const problems = validateItem(item, this.now())
        if (problems.length) throw err.invalid(`${item.name || 'Item'}: ${problems[0]}`)
        if (item.photo && item.photo.length > MAX_PHOTO) throw err.invalid('One of the photos is too large.')
        const org = db.organizations.find((o) => o.id === item.orgId && o.status === 'approved')
        if (!org) throw err.invalid('One of the selected organisations is not available.')
        const policy = db.itemPolicies.find((p) => p.orgId === org.id && p.categoryId === item.categoryId)
        const pp = checkAgainstPolicy(item, org, policy, this.now())
        if (pp.length) throw err.invalid(pp[0])
        byOrg.set(org.id, [...(byOrg.get(org.id) ?? []), item])
      }

      let addressId: string | undefined
      const needsPickup = [...byOrg.keys()].some((id) => (input.methods[id] ?? 'partner_pickup') === 'partner_pickup')
      if (needsPickup) {
        const a = input.pickup
        if (!a || a.line1.trim().length < 5) throw err.invalid('Enter your pickup address.')
        if (!localityByName(a.locality)) throw err.invalid('Choose a Pune locality.')
        if (!isPunePin(a.pinCode)) throw err.invalid('Enter a valid Pune PIN code (41xxxx).')
        const addr: PickupAddress = { id: uid(), userId: me.id, line1: a.line1.trim(), landmark: a.landmark?.trim() || undefined, locality: a.locality, pinCode: a.pinCode.trim(), instructions: a.instructions?.trim() || undefined }
        db.pickupAddresses.push(addr)
        addressId = addr.id
      }

      me.fullName = input.donor.fullName.trim()
      if (input.donor.email) me.email = input.donor.email.trim()

      const openCount = db.requests.filter((r) => r.donorId === me.id && isOpen(r.status)).length
      const batchId = uid()
      const created: DonationRequest[] = []
      for (const [orgId, items] of byOrg) {
        const org = db.organizations.find((o) => o.id === orgId)!
        const method = input.methods[orgId] ?? 'partner_pickup'
        if (!org.deliveryMethods.includes(method)) throw err.invalid(`${org.name} does not support ${method === 'donor_dropoff' ? 'drop-off' : 'pickup'}.`)
        const total = items.reduce((s, i) => s + i.quantity, 0)
        const flags: string[] = []
        if (total > FLAG_QTY) flags.push(`Unusually large quantity (${total})`)
        if (openCount + created.length >= 4) flags.push('Donor has many open requests')
        if (t - new Date(me.createdAt).getTime() < 10 * 60_000 && total > 100) flags.push('Large request from a brand-new account')
        let code = requestCode()
        while (db.requests.some((r) => r.code === code)) code = requestCode()
        const r: DonationRequest = {
          id: uid(), code, batchId, donorId: me.id, orgId, status: 'draft', deliveryMethod: method,
          pickupAddressId: method === 'partner_pickup' ? addressId : undefined, preferredDate: input.preferredDate, preferredSlot: input.preferredSlot,
          contactMethod: input.donor.contactMethod, notes: input.notes?.trim() || undefined, flagged: flags.join('; ') || undefined,
          createdAt: this.ts(), updatedAt: this.ts(), isDemo: true,
        }
        db.requests.push(r)
        items.forEach(({ orgId: _o, ...it }) => db.requestItems.push({ ...it, id: uid(), requestId: r.id, name: it.name.trim() } as DonationItem))
        this.transition(db, r, 'pending_organization_confirmation', 'donor', me.id)
        if (r.flagged) this.notify(db, this.adminIds(db), { title: 'Request flagged for review', body: `${r.code}: ${r.flagged}`, link: '/admin' })
        created.push(r)
      }
      db.submissionsLog.push({ userId: me.id, at: t })
      db.submissionKeys.push({ userId: me.id, key: input.clientRequestId, requestIds: created.map((r) => r.id) })
      return created
    })
  }

  async listMyDonations() {
    return this.read((db) => {
      const me = this.me(db)
      return db.requests.filter((r) => r.donorId === me.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((r) => this.view(db, r, me.id))
    })
  }

  async getDonation(idOrCode: string) {
    return this.read((db) => {
      const me = this.me(db)
      return this.view(db, this.req(db, idOrCode), me.id)
    })
  }

  async cancelDonation(requestId: string, reason: string) {
    await this.tx((db) => {
      const me = this.me(db)
      const r = this.req(db, requestId)
      if (r.donorId !== me.id) throw err.forbidden()
      if (reason.trim().length < 3) throw err.invalid('Please give a short reason.')
      r.cancelReason = reason.trim()
      this.transition(db, r, 'cancelled', 'donor', me.id, reason.trim())
      const job = db.jobs.find((j) => j.requestId === r.id)
      if (job) {
        job.state = 'cancelled'
        job.version++
        job.updatedAt = this.ts()
      }
    })
  }

  async confirmDropoff(requestId: string, note?: string) {
    await this.tx((db) => {
      const me = this.me(db)
      const r = this.req(db, requestId)
      if (r.donorId !== me.id) throw err.forbidden()
      this.transition(db, r, 'delivered_pending_receipt_confirmation', 'donor', me.id, note || 'Donor dropped off the items')
      db.proofs.push({ id: uid(), requestId: r.id, kind: 'delivery', uploadedBy: me.id, note: note || 'Dropped off by donor', at: this.ts() })
    })
  }

  async listMyAddresses() {
    return this.read((db) => {
      const me = this.me(db)
      return db.pickupAddresses.filter((a) => a.userId === me.id).reverse()
    })
  }

  /* ------------------------------------------------------------ notifications / reports */

  async listNotifications() {
    return this.read((db) => {
      const me = this.me(db)
      return db.notifications.filter((n) => n.userId === me.id).slice(0, 50)
    })
  }

  async markNotificationsRead(ids?: string[]) {
    await this.tx((db) => {
      const me = this.me(db)
      db.notifications.forEach((n) => {
        if (n.userId === me.id && (!ids || ids.includes(n.id))) n.read = true
      })
    })
  }

  async fileReport(input: { kind: Report['kind']; message: string; requestId?: string; orgId?: string }) {
    await this.tx((db) => {
      const me = this.me(db)
      if (input.message.trim().length < 10) throw err.invalid('Please describe the issue in a little more detail.')
      if (input.requestId) this.view(db, this.req(db, input.requestId), me.id) // must have access
      const rep: Report = { id: uid(), reporterId: me.id, requestId: input.requestId ? this.req(db, input.requestId).id : undefined, orgId: input.orgId, kind: input.kind, message: input.message.trim(), status: 'open', createdAt: this.ts(), updatedAt: this.ts() }
      db.reports.unshift(rep)
      this.audit(db, me.id, 'report.created', 'report', rep.id, input.kind)
      this.notify(db, this.adminIds(db), { title: 'New report', body: `${input.kind}: ${rep.message.slice(0, 80)}`, link: '/admin' })
    })
  }

  /* ------------------------------------------------------------ organisation portal */

  async registerOrganization(input: OrgRegistration) {
    return this.tx((db) => {
      const me = this.me(db)
      if (this.staffOrg(db, me.id)) throw err.invalid('Your account is already linked to an organisation.')
      if (input.name.trim().length < 3) throw err.invalid('Enter the organisation’s registered name.')
      if (!ORG_TYPES[input.type]) throw err.invalid('Choose an organisation type.')
      const loc = localityByName(input.locality)
      if (!loc) throw err.invalid('Choose a Pune locality.')
      if (!isPunePin(input.pinCode)) throw err.invalid('Enter a valid Pune PIN code.')
      if (input.address.trim().length < 8) throw err.invalid('Enter the full address.')
      if (!normalizePhone(input.publicPhone, true)) throw err.invalid('Enter a valid contact number.')
      if (!isEmail(input.publicEmail)) throw err.invalid('Enter a valid contact email.')
      if (input.registrationNumber.trim().length < 3) throw err.invalid('Enter the registration number (trust, society, Section 8, etc.).')
      if (!input.deliveryMethods.length) throw err.invalid('Choose at least one way to receive donations.')
      if (!input.acceptedCategories.length) throw err.invalid('Choose at least one accepted category.')
      const dupe = db.organizations.find((o) => nameKey(o.name) === nameKey(input.name))
      if (dupe) throw err.invalid('An organisation with a very similar name is already registered. Contact support to be added as staff.')
      let slug = input.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
      while (db.organizations.some((o) => o.slug === slug)) slug += '-1'
      const org: Organization = {
        id: uid(), slug, name: input.name.trim(), type: input.type, intro: input.intro.trim(), locality: loc.name, address: input.address.trim(),
        pinCode: input.pinCode.trim(), lat: loc.lat, lng: loc.lng, coordsPrecision: 'locality', publicPhone: input.publicPhone.trim(),
        publicEmail: input.publicEmail.trim(), website: input.website?.trim() || undefined, contactVerified: false,
        registrationType: input.registrationType.trim(), registrationNumber: input.registrationNumber.trim(), status: 'pending',
        deliveryMethods: input.deliveryMethods, pickupSlots: ['09:00 – 12:00', '15:00 – 18:00'], conditionRules: '', restrictions: [],
        showImpact: false, isDemo: true, createdAt: this.ts(), updatedAt: this.ts(),
      }
      db.organizations.push(org)
      input.acceptedCategories.forEach((c) => db.itemPolicies.push({ id: uid(), orgId: org.id, categoryId: c, acceptance: 'accepts', conditionsAccepted: ['new', 'like_new', 'gently_used'] }))
      db.userRoles.push({ userId: me.id, role: 'org_staff', orgId: org.id, grantedBy: 'registration (unverified org)', createdAt: this.ts() })
      this.audit(db, me.id, 'organization.registered', 'organization', org.id, org.name)
      this.notify(db, this.adminIds(db), { title: 'New organisation registration', body: `${org.name} (${org.locality}) is awaiting verification.`, link: '/admin' })
      return org
    })
  }

  async getMyOrganization() {
    return this.read((db) => {
      const me = this.me(db)
      const org = this.staffOrg(db, me.id)
      if (!org) return null
      return {
        org,
        policies: db.itemPolicies.filter((p) => p.orgId === org.id),
        needs: db.needs.filter((n) => n.orgId === org.id),
        docs: db.verificationDocs.filter((d) => d.ownerKind === 'organization' && d.ownerId === org.id).map(({ dataUrl: _d, ...d }) => d),
      }
    })
  }

  async updateMyOrganization(patch: Partial<OrgEditable>) {
    await this.tx((db) => {
      const { me, org } = this.requireStaff(db)
      if (patch.publicEmail !== undefined && !isEmail(patch.publicEmail)) throw err.invalid('Enter a valid email.')
      if (patch.deliveryMethods && !patch.deliveryMethods.length) throw err.invalid('Keep at least one delivery method.')
      const contactChanged = (patch.publicPhone && patch.publicPhone !== org.publicPhone) || (patch.publicEmail && patch.publicEmail !== org.publicEmail)
      Object.assign(org, patch, { updatedAt: this.ts() })
      if (contactChanged) {
        org.contactVerified = false
        this.notify(db, this.adminIds(db), { title: 'Contact details changed', body: `${org.name} changed its public contact details — re-verify.`, link: '/admin' })
      }
      this.audit(db, me.id, 'organization.updated', 'organization', org.id, Object.keys(patch).join(', '))
    })
  }

  async savePolicy(policy: Omit<OrgItemPolicy, 'id' | 'orgId'>) {
    await this.tx((db) => {
      const { me, org } = this.requireStaff(db)
      const existing = db.itemPolicies.find((p) => p.orgId === org.id && p.categoryId === policy.categoryId)
      if (existing) Object.assign(existing, policy)
      else db.itemPolicies.push({ ...policy, id: uid(), orgId: org.id })
      if (policy.acceptance === 'does_not_accept') db.needs.forEach((n) => n.orgId === org.id && n.categoryId === policy.categoryId && n.status === 'open' && (n.status = 'closed'))
      this.audit(db, me.id, 'policy.saved', 'organization_item_policy', org.id, `${policy.categoryId}: ${policy.acceptance}`)
    })
  }

  async saveNeed(need: Parameters<Backend['saveNeed']>[0]) {
    await this.tx((db) => {
      const { me, org } = this.requireStaff(db)
      if (need.title.trim().length < 3) throw err.invalid('Describe the need.')
      if (need.quantity != null && (!Number.isInteger(need.quantity) || need.quantity < 1 || need.quantity > 10000)) throw err.invalid('Quantity must be a whole number between 1 and 10,000.')
      const policy = db.itemPolicies.find((p) => p.orgId === org.id && p.categoryId === need.categoryId)
      if (!policyAccepts(policy)) throw err.invalid('Set this category to “Accepts” in your item rules first.')
      if (need.id) {
        const n = db.needs.find((x) => x.id === need.id && x.orgId === org.id)
        if (!n) throw err.notFound()
        Object.assign(n, { ...need, orgId: org.id, lastConfirmedAt: this.ts() })
      } else
        db.needs.push({ id: uid(), orgId: org.id, categoryId: need.categoryId, title: need.title.trim(), tags: need.tags ?? [], quantity: need.quantity, unit: need.unit, fulfilledQty: 0, urgency: need.urgency, note: need.note, lastConfirmedAt: this.ts(), status: 'open' })
      this.audit(db, me.id, 'need.saved', 'organization_need', org.id, need.title)
    })
  }

  async confirmNeed(needId: string) {
    await this.tx((db) => {
      const { org } = this.requireStaff(db)
      const n = db.needs.find((x) => x.id === needId && x.orgId === org.id)
      if (!n) throw err.notFound()
      n.lastConfirmedAt = this.ts()
      n.status = 'open'
    })
  }

  async closeNeed(needId: string, outcome: 'fulfilled' | 'closed') {
    await this.tx((db) => {
      const { me, org } = this.requireStaff(db)
      const n = db.needs.find((x) => x.id === needId && x.orgId === org.id)
      if (!n) throw err.notFound()
      n.status = outcome
      this.audit(db, me.id, `need.${outcome}`, 'organization_need', n.id, n.title)
    })
  }

  async uploadOrgDocument(kind: string, file: { name: string; dataUrl: string }) {
    await this.tx((db) => {
      const { me, org } = this.requireStaff(db)
      if (file.dataUrl.length > MAX_PHOTO * 2) throw err.invalid('File too large for the demo (max ~600 KB).')
      db.verificationDocs.push({ id: uid(), ownerKind: 'organization', ownerId: org.id, kind, fileName: file.name, dataUrl: file.dataUrl, status: 'submitted', uploadedAt: this.ts(), retainUntil: new Date(this.now().getTime() + 365 * 86_400_000).toISOString() })
      if (org.status === 'needs_info') org.status = 'pending'
      this.audit(db, me.id, 'document.uploaded', 'organization', org.id, kind)
      this.notify(db, this.adminIds(db), { title: 'Verification document uploaded', body: `${org.name}: ${kind}`, link: '/admin' })
    })
  }

  async getDocumentUrl(doc: { id: string }) {
    return this.read((db) => {
      const me = this.me(db)
      const d = db.verificationDocs.find((x) => x.id === doc.id)
      if (!d) throw err.notFound()
      const own = (d.ownerKind === 'organization' && this.staffOrg(db, me.id)?.id === d.ownerId) || (d.ownerKind === 'partner' && this.partnerFor(db, me.id)?.id === d.ownerId)
      if (!own && !this.has(db, me.id, 'admin')) throw err.forbidden()
      return d.dataUrl ?? null
    })
  }

  async listOrgRequests() {
    return this.read((db) => {
      const { me, org } = this.requireStaff(db)
      return db.requests.filter((r) => r.orgId === org.id && r.status !== 'draft').sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((r) => this.view(db, r, me.id))
    })
  }

  private packageSize(db: DB, r: DonationRequest): PackageSize {
    const items = db.requestItems.filter((i) => i.requestId === r.id)
    if (items.some((i) => i.categoryId === 'furniture')) return 'large'
    const count = items.reduce((s, i) => s + (i.unit === 'kg' ? i.quantity / 5 : ['bags', 'boxes'].includes(i.unit) ? i.quantity * 3 : i.quantity), 0)
    return count > 40 ? 'large' : count > 12 ? 'medium' : 'small'
  }

  private openJob(db: DB, r: DonationRequest, actor: Actor, actorId: string) {
    this.transition(db, r, 'awaiting_delivery_partner', actor, actorId)
    const existing = db.jobs.find((j) => j.requestId === r.id)
    if (existing) Object.assign(existing, { state: 'open', partnerId: undefined, claimedAt: undefined, version: existing.version + 1, updatedAt: this.ts() })
    else db.jobs.push({ id: uid(), requestId: r.id, state: 'open', packageSize: this.packageSize(db, r), version: 0, createdAt: this.ts(), updatedAt: this.ts() })
  }

  async orgDecide(requestId: string, decision: 'accept' | 'reject', reason?: string) {
    await this.tx((db) => {
      const { me, org } = this.requireStaff(db)
      if (org.status !== 'approved') throw err.forbidden('Your organisation must be verified before accepting donations.')
      const r = this.req(db, requestId)
      if (r.orgId !== org.id) throw err.forbidden()
      if (decision === 'reject') {
        if (!reason || reason.trim().length < 3) throw err.invalid('Please give the donor a reason.')
        r.rejectionReason = reason.trim()
        r.organizationResponse = reason.trim()
        this.transition(db, r, 'rejected', 'org', me.id, reason.trim())
        return
      }
      if (r.flagged) throw err.forbidden('This request is held for administrator review before it can be accepted.')
      r.organizationResponse = reason?.trim() || undefined
      this.transition(db, r, 'organization_accepted', 'org', me.id, reason)
      if (r.deliveryMethod === 'partner_pickup') this.openJob(db, r, 'system', 'system')
    })
  }

  async orgConfirmReceipt(requestId: string, note?: string, photo?: string) {
    await this.tx((db) => {
      const { me, org } = this.requireStaff(db)
      const r = this.req(db, requestId)
      if (r.orgId !== org.id) throw err.forbidden()
      if (photo && photo.length > MAX_PHOTO) throw err.invalid('Photo too large.')
      this.transition(db, r, 'completed', 'org', me.id, note || 'Receipt confirmed')
      db.proofs.push({ id: uid(), requestId: r.id, kind: 'receipt', uploadedBy: me.id, note: note || 'Received', photo, at: this.ts() })
      const job = db.jobs.find((j) => j.requestId === r.id)
      if (job) Object.assign(job, { state: 'done', updatedAt: this.ts() })
      // Count delivered quantities against matching open needs.
      for (const item of db.requestItems.filter((i) => i.requestId === r.id)) {
        const need = db.needs.find((n) => n.orgId === org.id && n.status === 'open' && n.categoryId === item.categoryId && (!n.unit || n.unit === item.unit))
        if (need) need.fulfilledQty += item.quantity
      }
    })
  }

  async orgReportNotReceived(requestId: string, reason: string) {
    await this.tx((db) => {
      const { me, org } = this.requireStaff(db)
      const r = this.req(db, requestId)
      if (r.orgId !== org.id) throw err.forbidden()
      if (reason.trim().length < 5) throw err.invalid('Describe what happened.')
      r.failureReason = `Organisation reports: ${reason.trim()}`
      this.transition(db, r, 'failed', 'org', me.id, reason.trim())
      db.reports.unshift({ id: uid(), reporterId: me.id, requestId: r.id, orgId: org.id, kind: 'dispute', message: `Marked delivered but not received: ${reason.trim()}`, status: 'open', createdAt: this.ts(), updatedAt: this.ts() })
    })
  }

  async orgReoffer(requestId: string) {
    await this.tx((db) => {
      const { me, org } = this.requireStaff(db)
      const r = this.req(db, requestId)
      if (r.orgId !== org.id) throw err.forbidden()
      this.openJob(db, r, 'org', me.id)
    })
  }

  /* ------------------------------------------------------------ delivery partner */

  async applyAsPartner(input: PartnerApplication) {
    return this.tx((db) => {
      const me = this.me(db)
      if (this.partnerFor(db, me.id)) throw err.invalid('You have already applied.')
      if (!input.consent) throw err.invalid('Please accept the partner terms and background-verification consent.')
      if (input.fullName.trim().length < 3) throw err.invalid('Enter your full legal name as on your ID.')
      if (!input.idDocument?.dataUrl) throw err.invalid('Upload a photo of a government ID.')
      if (input.idDocument.dataUrl.length > MAX_PHOTO * 2) throw err.invalid('ID file is too large (max ~600 KB in the demo).')
      if (input.serviceLocalities.some((l) => !localityByName(l))) throw err.invalid('Unknown locality in service area.')
      const p = { id: uid(), userId: me.id, fullName: input.fullName.trim(), phone: me.phone, vehicle: input.vehicle, serviceLocalities: input.serviceLocalities, status: 'pending' as ApprovalStatus, available: false, isDemo: true, createdAt: this.ts(), updatedAt: this.ts() }
      db.partners.push(p)
      db.verificationDocs.push({ id: uid(), ownerKind: 'partner', ownerId: p.id, kind: 'Government photo ID', fileName: input.idDocument.name, dataUrl: input.idDocument.dataUrl, status: 'submitted', uploadedAt: this.ts(), retainUntil: new Date(this.now().getTime() + 180 * 86_400_000).toISOString() })
      this.audit(db, me.id, 'partner.applied', 'delivery_partner', p.id)
      this.notify(db, this.adminIds(db), { title: 'New delivery partner application', body: `${p.fullName} · ${input.vehicle}`, link: '/admin' })
      return p
    })
  }

  async getMyPartnerProfile() {
    return this.read((db) => {
      const me = this.me(db)
      const partner = this.partnerFor(db, me.id)
      if (!partner) return null
      return { partner, docs: db.verificationDocs.filter((d) => d.ownerKind === 'partner' && d.ownerId === partner.id).map(({ dataUrl: _d, ...d }) => d) }
    })
  }

  async setAvailability(available: boolean) {
    await this.tx((db) => {
      const { me, partner } = this.requireApprovedPartner(db)
      partner.available = available
      partner.updatedAt = this.ts()
      this.audit(db, me.id, available ? 'partner.online' : 'partner.offline', 'delivery_partner', partner.id)
    })
  }

  async listAvailableJobs(): Promise<JobListing[]> {
    return this.read((db) => {
      const { partner } = this.requireApprovedPartner(db)
      if (!partner.available) return []
      return db.jobs
        .filter((j) => j.state === 'open')
        .map((job): JobListing | null => {
          const r = db.requests.find((x) => x.id === job.requestId)!
          if (r.status !== 'awaiting_delivery_partner') return null
          const org = db.organizations.find((o) => o.id === r.orgId)!
          const pickup = this.pickupLocality(db, r) ?? 'Pune'
          if (partner.serviceLocalities.length && !partner.serviceLocalities.includes(pickup)) return null
          const items = db.requestItems.filter((i) => i.requestId === r.id)
          const pl = localityByName(pickup)
          return {
            job, requestCode: r.code, status: r.status, pickupLocality: pickup, destinationLocality: org.locality, destinationName: org.name,
            categories: [...new Set(items.map((i) => i.categoryId))] as CategoryId[], itemCount: items.reduce((s, i) => s + i.quantity, 0),
            preferredDate: r.preferredDate, preferredSlot: r.preferredSlot, approxKm: pl ? Math.round(distanceKm(pl, org) * 10) / 10 : undefined,
          }
        })
        .filter((x): x is JobListing => !!x)
    })
  }

  async listMyJobs() {
    return this.read((db) => {
      const { me, partner } = this.requireApprovedPartner(db)
      return db.jobs
        .filter((j) => j.partnerId === partner.id && j.state !== 'open')
        .map((j) => db.requests.find((r) => r.id === j.requestId)!)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .map((r) => this.view(db, r, me.id))
    })
  }

  async claimJob(jobId: string, expectedVersion: number) {
    await this.tx((db) => {
      const { me, partner } = this.requireApprovedPartner(db)
      if (!partner.available) throw err.invalid('Go online before accepting jobs.')
      const job = db.jobs.find((j) => j.id === jobId)
      if (!job) throw err.notFound('Job not found.')
      // Compare-and-swap: only one claim can win for a given version of an open job.
      if (job.state !== 'open' || job.version !== expectedVersion)
        throw new AppError('conflict', 'Another partner has just accepted this job.')
      const active = db.jobs.filter((j) => j.partnerId === partner.id && j.state === 'claimed').length
      if (active >= MAX_ACTIVE_JOBS) throw err.invalid(`You can hold at most ${MAX_ACTIVE_JOBS} active jobs at a time.`)
      const r = db.requests.find((x) => x.id === job.requestId)!
      Object.assign(job, { state: 'claimed', partnerId: partner.id, claimedAt: this.ts(), version: job.version + 1, updatedAt: this.ts() })
      this.transition(db, r, 'delivery_partner_assigned', 'partner', me.id)
    })
  }

  private myClaimedJob(db: DB, requestId: string) {
    const { me, partner } = this.requireApprovedPartner(db)
    const r = this.req(db, requestId)
    const job = db.jobs.find((j) => j.requestId === r.id)
    if (!job || job.partnerId !== partner.id || job.state !== 'claimed') throw err.forbidden('This job is not assigned to you.')
    return { me, r, job }
  }

  async releaseJob(requestId: string, reason: string) {
    await this.tx((db) => {
      const { me, r, job } = this.myClaimedJob(db, requestId)
      if (reason.trim().length < 3) throw err.invalid('Give a short reason so the job can be re-offered.')
      this.transition(db, r, 'awaiting_delivery_partner', 'partner', me.id, `Released: ${reason.trim()}`)
      Object.assign(job, { state: 'open', partnerId: undefined, claimedAt: undefined, version: job.version + 1, updatedAt: this.ts() })
    })
  }

  async partnerAdvance(requestId: string, to: PartnerStep, opts: { note?: string; photo?: string } = {}) {
    await this.tx((db) => {
      const { me, r, job } = this.myClaimedJob(db, requestId)
      if (opts.photo && opts.photo.length > MAX_PHOTO) throw err.invalid('Photo too large.')
      if (to === 'delivered_pending_receipt_confirmation' && !opts.photo && !(opts.note && opts.note.trim().length >= 3))
        throw err.invalid('Delivery proof is required: add a photo or the name of the person who received it.')
      if (to === 'failed') {
        if (!opts.note || opts.note.trim().length < 5) throw err.invalid('Describe why the delivery failed.')
        r.failureReason = opts.note.trim()
      }
      this.transition(db, r, to, 'partner', me.id, opts.note)
      if (to === 'picked_up' || to === 'delivered_pending_receipt_confirmation')
        db.proofs.push({ id: uid(), requestId: r.id, kind: to === 'picked_up' ? 'pickup' : 'delivery', uploadedBy: me.id, note: opts.note, photo: opts.photo, at: this.ts() })
      if (to === 'failed') Object.assign(job, { state: 'cancelled', version: job.version + 1, updatedAt: this.ts() })
    })
  }

  /* ------------------------------------------------------------ admin */

  async adminStats(): Promise<AdminStats> {
    return this.read((db) => {
      this.requireAdmin(db)
      const byStatus: AdminStats['byStatus'] = {}
      db.requests.forEach((r) => (byStatus[r.status] = (byStatus[r.status] ?? 0) + 1))
      return {
        byStatus,
        orgsPending: db.organizations.filter((o) => o.status === 'pending' || o.status === 'needs_info').length,
        partnersPending: db.partners.filter((p) => p.status === 'pending').length,
        reportsOpen: db.reports.filter((r) => r.status !== 'resolved').length,
        flagged: db.requests.filter((r) => r.flagged && isOpen(r.status)).length,
        totalRequests: db.requests.length,
      }
    })
  }

  async adminListOrganizations() {
    return this.read((db) => {
      this.requireAdmin(db)
      return db.organizations.map((org) => ({
        org,
        docs: db.verificationDocs.filter((d) => d.ownerKind === 'organization' && d.ownerId === org.id),
        staff: this.staffIds(db, org.id).map((id) => db.profiles.find((p) => p.id === id)!).filter(Boolean),
      }))
    })
  }

  async adminReviewOrganization(orgId: string, decision: ApprovalStatus, note: string, checks: { contactVerified: boolean; addressVerified: boolean }) {
    await this.tx((db) => {
      const me = this.requireAdmin(db)
      const org = db.organizations.find((o) => o.id === orgId)
      if (!org) throw err.notFound()
      if (decision !== 'approved' && note.trim().length < 5) throw err.invalid('Add a note explaining the decision.')
      if (decision === 'approved') {
        const accepted = db.verificationDocs.some((d) => d.ownerKind === 'organization' && d.ownerId === org.id && d.status === 'accepted')
        if (!accepted) throw err.invalid('Accept at least one verification document before approving.')
        if (!checks.contactVerified || !checks.addressVerified) throw err.invalid('Confirm you verified the contact details and address before approving.')
        org.contactVerified = true
        org.verifiedAt = this.ts()
        org.verifiedBy = me.id
        org.nextReviewDue = new Date(this.now().getTime() + 365 * 86_400_000).toISOString()
      }
      org.status = decision
      org.verificationNote = note.trim() || org.verificationNote
      org.updatedAt = this.ts()
      this.audit(db, me.id, `organization.${decision}`, 'organization', org.id, note)
      this.notify(db, this.staffIds(db, org.id), { title: `Verification: ${decision.replace('_', ' ')}`, body: note || 'Your organisation profile is now public.', link: '/portal/organization' })
    })
  }

  async adminReviewDocument(docId: string, status: 'accepted' | 'rejected', note?: string) {
    await this.tx((db) => {
      const me = this.requireAdmin(db)
      const d = db.verificationDocs.find((x) => x.id === docId)
      if (!d) throw err.notFound()
      d.status = status
      d.reviewerNote = note
      this.audit(db, me.id, `document.${status}`, 'verification_document', d.id, note)
    })
  }

  async adminListPartners() {
    return this.read((db) => {
      this.requireAdmin(db)
      return db.partners.map((partner) => ({ partner, docs: db.verificationDocs.filter((d) => d.ownerKind === 'partner' && d.ownerId === partner.id) }))
    })
  }

  async adminReviewPartner(partnerId: string, decision: ApprovalStatus, note: string) {
    await this.tx((db) => {
      const me = this.requireAdmin(db)
      const p = db.partners.find((x) => x.id === partnerId)
      if (!p) throw err.notFound()
      if (decision !== 'approved' && note.trim().length < 5) throw err.invalid('Add a note explaining the decision.')
      if (decision === 'approved' && !db.verificationDocs.some((d) => d.ownerKind === 'partner' && d.ownerId === p.id && d.status === 'accepted'))
        throw err.invalid('Accept the partner’s ID document before approving.')
      p.status = decision
      p.reviewNote = note
      p.updatedAt = this.ts()
      const hasRole = this.has(db, p.userId, 'delivery_partner')
      if (decision === 'approved' && !hasRole) db.userRoles.push({ userId: p.userId, role: 'delivery_partner', grantedBy: me.id, createdAt: this.ts() })
      if (decision !== 'approved') {
        db.userRoles = db.userRoles.filter((r) => !(r.userId === p.userId && r.role === 'delivery_partner'))
        p.available = false
      }
      this.audit(db, me.id, `partner.${decision}`, 'delivery_partner', p.id, note)
      this.notify(db, [p.userId], { title: `Partner application: ${decision.replace('_', ' ')}`, body: note || 'You can now go online and accept jobs.', link: '/portal/partner' })
    })
  }

  async adminListRequests() {
    return this.read((db) => {
      const me = this.requireAdmin(db)
      return [...db.requests].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map((r) => this.view(db, r, me.id))
    })
  }

  async adminTransition(requestId: string, to: DonationStatus, note: string) {
    await this.tx((db) => {
      const me = this.requireAdmin(db)
      if (note.trim().length < 5) throw err.invalid('Admin actions need a note for the audit log.')
      const r = this.req(db, requestId)
      if (to === 'awaiting_delivery_partner') return this.openJob(db, r, 'admin', me.id)
      if (to === 'rejected') r.rejectionReason = note
      if (to === 'cancelled') r.cancelReason = note
      if (to === 'failed') r.failureReason = note
      this.transition(db, r, to, 'admin', me.id, note)
      const job = db.jobs.find((j) => j.requestId === r.id)
      if (job && ['cancelled', 'failed', 'rejected'].includes(to)) Object.assign(job, { state: 'cancelled', version: job.version + 1, updatedAt: this.ts() })
    })
  }

  async adminClearFlag(requestId: string, note: string) {
    await this.tx((db) => {
      const me = this.requireAdmin(db)
      const r = this.req(db, requestId)
      this.audit(db, me.id, 'donation.flag_cleared', 'donation_request', r.id, `${r.flagged} — ${note}`)
      r.flagged = undefined
      this.notify(db, this.staffIds(db, r.orgId), { title: 'Request cleared by admin', body: `${r.code} can now be accepted.`, link: '/portal/organization' })
    })
  }

  async adminListReports() {
    return this.read((db) => (this.requireAdmin(db), db.reports))
  }

  async adminUpdateReport(reportId: string, status: Report['status'], resolution?: string) {
    await this.tx((db) => {
      const me = this.requireAdmin(db)
      const rep = db.reports.find((r) => r.id === reportId)
      if (!rep) throw err.notFound()
      if (status === 'resolved' && !(resolution && resolution.trim().length >= 5)) throw err.invalid('Describe the resolution.')
      Object.assign(rep, { status, resolution, updatedAt: this.ts() })
      this.audit(db, me.id, `report.${status}`, 'report', rep.id, resolution)
      this.notify(db, [rep.reporterId], { title: `Your report is ${status}`, body: resolution ?? 'An administrator is looking into it.' })
    })
  }

  async adminListAudit() {
    return this.read((db) => (this.requireAdmin(db), db.audit.slice(0, 300)))
  }

  async adminListImports() {
    return this.read((db) => (this.requireAdmin(db), db.imports))
  }

  async adminImportCsv(text: string, source: string) {
    return this.tx((db) => {
      const me = this.requireAdmin(db)
      const rows = parseCsv(text)
      const errors: string[] = []
      let added = 0
      let duplicates = 0
      rows.forEach((row, i) => {
        const name = row.name?.trim()
        const loc = localityByName(row.locality ?? '')
        const type = (row.type ?? 'other') as OrgType
        if (!name) return errors.push(`Row ${i + 2}: missing name`)
        if (!loc) return errors.push(`Row ${i + 2}: unknown Pune locality “${row.locality ?? ''}”`)
        if (!ORG_TYPES[type]) return errors.push(`Row ${i + 2}: unknown type “${row.type}”`)
        const key = nameKey(name)
        const phone = (row.phone ?? '').replace(/\D/g, '').slice(-10)
        const dupeOrg = db.organizations.find((o) => nameKey(o.name) === key || (phone && o.publicPhone.replace(/\D/g, '').endsWith(phone)))
        const dupeImp = db.imports.find((x) => nameKey(x.name) === key && x.state !== 'discarded')
        if (dupeImp) {
          duplicates++
          return
        }
        if (dupeOrg) duplicates++
        db.imports.push({
          id: uid(), name, type, locality: loc.name, address: row.address ?? '', pinCode: row.pin_code ?? row.pin ?? loc.pin, phone: row.phone ?? '', email: row.email ?? '',
          acceptedCategories: (row.accepted_categories ?? '').split(/[;|]/).map((s) => s.trim()).filter((c): c is CategoryId => db.categories.some((x) => x.id === c)),
          source, state: 'staged', duplicateOf: dupeOrg?.id, addressVerified: false, contactVerified: false, permissionConfirmed: false, createdAt: this.ts(),
        })
        added++
      })
      this.audit(db, me.id, 'import.csv', 'import', source, `${added} staged, ${duplicates} duplicates, ${errors.length} errors`)
      return { added, duplicates, errors }
    })
  }

  async adminUpdateImport(id: string, patch: Parameters<Backend['adminUpdateImport']>[1]) {
    await this.tx((db) => {
      const me = this.requireAdmin(db)
      const row = db.imports.find((x) => x.id === id)
      if (!row) throw err.notFound()
      if (row.state === 'published') throw err.invalid('Already published.')
      Object.assign(row, patch, { reviewedAt: this.ts() })
      this.audit(db, me.id, 'import.updated', 'import', id, JSON.stringify(patch))
    })
  }

  async adminPublishImport(id: string) {
    await this.tx((db) => {
      const me = this.requireAdmin(db)
      const row = db.imports.find((x) => x.id === id)
      if (!row) throw err.notFound()
      if (row.duplicateOf) throw err.invalid('Resolve the duplicate first (discard or merge manually).')
      if (!row.addressVerified || !row.contactVerified || !row.permissionConfirmed) throw err.invalid('Verify address, contact details and the organisation’s permission before publishing.')
      if (!row.evidenceNote || row.evidenceNote.trim().length < 10) throw err.invalid('Record the verification evidence (what was checked, by whom, when).')
      if (!row.acceptedCategories.length) throw err.invalid('Record at least one accepted item category.')
      const loc = localityByName(row.locality)!
      let slug = row.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
      while (db.organizations.some((o) => o.slug === slug)) slug += '-1'
      const org: Organization = {
        id: uid(), slug, name: row.name, type: row.type, intro: '', locality: loc.name, address: row.address, pinCode: row.pinCode, lat: loc.lat, lng: loc.lng,
        coordsPrecision: 'locality', publicPhone: row.phone, publicEmail: row.email, contactVerified: true, status: 'approved', verifiedAt: this.ts(), verifiedBy: me.id,
        verificationNote: row.evidenceNote, nextReviewDue: new Date(this.now().getTime() + 180 * 86_400_000).toISOString(), deliveryMethods: ['partner_pickup'],
        pickupSlots: ['09:00 – 12:00'], conditionRules: '', restrictions: [], showImpact: false, isDemo: true, createdAt: this.ts(), updatedAt: this.ts(),
      }
      db.organizations.push(org)
      row.acceptedCategories.forEach((c) => db.itemPolicies.push({ id: uid(), orgId: org.id, categoryId: c, acceptance: 'accepts', conditionsAccepted: ['new', 'like_new', 'gently_used'] }))
      db.verificationDocs.push({ id: uid(), ownerKind: 'organization', ownerId: org.id, kind: 'Admin verification record', fileName: 'evidence-note.txt', status: 'accepted', reviewerNote: row.evidenceNote, uploadedAt: this.ts(), retainUntil: new Date(this.now().getTime() + 365 * 86_400_000).toISOString() })
      row.state = 'published'
      this.audit(db, me.id, 'import.published', 'organization', org.id, row.name)
    })
  }

  async adminSaveCategory(cat: Parameters<Backend['adminSaveCategory']>[0]) {
    await this.tx((db) => {
      const me = this.requireAdmin(db)
      const c = db.categories.find((x) => x.id === cat.id)
      if (!c) throw err.notFound()
      Object.assign(c, { label: cat.label, blurb: cat.blurb, active: cat.active })
      this.audit(db, me.id, 'category.updated', 'item_category', c.id)
    })
  }

  async adminPurgeExpiredDocuments() {
    return this.tx((db) => {
      const me = this.requireAdmin(db)
      const t = this.now().getTime()
      const before = db.verificationDocs.length
      db.verificationDocs = db.verificationDocs.filter((d) => new Date(d.retainUntil).getTime() > t && !(d.status === 'rejected' && t - new Date(d.uploadedAt).getTime() > 30 * 86_400_000))
      const removed = before - db.verificationDocs.length
      this.audit(db, me.id, 'documents.purged', 'verification_document', '*', `${removed} removed`)
      return removed
    })
  }

  async adminResetDemo() {
    await this.tx((db) => {
      this.requireAdmin(db)
      Object.assign(db, buildSeed(this.now()))
    })
  }

  /** Demo-only escape hatch (not on the Backend interface): reset without admin, used by the demo banner. */
  async resetDemoData() {
    this.store.remove(DB_KEY)
    this.store.remove(SESSION_KEY)
    this.emit()
  }
}
