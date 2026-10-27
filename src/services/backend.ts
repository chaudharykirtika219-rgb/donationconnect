import type {
  AppNotification, AuditLog, Category, ContactMethod, DeliveryMethod, DeliveryPartner, DonationItemInput, DonationRequest,
  DonationView, ImpactStats, ImportRow, JobListing, Organization, OrgItemPolicy, OrgNeed, PickupAddress, PublicOrganization,
  Report, Session, Vehicle, VerificationDoc, CategoryId, ApprovalStatus, DonationStatus, OrgType, Profile,
} from '../lib/types'
import type { SearchPage, SearchParams } from '../lib/search'

export type ErrorCode = 'unauthenticated' | 'forbidden' | 'not_found' | 'invalid' | 'conflict' | 'rate_limited' | 'unavailable'

export class AppError extends Error {
  constructor(public code: ErrorCode, message: string) {
    super(message)
    this.name = 'AppError'
  }
}

export interface DonationSubmission {
  /** generated once per draft; the server returns the original result if the same id is submitted twice (double clicks, retries) */
  clientRequestId: string
  items: Array<DonationItemInput & { orgId: string }>
  methods: Record<string, DeliveryMethod>
  donor: { fullName: string; email?: string; contactMethod: ContactMethod }
  pickup?: { line1: string; landmark?: string; locality: string; pinCode: string; instructions?: string }
  preferredDate: string
  preferredSlot: string
  notes?: string
  consent: boolean
}

/** What sign-in methods actually work in this deployment — the UI never offers a method that is not configured. */
export interface AuthCapabilities {
  emailPassword: boolean
  /** SMS OTP. Supabase: only when VITE_SUPABASE_PHONE_AUTH=true (an SMS provider is configured in Supabase Auth). */
  phoneOtp: boolean
  /** demo only: codes are shown on screen instead of being texted */
  phoneOtpSimulated: boolean
  /** server setting: donors must verify a phone number before submitting (otherwise a confirmed email is required) */
  requirePhoneForDonation: boolean
  /** Supabase "Confirm email" setting — sign-up does not create a session until the link is clicked */
  emailConfirmationRequired: boolean
}

export interface EmailSignUp {
  email: string
  password: string
  fullName: string
  /** where to send the user after they confirm their email */
  redirectPath?: string
}

export interface OrgRegistration {
  name: string
  type: OrgType
  intro: string
  locality: string
  address: string
  pinCode: string
  publicPhone: string
  publicEmail: string
  website?: string
  registrationType: string
  registrationNumber: string
  deliveryMethods: DeliveryMethod[]
  acceptedCategories: CategoryId[]
}

export interface OrgWorkspace {
  org: Organization
  policies: OrgItemPolicy[]
  needs: OrgNeed[]
  docs: VerificationDoc[]
}

export interface PartnerApplication {
  fullName: string
  vehicle: Vehicle
  serviceLocalities: string[]
  idDocument: { name: string; dataUrl: string }
  consent: boolean
}

export type PartnerStep = 'pickup_scheduled' | 'picked_up' | 'in_transit' | 'delivered_pending_receipt_confirmation' | 'failed'

export interface AdminStats {
  byStatus: Partial<Record<DonationStatus, number>>
  orgsPending: number
  partnersPending: number
  reportsOpen: number
  flagged: number
  totalRequests: number
}

export interface AdminOrgRow {
  org: Organization
  docs: VerificationDoc[]
  staff: Profile[]
}

export type OrgEditable = Pick<
  Organization,
  'intro' | 'publicPhone' | 'publicEmail' | 'website' | 'deliveryMethods' | 'dropoffHours' | 'pickupSlots' | 'conditionRules' | 'restrictions' | 'showImpact'
>

/**
 * The single integration boundary between UI and data. The UI never talks to storage directly.
 * Implementations: DemoBackend (browser-local, clearly labelled) and SupabaseBackend (Postgres + RLS).
 */
export interface Backend {
  readonly mode: 'demo' | 'supabase'
  subscribe(fn: () => void): () => void

  getSession(): Promise<Session | null>
  getAuthCapabilities(): Promise<AuthCapabilities>
  signUpWithEmail(input: EmailSignUp): Promise<{ session: Session | null; needsEmailConfirmation: boolean }>
  signInWithEmail(email: string, password: string): Promise<Session>
  /** sends a reset link. Demo: returns the link so it can be shown in the labelled demo inbox. */
  requestPasswordReset(email: string): Promise<{ demoLink?: string }>
  /** sets a new password for the signed-in (or recovery-link) session. Demo passes the token from the link. */
  updatePassword(newPassword: string, demoRecoveryToken?: string): Promise<void>
  /** add / verify a phone number on the signed-in account */
  startPhoneVerification(phone: string): Promise<{ demoCode?: string; cooldownSec: number }>
  confirmPhoneVerification(phone: string, code: string): Promise<Session>
  requestOtp(phone: string): Promise<{ demoCode?: string; cooldownSec: number }>
  verifyOtp(phone: string, code: string, signup?: { fullName: string; email?: string }): Promise<Session>
  updateProfile(patch: { fullName?: string; email?: string }): Promise<void>
  signOut(): Promise<void>

