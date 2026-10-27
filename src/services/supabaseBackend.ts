// Supabase implementation of the Backend contract. Enabled when VITE_SUPABASE_URL and
// VITE_SUPABASE_ANON_KEY are set (see src/services/index.ts).
//
// Every read and write goes through the RPCs in supabase/migrations/*.sql. Those functions authorise the
// caller and return JSON already shaped like src/lib/types.ts. Clients have no direct table write
// privileges at all, so this file contains no authorisation logic — only transport, uploads and mapping.
// The anon key is a public identifier; RLS and the RPC checks are the security boundary.

import { createClient, type SupabaseClient, type AuthError } from '@supabase/supabase-js'
import type {
  AppNotification, AuditLog, Category, DeliveryPartner, DonationRequest, DonationView, ImpactStats, ImportRow, JobListing,
  Organization, PublicOrganization, Report, Session, VerificationDoc, ApprovalStatus, DonationStatus, PickupAddress,
} from '../lib/types'
import {
  AppError, type Backend, type DonationSubmission, type OrgRegistration, type PartnerApplication, type PartnerStep, type AdminStats,
  type AdminOrgRow, type OrgEditable, type ErrorCode, type AuthCapabilities, type EmailSignUp, type OrgWorkspace,
} from './backend'
import { fileProblem, normalizePhone, passwordProblem } from '../lib/validation'
import { distanceKm, localityByName } from '../data/localities'
import { parseCsv } from '../lib/csv'
import { evaluateOrg, pageFromPlan, planSearch, type SearchPage, type SearchParams, type SearchResult } from '../lib/search'

type Bucket = 'verification-docs' | 'donation-photos' | 'delivery-proofs'

/** Maps Postgres / PostgREST / network errors to AppError codes the UI understands. */
function fail(e: { message?: string; code?: string } | null | undefined): never {
  const msg = e?.message ?? 'Unknown error'
  const m = /^(forbidden|invalid|conflict|rate_limited|not_found|unauthenticated)(?::\s*)?(.*)$/i.exec(msg)
  if (m) {
    const text = m[2] || m[1]
    throw new AppError(m[1].toLowerCase() as ErrorCode, text.charAt(0).toUpperCase() + text.slice(1))
  }
  if (e?.code === '42501' || /permission denied/i.test(msg)) throw new AppError('forbidden', 'You do not have permission to do that.')
  if (/failed to fetch|networkerror|load failed|fetch failed/i.test(msg)) throw new AppError('unavailable', 'Can’t reach the server. Check your connection and try again.')
  throw new AppError('unavailable', msg)
}

function authFail(e: AuthError): never {
  const msg = e.message || 'Authentication failed'
  if (e.status === 429 || /rate limit|too many/i.test(msg)) throw new AppError('rate_limited', 'Too many attempts. Please wait a minute and try again.')
  if (/invalid login credentials/i.test(msg)) throw new AppError('invalid', 'Incorrect email or password.')
  if (/email not confirmed/i.test(msg)) throw new AppError('invalid', 'Confirm your email first — open the link we sent you.')
  if (/already registered|already exists/i.test(msg)) throw new AppError('invalid', 'An account with this email already exists. Sign in instead, or reset your password.')
  if (/sms|phone provider|unsupported phone/i.test(msg)) throw new AppError('unavailable', 'Phone verification is not configured on this server (no SMS provider).')
  if (/token has expired|invalid otp|otp/i.test(msg)) throw new AppError('invalid', 'That code is incorrect or has expired. Request a new one.')
  if (/failed to fetch|network/i.test(msg)) throw new AppError('unavailable', 'Can’t reach the server. Check your connection and try again.')
  throw new AppError('invalid', msg)
}

function dataUrlToBlob(dataUrl: string) {
  const [head, b64] = dataUrl.split(',')
  const mime = /data:(.*?);/.exec(head)?.[1] ?? 'application/octet-stream'
  const bin = atob(b64)
  const arr = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
  return new Blob([arr], { type: mime })
}
const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' }

const env = import.meta.env as Record<string, string | undefined>

export class SupabaseBackend implements Backend {
  readonly mode = 'supabase' as const
  private sb: SupabaseClient
  private listeners = new Set<() => void>()
  private caps?: Promise<AuthCapabilities>

