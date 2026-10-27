import type { Actor, DonationStatus } from './types'

export interface StatusMeta {
  label: string
  explain: string
  tone: 'neutral' | 'waiting' | 'active' | 'good' | 'bad'
}

export const STATUS_META: Record<DonationStatus, StatusMeta> = {
  draft: { label: 'Draft', explain: 'Not submitted yet. Nobody has been notified.', tone: 'neutral' },
  pending_organization_confirmation: {
    label: 'Awaiting organisation confirmation',
    explain: 'The organisation has been notified and will accept or decline. This is not yet a confirmed pickup.',
    tone: 'waiting',
  },
  organization_accepted: { label: 'Accepted by organisation', explain: 'The organisation confirmed it can use these items.', tone: 'active' },
  awaiting_delivery_partner: {
    label: 'Awaiting delivery partner',
    explain: 'The job is visible to approved delivery partners serving your area.',
    tone: 'waiting',
  },
  delivery_partner_assigned: { label: 'Delivery partner assigned', explain: 'A partner accepted the job and will confirm a pickup time.', tone: 'active' },
  pickup_scheduled: { label: 'Pickup scheduled', explain: 'The partner confirmed your pickup slot.', tone: 'active' },
  picked_up: { label: 'Picked up', explain: 'The partner collected the items from you.', tone: 'active' },
  in_transit: { label: 'In transit', explain: 'On the way to the organisation. Status-based tracking — no live GPS.', tone: 'active' },
  delivered_pending_receipt_confirmation: {
    label: 'Delivered — awaiting receipt confirmation',
    explain: 'Delivery proof was recorded. The organisation still needs to confirm it received the items.',
    tone: 'waiting',
  },
  completed: { label: 'Completed', explain: 'The organisation confirmed receipt. Thank you.', tone: 'good' },
  rejected: { label: 'Declined by organisation', explain: 'The organisation could not accept this request.', tone: 'bad' },
  cancelled: { label: 'Cancelled', explain: 'This request was cancelled.', tone: 'bad' },
  failed: { label: 'Failed — rescheduling required', explain: 'Something went wrong. The request can be re-offered to partners or cancelled.', tone: 'bad' },
}

/** The happy path, used to render the progress timeline. */
export const PARTNER_PATH: DonationStatus[] = [
  'pending_organization_confirmation',
  'organization_accepted',
  'awaiting_delivery_partner',
  'delivery_partner_assigned',
  'pickup_scheduled',
  'picked_up',
  'in_transit',
  'delivered_pending_receipt_confirmation',
  'completed',
]
export const DROPOFF_PATH: DonationStatus[] = ['pending_organization_confirmation', 'organization_accepted', 'delivered_pending_receipt_confirmation', 'completed']

export const TERMINAL: DonationStatus[] = ['completed', 'rejected', 'cancelled']

interface Rule {
  from: DonationStatus[]
  to: DonationStatus
  by: Actor[]
  /** only valid for this delivery method */
  method?: 'partner_pickup' | 'donor_dropoff'
}

// Single source of truth for allowed transitions. Mirrored in SQL (kr_transition_allowed).
export const TRANSITIONS: Rule[] = [
  { from: ['draft'], to: 'pending_organization_confirmation', by: ['donor'] },
  { from: ['pending_organization_confirmation'], to: 'organization_accepted', by: ['org'] },
  { from: ['pending_organization_confirmation'], to: 'rejected', by: ['org', 'admin'] },
  { from: ['organization_accepted'], to: 'awaiting_delivery_partner', by: ['system', 'org', 'admin'], method: 'partner_pickup' },
  { from: ['awaiting_delivery_partner'], to: 'delivery_partner_assigned', by: ['partner'], method: 'partner_pickup' },
  { from: ['delivery_partner_assigned', 'pickup_scheduled'], to: 'awaiting_delivery_partner', by: ['partner', 'admin'], method: 'partner_pickup' },
  { from: ['delivery_partner_assigned'], to: 'pickup_scheduled', by: ['partner'], method: 'partner_pickup' },
  { from: ['pickup_scheduled'], to: 'picked_up', by: ['partner'], method: 'partner_pickup' },
  { from: ['picked_up'], to: 'in_transit', by: ['partner'], method: 'partner_pickup' },
  { from: ['in_transit'], to: 'delivered_pending_receipt_confirmation', by: ['partner'], method: 'partner_pickup' },
  { from: ['organization_accepted'], to: 'delivered_pending_receipt_confirmation', by: ['donor'], method: 'donor_dropoff' },
  { from: ['delivered_pending_receipt_confirmation'], to: 'completed', by: ['org'] },
  { from: ['delivered_pending_receipt_confirmation'], to: 'failed', by: ['org', 'admin'] },
  { from: ['pickup_scheduled', 'picked_up', 'in_transit'], to: 'failed', by: ['partner', 'admin'], method: 'partner_pickup' },
  { from: ['failed'], to: 'awaiting_delivery_partner', by: ['org', 'admin'], method: 'partner_pickup' },
  {
    from: ['draft', 'pending_organization_confirmation', 'organization_accepted', 'awaiting_delivery_partner', 'delivery_partner_assigned', 'pickup_scheduled'],
    to: 'cancelled',
    by: ['donor', 'admin'],
  },
  { from: ['organization_accepted', 'awaiting_delivery_partner', 'failed'], to: 'cancelled', by: ['org', 'admin'] },
]

export function canTransition(
  from: DonationStatus,
  to: DonationStatus,
  actor: Actor,
  method: 'partner_pickup' | 'donor_dropoff' = 'partner_pickup',
) {
  return TRANSITIONS.some(
    (r) => r.to === to && r.from.includes(from) && r.by.includes(actor) && (!r.method || r.method === method),
  )
}

export function nextStatusesFor(from: DonationStatus, actor: Actor, method: 'partner_pickup' | 'donor_dropoff') {
  return TRANSITIONS.filter((r) => r.from.includes(from) && r.by.includes(actor) && (!r.method || r.method === method)).map(
    (r) => r.to,
  )
}

export const isOpen = (s: DonationStatus) => !TERMINAL.includes(s) && s !== 'draft'