  listCategories(): Promise<Category[]>
  listPublicOrganizations(): Promise<PublicOrganization[]>
  /** paginated, server-side search (Supabase: search_organizations RPC) */
  searchOrganizations(params: SearchParams, page: { offset: number; limit: number }): Promise<SearchPage>
  getPublicOrganization(slug: string): Promise<PublicOrganization | null>
  getImpactStats(): Promise<ImpactStats>

  submitDonation(input: DonationSubmission): Promise<DonationRequest[]>
  listMyDonations(): Promise<DonationView[]>
  getDonation(idOrCode: string): Promise<DonationView>
  cancelDonation(requestId: string, reason: string): Promise<void>
  confirmDropoff(requestId: string, note?: string): Promise<void>
  listMyAddresses(): Promise<PickupAddress[]>

  listNotifications(): Promise<AppNotification[]>
  markNotificationsRead(ids?: string[]): Promise<void>
  fileReport(input: { kind: Report['kind']; message: string; requestId?: string; orgId?: string }): Promise<void>

  registerOrganization(input: OrgRegistration): Promise<Organization>
  getMyOrganization(): Promise<OrgWorkspace | null>
  updateMyOrganization(patch: Partial<OrgEditable>): Promise<void>
  savePolicy(policy: Omit<OrgItemPolicy, 'id' | 'orgId'>): Promise<void>
  saveNeed(need: Partial<OrgNeed> & Pick<OrgNeed, 'categoryId' | 'title' | 'urgency'>): Promise<void>
  confirmNeed(needId: string): Promise<void>
  /** close a need as fulfilled or no longer needed (it disappears from public search) */
  closeNeed(needId: string, outcome: 'fulfilled' | 'closed'): Promise<void>
  uploadOrgDocument(kind: string, file: { name: string; dataUrl: string }): Promise<void>
  /** short-lived URL for a private verification document (owner or admin only) */
  getDocumentUrl(doc: VerificationDoc): Promise<string | null>
  listOrgRequests(): Promise<DonationView[]>
  orgDecide(requestId: string, decision: 'accept' | 'reject', reason?: string): Promise<void>
  orgConfirmReceipt(requestId: string, note?: string, photo?: string): Promise<void>
  orgReportNotReceived(requestId: string, reason: string): Promise<void>
  orgReoffer(requestId: string): Promise<void>

  applyAsPartner(input: PartnerApplication): Promise<DeliveryPartner>
  getMyPartnerProfile(): Promise<{ partner: DeliveryPartner; docs: VerificationDoc[] } | null>
  setAvailability(available: boolean): Promise<void>
  listAvailableJobs(): Promise<JobListing[]>
  listMyJobs(): Promise<DonationView[]>
  claimJob(jobId: string, expectedVersion: number): Promise<void>
  releaseJob(requestId: string, reason: string): Promise<void>
  partnerAdvance(requestId: string, to: PartnerStep, opts?: { note?: string; photo?: string }): Promise<void>

  adminStats(): Promise<AdminStats>
  adminListOrganizations(): Promise<AdminOrgRow[]>
  adminReviewOrganization(orgId: string, decision: ApprovalStatus, note: string, checks: { contactVerified: boolean; addressVerified: boolean }): Promise<void>
  adminReviewDocument(docId: string, status: 'accepted' | 'rejected', note?: string): Promise<void>
  adminListPartners(): Promise<Array<{ partner: DeliveryPartner; docs: VerificationDoc[] }>>
  adminReviewPartner(partnerId: string, decision: ApprovalStatus, note: string): Promise<void>
  adminListRequests(): Promise<DonationView[]>
  adminTransition(requestId: string, to: DonationStatus, note: string): Promise<void>
  adminClearFlag(requestId: string, note: string): Promise<void>
  adminListReports(): Promise<Report[]>
  adminUpdateReport(reportId: string, status: Report['status'], resolution?: string): Promise<void>
  adminListAudit(): Promise<AuditLog[]>
  adminListImports(): Promise<ImportRow[]>
  adminImportCsv(text: string, source: string): Promise<{ added: number; duplicates: number; errors: string[] }>
  adminUpdateImport(id: string, patch: Partial<Pick<ImportRow, 'state' | 'addressVerified' | 'contactVerified' | 'permissionConfirmed' | 'evidenceNote'>>): Promise<void>
  adminPublishImport(id: string): Promise<void>
  adminSaveCategory(cat: Category): Promise<void>
  /** deletes expired document rows and their stored files; returns how many were removed */
  adminPurgeExpiredDocuments(): Promise<number>
  adminResetDemo(): Promise<void>
}