  constructor(url: string, anonKey: string, opts: { client?: SupabaseClient; realtime?: boolean } = {}) {
    this.sb = opts.client ?? createClient(url, anonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' } })
    this.sb.auth.onAuthStateChange(() => queueMicrotask(() => this.emit()))
    if (opts.realtime === false) return
    // Realtime: RLS applies to change events, so each user only hears about rows they can read.
    // If realtime is unavailable, screens fall back to polling (useData poll) and manual refresh.
    this.sb
      .channel('kindroute-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications' }, () => this.emit())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'donation_status_events' }, () => this.emit())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'delivery_jobs' }, () => this.emit())
      .subscribe()
  }

  subscribe(fn: () => void) {
    this.listeners.add(fn)
    return () => void this.listeners.delete(fn)
  }
  private emit() {
    this.listeners.forEach((f) => f())
  }

  private async rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
    let res
    try {
      res = await this.sb.rpc(fn, args)
    } catch (e) {
      fail(e as Error)
    }
    if (res.error) {
      // signed-out callers have no EXECUTE on protected RPCs — tell them to sign in rather than "forbidden"
      if (/permission denied for function/i.test(res.error.message) && !(await this.sb.auth.getSession()).data.session)
        throw new AppError('unauthenticated', 'Please sign in to continue.')
      fail(res.error)
    }
    return res.data as T
  }
  private async uid() {
    const { data } = await this.sb.auth.getSession()
    if (!data.session) throw new AppError('unauthenticated', 'Please sign in to continue.')
    return data.session.user.id
  }
  /** Uploads to "<uid>/<random>.<ext>" in a private bucket, after validating type and size. Returns the storage path. */
  private async upload(bucket: Bucket, dataUrl: string) {
    const blob = dataUrlToBlob(dataUrl)
    const problem = fileProblem(blob, bucket === 'verification-docs' ? 'document' : 'image')
    if (problem) throw new AppError('invalid', problem)
    const path = `${await this.uid()}/${crypto.randomUUID()}.${EXT[blob.type]}`
    const { error } = await this.sb.storage.from(bucket).upload(path, blob, { upsert: false, contentType: blob.type })
    if (error) fail(error)
    return path
  }
  /** Replaces private storage paths in request views with signed URLs valid for 10 minutes. */
  private async sign(views: DonationView[]) {
    const signAll = async (bucket: Bucket, paths: string[]) => {
      if (!paths.length) return new Map<string, string>()
      const { data } = await this.sb.storage.from(bucket).createSignedUrls([...new Set(paths)], 600)
      const map = new Map<string, string>()
      for (const d of data ?? []) if (d.path && d.signedUrl) map.set(d.path, d.signedUrl)
      return map
    }
    const [photos, proofs] = await Promise.all([
      signAll('donation-photos', views.flatMap((v) => v.items.map((i) => i.photo)).filter((p): p is string => !!p)),
      signAll('delivery-proofs', views.flatMap((v) => v.proofs.map((p) => p.photo)).filter((p): p is string => !!p)),
    ])
    for (const v of views) {
      v.items.forEach((i) => i.photo && (i.photo = photos.get(i.photo)))
      v.proofs.forEach((p) => p.photo && (p.photo = proofs.get(p.photo)))
    }
    return views
  }

  /* -------- auth -------- */
  async getSession(): Promise<Session | null> {
    const { data } = await this.sb.auth.getSession()
    if (!data.session) return null
    const s = await this.rpc<Session | null>('get_my_session')
    // signed in but no profile row (e.g. account created before the trigger existed): repair it
    return s ?? this.rpc<Session | null>('ensure_my_profile')
  }

  getAuthCapabilities() {
    this.caps ??= (async () => {
      const settings = await this.rpc<{ requirePhoneForDonation: boolean }>('get_public_settings').catch(() => ({ requirePhoneForDonation: true }))
      return {
        emailPassword: true,
        // Only advertise SMS codes when an SMS provider has been configured in Supabase Auth (set this flag after testing it).
        phoneOtp: env.VITE_SUPABASE_PHONE_AUTH === 'true',
        phoneOtpSimulated: false,
        requirePhoneForDonation: settings.requirePhoneForDonation,
        emailConfirmationRequired: env.VITE_SUPABASE_EMAIL_CONFIRM !== 'false',
      }
    })()
    return this.caps
  }

  async signUpWithEmail(input: EmailSignUp) {
    const pw = passwordProblem(input.password)
    if (pw) throw new AppError('invalid', pw)
    const { data, error } = await this.sb.auth.signUp({
      email: input.email.trim(),
      password: input.password,
      options: { data: { full_name: input.fullName.trim() }, emailRedirectTo: `${location.origin}${input.redirectPath ?? '/dashboard'}` },
    })
    if (error) authFail(error)
    // With email confirmation on, Supabase hides whether an address is registered by returning a user with no identities.
    if (data.user && data.user.identities && data.user.identities.length === 0)
      throw new AppError('invalid', 'An account with this email already exists. Sign in instead, or reset your password.')
    if (!data.session) return { session: null, needsEmailConfirmation: true }
    return { session: await this.getSession(), needsEmailConfirmation: false }
  }

  async signInWithEmail(email: string, password: string) {
    const { error } = await this.sb.auth.signInWithPassword({ email: email.trim(), password })
    if (error) authFail(error)
    const s = await this.getSession()
    if (!s) throw new AppError('unavailable', 'Signed in, but your profile could not be loaded.')
    if (s.user.accountStatus === 'suspended') {
      await this.sb.auth.signOut()
      throw new AppError('forbidden', 'This account has been suspended. Contact support.')
    }
    return s
  }

  async requestPasswordReset(email: string) {
    const { error } = await this.sb.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${location.origin}/reset-password?mode=update` })
    if (error) authFail(error)
    return {}
  }

  async updatePassword(newPassword: string) {
    const pw = passwordProblem(newPassword)
    if (pw) throw new AppError('invalid', pw)
    const { error } = await this.sb.auth.updateUser({ password: newPassword })
    if (error) authFail(error)
  }

  private async requirePhoneAuth() {
    if (!(await this.getAuthCapabilities()).phoneOtp) throw new AppError('unavailable', 'Phone verification is not configured on this server (no SMS provider).')
  }

  async requestOtp(phone: string) {
    await this.requirePhoneAuth()
    const p = normalizePhone(phone)
    if (!p) throw new AppError('invalid', 'Enter a valid 10-digit Indian mobile number.')
    const { error } = await this.sb.auth.signInWithOtp({ phone: p })
    if (error) authFail(error)
    return { cooldownSec: 60 }
  }

  async verifyOtp(phone: string, code: string, signup?: { fullName: string; email?: string }) {
    const p = normalizePhone(phone)
    if (!p) throw new AppError('invalid', 'Enter a valid mobile number.')
    const { error } = await this.sb.auth.verifyOtp({ phone: p, token: code, type: 'sms' })
    if (error) authFail(error)
    let s = await this.getSession()
    if (s && signup?.fullName && s.user.fullName === 'KindRoute member') {
      await this.rpc('update_my_profile', { p_full_name: signup.fullName })
      s = await this.getSession()
    }
    if (!s) throw new AppError('unavailable', 'Signed in, but your profile could not be loaded.')
    return s
  }

  async startPhoneVerification(phone: string) {
    await this.requirePhoneAuth()
    const p = normalizePhone(phone)
    if (!p) throw new AppError('invalid', 'Enter a valid 10-digit Indian mobile number.')
    const { error } = await this.sb.auth.updateUser({ phone: p })
    if (error) authFail(error)
    return { cooldownSec: 60 }
  }

  async confirmPhoneVerification(phone: string, code: string) {
    const p = normalizePhone(phone)
    if (!p) throw new AppError('invalid', 'Enter a valid mobile number.')
    const { error } = await this.sb.auth.verifyOtp({ phone: p, token: code, type: 'phone_change' })
    if (error) authFail(error)
    const s = await this.getSession()
    if (!s) throw new AppError('unavailable', 'Verified, but your profile could not be loaded.')
    return s
  }

  async updateProfile(patch: { fullName?: string; email?: string }) {
    const s = await this.getSession()
    if (!s) throw new AppError('unauthenticated', 'Please sign in to continue.')
    if (patch.fullName !== undefined && patch.fullName !== s.user.fullName) await this.rpc('update_my_profile', { p_full_name: patch.fullName })
    if (patch.email && patch.email !== s.user.email) {
      // Supabase sends a confirmation link; the profile email changes only after it is confirmed (auth trigger).
      const { error } = await this.sb.auth.updateUser({ email: patch.email.trim() }, { emailRedirectTo: `${location.origin}/dashboard?tab=profile` })
      if (error) authFail(error)
    }
  }

  async signOut() {
    await this.sb.auth.signOut()
  }

  /* -------- public -------- */
  listCategories() {
    return this.rpc<Category[]>('list_categories')
  }
  listPublicOrganizations() {
    return this.rpc<PublicOrganization[]>('list_public_organizations')
  }
  async searchOrganizations(params: SearchParams, page: { offset: number; limit: number }): Promise<SearchPage> {
    const plan = planSearch(params)
    const { parsed } = plan
    const res = await this.rpc<{ total: number; freshnessDays: number; results: Array<PublicOrganization & { distanceKm?: number }> }>('search_organizations', {
      p: {
        categories: plan.wantCats, orgTypes: plan.wantTypes, localities: plan.strictLocs, residual: parsed.residual, tags: parsed.tags,
        textOnly: !plan.wantCats.length && !plan.wantTypes.length && !parsed.localities.length && !parsed.tags.length,
        near: plan.near, origin: plan.origin && { lat: plan.origin.lat, lng: plan.origin.lng }, needsOnly: plan.needsOnly, pickupOnly: plan.pickupOnly,
        verifiedOnly: plan.verifiedOnly, sort: plan.sort, conflict: plan.conflict, limit: page.limit, offset: page.offset,
      },
    })
    const p2 = { ...plan, freshnessDays: res.freshnessDays }
    // The server decides eligibility and order; the shared evaluator only adds display reasons and per-category standing.
    const results = res.results.map((org): SearchResult => {
      const { distanceKm: d, ...o } = org
      const r = evaluateOrg(o, p2)
      return r ? { ...r, distanceKm: d ?? r.distanceKm } : { org: o, matchedNeeds: [], acceptedMatches: [], standing: {}, score: 0, reasons: [], distanceKm: d }
    })
    return pageFromPlan(plan, results, res.total, page.offset)
  }
  async getPublicOrganization(slug: string) {
    return (await this.rpc<PublicOrganization | null>('get_public_organization', { p_slug: slug })) ?? null
  }
  getImpactStats() {
    return this.rpc<ImpactStats>('impact_stats')
  }

  /* -------- donor -------- */
  async submitDonation(input: DonationSubmission) {
    const items = await Promise.all(input.items.map(async (i) => ({ ...i, photo: i.photo ? await this.upload('donation-photos', i.photo) : undefined })))
    return this.rpc<DonationRequest[]>('submit_donation', { payload: { ...input, items } })
  }
  async listMyDonations() {
    return this.sign(await this.rpc<DonationView[]>('list_my_donations'))
  }
  async getDonation(idOrCode: string) {
    return (await this.sign([await this.rpc<DonationView>('get_donation', { p_id_or_code: idOrCode })]))[0]
  }
  async cancelDonation(requestId: string, reason: string) {
    await this.rpc('cancel_donation', { p_request: requestId, p_reason: reason })
  }
  async confirmDropoff(requestId: string, note?: string) {
    await this.rpc('confirm_dropoff', { p_request: requestId, p_note: note ?? null })
  }
  listMyAddresses() {
    return this.rpc<PickupAddress[]>('list_my_addresses')
  }

  /* -------- notifications / reports -------- */
  listNotifications() {
    return this.rpc<AppNotification[]>('list_my_notifications')
  }
  async markNotificationsRead(ids?: string[]) {
    await this.rpc('mark_notifications_read', { p_ids: ids ?? null })
  }
  async fileReport(input: { kind: Report['kind']; message: string; requestId?: string; orgId?: string }) {
    await this.rpc('file_report', { p_kind: input.kind, p_message: input.message, p_request: input.requestId ?? null, p_org: input.orgId ?? null })
  }

  /* -------- organisation -------- */
  async registerOrganization(input: OrgRegistration) {
    const loc = localityByName(input.locality)
    if (!loc) throw new AppError('invalid', 'Choose a Pune locality.')
    return this.rpc<Organization>('register_organization', { payload: { ...input, lat: loc.lat, lng: loc.lng } })
  }
  getMyOrganization() {
    return this.rpc<OrgWorkspace | null>('get_my_organization')
  }
  async updateMyOrganization(patch: Partial<OrgEditable>) {
    await this.rpc('org_update_profile', { patch })
  }
  async savePolicy(policy: Parameters<Backend['savePolicy']>[0]) {
    await this.rpc('org_save_policy', { p: policy })
  }
  async saveNeed(need: Parameters<Backend['saveNeed']>[0]) {
    await this.rpc('org_save_need', { p: need })
  }
  async confirmNeed(needId: string) {
    await this.rpc('org_confirm_need', { p_need: needId })
  }
  async closeNeed(needId: string, outcome: 'fulfilled' | 'closed') {
    await this.rpc('org_close_need', { p_need: needId, p_outcome: outcome })
  }
  async uploadOrgDocument(kind: string, file: { name: string; dataUrl: string }) {
    const path = await this.upload('verification-docs', file.dataUrl)
    await this.rpc('org_add_document', { p_type: kind, p_file_name: file.name, p_path: path })
  }
  async getDocumentUrl(doc: VerificationDoc) {
    if (!doc.storagePath || doc.storagePath.startsWith('admin-record/')) return null
    const { data, error } = await this.sb.storage.from('verification-docs').createSignedUrl(doc.storagePath, 60)
    if (error) fail(error)
    return data.signedUrl
  }
  async listOrgRequests() {
    return this.sign(await this.rpc<DonationView[]>('list_org_requests'))
  }
  async orgDecide(requestId: string, decision: 'accept' | 'reject', reason?: string) {
    await this.rpc('org_decide', { p_request: requestId, p_decision: decision, p_reason: reason ?? null })
  }
  async orgConfirmReceipt(requestId: string, note?: string, photo?: string) {
    await this.rpc('org_confirm_receipt', { p_request: requestId, p_note: note ?? null, p_photo: photo ? await this.upload('delivery-proofs', photo) : null })
  }
  async orgReportNotReceived(requestId: string, reason: string) {
    await this.rpc('org_report_not_received', { p_request: requestId, p_reason: reason })
  }
  async orgReoffer(requestId: string) {
    await this.rpc('org_reoffer', { p_request: requestId })
  }

  /* -------- partner -------- */
  async applyAsPartner(input: PartnerApplication) {
    const path = await this.upload('verification-docs', input.idDocument.dataUrl)
    return this.rpc<DeliveryPartner>('apply_as_partner', {
      payload: { fullName: input.fullName, vehicle: input.vehicle, serviceLocalities: input.serviceLocalities, idFileName: input.idDocument.name, idStoragePath: path, consent: input.consent },
    })
  }
  async getMyPartnerProfile() {
    return (await this.rpc<{ partner: DeliveryPartner; docs: VerificationDoc[] } | null>('get_my_partner_profile')) ?? null
  }
  async setAvailability(available: boolean) {
    await this.rpc('set_partner_availability', { p_available: available })
  }
  async listAvailableJobs() {
    const jobs = await this.rpc<JobListing[]>('list_available_jobs')
    return jobs.map((j) => {
      const a = localityByName(j.pickupLocality)
      const b = localityByName(j.destinationLocality)
      return { ...j, approxKm: a && b ? Math.round(distanceKm(a, b) * 10) / 10 : undefined }
    })
  }
  async listMyJobs() {
    return this.sign(await this.rpc<DonationView[]>('list_my_jobs'))
  }
  async claimJob(jobId: string, expectedVersion: number) {
    await this.rpc('claim_delivery_job', { p_job: jobId, p_expected_version: expectedVersion })
  }
  async releaseJob(requestId: string, reason: string) {
    await this.rpc('release_job', { p_request: requestId, p_reason: reason })
  }
  async partnerAdvance(requestId: string, to: PartnerStep, opts: { note?: string; photo?: string } = {}) {
    await this.rpc('partner_advance', { p_request: requestId, p_to: to, p_note: opts.note ?? null, p_photo: opts.photo ? await this.upload('delivery-proofs', opts.photo) : null })
  }

  /* -------- admin -------- */
  adminStats() {
    return this.rpc<AdminStats>('admin_stats')
  }
  adminListOrganizations() {
    return this.rpc<AdminOrgRow[]>('admin_list_organizations')
  }
  async adminReviewOrganization(orgId: string, decision: ApprovalStatus, note: string, checks: { contactVerified: boolean; addressVerified: boolean }) {
    await this.rpc('admin_review_organization', { p_org: orgId, p_decision: decision, p_note: note, p_contact: checks.contactVerified, p_address: checks.addressVerified })
  }
  async adminReviewDocument(docId: string, status: 'accepted' | 'rejected', note?: string) {
    await this.rpc('admin_review_document', { p_doc: docId, p_status: status, p_note: note ?? null })
  }
  adminListPartners() {
    return this.rpc<Array<{ partner: DeliveryPartner; docs: VerificationDoc[] }>>('admin_list_partners')
  }
  async adminReviewPartner(partnerId: string, decision: ApprovalStatus, note: string) {
    await this.rpc('admin_review_partner', { p_partner: partnerId, p_decision: decision, p_note: note })
  }
  async adminListRequests() {
    return this.sign(await this.rpc<DonationView[]>('admin_list_requests'))
  }
  async adminTransition(requestId: string, to: DonationStatus, note: string) {
    await this.rpc('admin_transition', { p_request: requestId, p_to: to, p_note: note })
  }
  async adminClearFlag(requestId: string, note: string) {
    await this.rpc('admin_clear_flag', { p_request: requestId, p_note: note })
  }
  adminListReports() {
    return this.rpc<Report[]>('admin_list_reports')
  }
  async adminUpdateReport(reportId: string, status: Report['status'], resolution?: string) {
    await this.rpc('admin_update_report', { p_report: reportId, p_status: status, p_resolution: resolution ?? null })
  }
  adminListAudit() {
    return this.rpc<AuditLog[]>('admin_list_audit')
  }
  adminListImports() {
    return this.rpc<ImportRow[]>('admin_list_imports')
  }
  async adminImportCsv(text: string, source: string) {
    const errors: string[] = []
    const rows = parseCsv(text).flatMap((r, i) => {
      const loc = localityByName(r.locality ?? '')
      if (!loc) {
        errors.push(`Row ${i + 2}: unknown Pune locality “${r.locality ?? ''}”`)
        return []
      }
      return [{ name: r.name ?? '', type: r.type || 'other', locality: loc.name, address: r.address ?? '', pinCode: r.pin_code ?? r.pin ?? loc.pin,
        phone: r.phone ?? '', email: r.email ?? '', acceptedCategories: (r.accepted_categories ?? '').split(/[;|]/).map((s) => s.trim()).filter(Boolean) }]
    })
    const res = await this.rpc<{ added: number; duplicates: number; errors: string[] }>('admin_import_rows', { p_rows: rows, p_source: source })
    return { ...res, errors: [...errors, ...res.errors] }
  }
  async adminUpdateImport(id: string, patch: Parameters<Backend['adminUpdateImport']>[1]) {
    await this.rpc('admin_update_import', { p_import: id, patch })
  }
  async adminPublishImport(id: string) {
    await this.rpc('admin_publish_import', { p_import: id })
  }
  async adminSaveCategory(cat: Category) {
    await this.rpc('admin_save_category', { p: { id: cat.id, label: cat.label, blurb: cat.blurb, active: cat.active } })
  }
  async adminPurgeExpiredDocuments() {
    const r = await this.rpc<{ removed: number; paths: string[] }>('admin_purge_expired_documents')
    if (r.paths.length) {
      const { error } = await this.sb.storage.from('verification-docs').remove(r.paths)
      if (error) throw new AppError('unavailable', `Records deleted, but ${r.paths.length} stored file(s) could not be removed: ${error.message}`)
    }
    return r.removed
  }
  async adminResetDemo() {
    throw new AppError('forbidden', 'Demo reset is not available on the production backend.')
  }
}

