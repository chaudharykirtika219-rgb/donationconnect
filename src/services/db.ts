import type {
  AppNotification, AuditLog, Category, DeliveryJob, DeliveryPartner, DonationItem, DonationProof, DonationRequest,
  ImportRow, Organization, OrgItemPolicy, OrgNeed, PickupAddress, Profile, Report, StatusEvent, UserRole, VerificationDoc,
} from '../lib/types'

/** In-browser mirror of the SQL schema used by the demo backend. One array per table. */
export interface DB {
  version: number
  seededAt: string
  profiles: Profile[]
  userRoles: UserRole[]
  organizations: Organization[]
  verificationDocs: VerificationDoc[]
  itemPolicies: OrgItemPolicy[]
  needs: OrgNeed[]
  categories: Category[]
  requests: DonationRequest[]
  requestItems: DonationItem[]
  pickupAddresses: PickupAddress[]
  partners: DeliveryPartner[]
  jobs: DeliveryJob[]
  events: StatusEvent[]
  proofs: DonationProof[]
  notifications: AppNotification[]
  reports: Report[]
  audit: AuditLog[]
  imports: ImportRow[]
  otps: { phone: string; code: string; expiresAt: number; attempts: number; sentAt: number[] }[]
  submissionsLog: { userId: string; at: number }[]
  /** email + password credentials (demo: salted SHA-256 — the real backend is Supabase Auth) */
  credentials: { userId: string; email: string; salt: string; hash: string; failed: number[] }[]
  /** password-reset tokens, stored hashed; single use, 30-minute expiry */
  resetTokens: { userId: string; tokenHash: string; expiresAt: number }[]
  /** idempotency keys for donation submissions: clientRequestId → created request ids */
  submissionKeys: { userId: string; key: string; requestIds: string[] }[]
}

export const DB_VERSION = 4
