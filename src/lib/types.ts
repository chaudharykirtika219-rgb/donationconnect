// Domain model shared by the demo backend, the Supabase adapter and the UI.
// Field names are camelCase here; the SQL schema uses snake_case equivalents.

export type Role = 'donor' | 'org_staff' | 'delivery_partner' | 'admin'

export type OrgType =
  | 'children_home'
  | 'orphanage'
  | 'old_age_home'
  | 'shelter'
  | 'ngo'
  | 'community_kitchen'
  | 'food_bank'
  | 'special_needs'
  | 'other'

export type CategoryId =
  | 'books'
  | 'clothes'
  | 'packaged_food'
  | 'fresh_food'
  | 'bedding'
  | 'toys'
  | 'hygiene'
  | 'furniture'
  | 'medical'
  | 'other'

export type ApprovalStatus = 'pending' | 'under_review' | 'needs_info' | 'approved' | 'rejected' | 'suspended'
/** Per-category acceptance policy. Only 'accepts' makes an organisation eligible for that category. */
export type Acceptance = 'accepts' | 'does_not_accept' | 'temporarily_unavailable'
export type NeedStatus = 'open' | 'fulfilled' | 'closed'
export type Urgency = 'low' | 'medium' | 'high'
export type Condition = 'new' | 'like_new' | 'gently_used' | 'needs_repair'
export type Unit = 'pieces' | 'sets' | 'pairs' | 'bags' | 'boxes' | 'kg' | 'litres' | 'meals'
export type DeliveryMethod = 'partner_pickup' | 'donor_dropoff'
export type ContactMethod = 'phone' | 'sms' | 'email' | 'whatsapp'
export type Vehicle = 'bicycle' | 'two_wheeler' | 'three_wheeler' | 'car' | 'van'
export type PackageSize = 'small' | 'medium' | 'large'

export type DonationStatus =
  | 'draft'
  | 'pending_organization_confirmation'
  | 'organization_accepted'
  | 'awaiting_delivery_partner'
  | 'delivery_partner_assigned'
  | 'pickup_scheduled'
  | 'picked_up'
  | 'in_transit'
  | 'delivered_pending_receipt_confirmation'
  | 'completed'
  | 'rejected'
  | 'cancelled'
  | 'failed'

export type Actor = 'donor' | 'org' | 'partner' | 'admin' | 'system'

export interface Category {
  id: CategoryId
  label: string
  short: string
  blurb: string
  defaultUnit: Unit
  /** Restricted categories show extra safety guidance and require explicit org acceptance. */
  restricted?: boolean
  active: boolean
  sort: number
}

export interface Profile {
  id: string
  fullName: string
  /** E.164, or '' for email-only accounts that have not added a phone yet */
  phone: string
  phoneVerified: boolean
  email?: string
  emailVerified?: boolean
  avatarUrl?: string
  accountStatus?: 'active' | 'suspended'
  createdAt: string
  updatedAt: string
  isDemo: boolean
}

export interface UserRole {
  userId: string
  role: Role
  orgId?: string
  grantedBy: string
  createdAt: string
}

export interface Organization {
  id: string
  slug: string
  name: string
  type: OrgType
  intro: string
  locality: string
  address: string
  pinCode: string
  lat: number
  lng: number
  /** 'locality' = coordinates are a neighbourhood centroid, distances are approximate. */
  coordsPrecision: 'exact' | 'locality'
  publicPhone: string
  publicEmail: string
  website?: string
  contactVerified: boolean
  registrationType?: string
  registrationNumber?: string
  status: ApprovalStatus
  verifiedAt?: string
  verifiedBy?: string
  verificationNote?: string
  nextReviewDue?: string
  deliveryMethods: DeliveryMethod[]
  dropoffHours?: string
  pickupSlots: string[]
  conditionRules: string
  restrictions: string[]
  /** The organisation consented to showing aggregate impact on its profile. */
  showImpact: boolean
  isDemo: boolean
  createdAt: string
  updatedAt: string
}

export interface OrgItemPolicy {
  id: string
  orgId: string
  categoryId: CategoryId
  acceptance: Acceptance
  conditionsAccepted: Condition[]
  /** restrictions shown to donors, e.g. "no school uniforms" */
  notes?: string
  /** optional cap on quantity per donation request */
  quantityLimit?: number
  /** packaged food: minimum remaining shelf life in days at pickup */
  minShelfLifeDays?: number
  /** fresh food: max hours between preparation and pickup */
  maxHoursSincePrep?: number
}

export interface OrgNeed {
  id: string
  orgId: string
  categoryId: CategoryId
  title: string
  tags: string[]
  quantity?: number
  unit?: Unit
  fulfilledQty: number
  urgency: Urgency
  note?: string
  lastConfirmedAt: string
  status: NeedStatus
}

export interface VerificationDoc {
  id: string
  ownerKind: 'organization' | 'partner'
  ownerId: string
  kind: string
  fileName: string
  /** demo only: small data URL. Production: a private Supabase Storage path. */
  dataUrl?: string
  storagePath?: string
  status: 'submitted' | 'accepted' | 'rejected'
  reviewerNote?: string
  uploadedAt: string
  /** documents are deleted after this date unless re-verified */
  retainUntil: string
}

export interface FoodDetails {
  kind: 'packaged' | 'fresh'
  expiryDate?: string
  preparedAt?: string
  packaging: string
  storage: 'room' | 'refrigerated' | 'frozen'
  sealed: boolean
  vegetarian?: boolean
  allergens?: string
}

export interface DonationItemInput {
  categoryId: CategoryId
  name: string
  quantity: number
  unit: Unit
  condition: Condition
  description?: string
  photo?: string
  food?: FoodDetails
}

export interface DonationItem extends DonationItemInput {
  id: string
  requestId: string
}

export interface PickupAddress {
  id: string
  userId: string
  line1: string
  landmark?: string
  locality: string
  pinCode: string
  instructions?: string
}

export interface DonationRequest {
  id: string
  code: string
  batchId: string
  donorId: string
  orgId: string
  status: DonationStatus
  deliveryMethod: DeliveryMethod
  pickupAddressId?: string
  preferredDate: string
  preferredSlot: string
  contactMethod: ContactMethod
  notes?: string
  flagged?: string
  rejectionReason?: string
  cancelReason?: string
  failureReason?: string
  /** free-text response from the organisation when it accepted or declined */
  organizationResponse?: string
  submittedAt?: string
  acceptedAt?: string
  pickedUpAt?: string
  deliveredAt?: string
  completedAt?: string
  createdAt: string
  updatedAt: string
  isDemo: boolean
}

export interface DeliveryPartner {
  id: string
  userId: string
  fullName: string
  phone: string
  vehicle: Vehicle
  serviceLocalities: string[]
  status: ApprovalStatus
  reviewNote?: string
  available: boolean
  isDemo: boolean
  createdAt: string
  updatedAt: string
}

export interface DeliveryJob {
  id: string
  requestId: string
  partnerId?: string
  state: 'open' | 'claimed' | 'done' | 'cancelled'
  packageSize: PackageSize
  /** optimistic concurrency token — incremented on every claim/release */
  version: number
  claimedAt?: string
  createdAt: string
  updatedAt: string
}

export interface StatusEvent {
  id: string
  requestId: string
  from: DonationStatus | null
  to: DonationStatus
  actorId: string
  actor: Actor
  note?: string
  at: string
}

export interface DonationProof {
  id: string
  requestId: string
  kind: 'pickup' | 'delivery' | 'receipt'
  uploadedBy: string
  note?: string
  photo?: string
  at: string
}

export interface AppNotification {
  id: string
  userId: string
  title: string
  body: string
  link?: string
  read: boolean
  at: string
}

export interface Report {
  id: string
  reporterId: string
  requestId?: string
  orgId?: string
  kind: 'dispute' | 'complaint' | 'safety' | 'other'
  message: string
  status: 'open' | 'investigating' | 'resolved'
  resolution?: string
  createdAt: string
  updatedAt: string
}

export interface AuditLog {
  id: string
  actorId: string
  action: string
  entity: string
  entityId: string
  details?: string
  at: string
}

export interface ImportRow {
  id: string
  name: string
  type: OrgType
  locality: string
  address: string
  pinCode: string
  phone: string
  email: string
  acceptedCategories: CategoryId[]
  source: string
  state: 'staged' | 'contacted' | 'confirmed' | 'published' | 'discarded'
  duplicateOf?: string
  addressVerified: boolean
  contactVerified: boolean
  permissionConfirmed: boolean
  evidenceNote?: string
  reviewedAt?: string
  createdAt: string
}

export interface Session {
  user: Profile
  roles: UserRole[]
}

/* ---------- view models (redacted projections) ---------- */

export interface PublicOrganization
  extends Omit<Organization, 'registrationNumber' | 'verifiedBy' | 'verificationNote'> {
  policies: OrgItemPolicy[]
  needs: OrgNeed[]
  impact?: { completed: number; items: number }
}

export type ViewerKind = 'donor' | 'org' | 'partner' | 'admin'

export interface DonationView {
  viewer: ViewerKind
  request: DonationRequest
  items: DonationItem[]
  org: { id: string; slug: string; name: string; type: OrgType; locality: string; address?: string; phone?: string }
  donor: { displayName: string; locality?: string; phone?: string; email?: string; address?: PickupAddress }
  partner?: { displayName: string; vehicle: Vehicle; isDemo: boolean; phone?: string }
  job?: DeliveryJob
  events: StatusEvent[]
  proofs: DonationProof[]
}

export interface JobListing {
  job: DeliveryJob
  requestCode: string
  status: DonationStatus
  pickupLocality: string
  destinationLocality: string
  destinationName: string
  categories: CategoryId[]
  itemCount: number
  preferredDate: string
  preferredSlot: string
  approxKm?: number
}

export interface ImpactStats {
  donationsCompleted: number
  organizationsVerified: number
  itemsDelivered: number
  localitiesServed: number
  isDemo: boolean
}
