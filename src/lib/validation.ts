import type { DonationItemInput, OrgItemPolicy, Organization } from './types'
import { CONDITIONS, categoryById } from '../data/categories'

// Items the platform never accepts, regardless of organisation policy.
const BLOCKED_TERMS: Array<[RegExp, string]> = [
  [/\b(medicines?|tablets?|capsules?|syrups?|injections?|insulin|antibiotics?|prescription|ointments?|painkillers?)\b/i, 'Medicines cannot be donated through KindRoute.'],
  [/\b(alcohol|liquor|beer|wine|whisky|cigarettes?|tobacco|gutkha|vapes?|e-?cigarettes?)\b/i, 'Alcohol and tobacco products are not accepted.'],
  [/\b(firecrackers?|crackers|gas cylinders?|lpg|kerosene|petrol|diesel|pesticides?|acid|explosives?)\b/i, 'Hazardous or flammable products are not accepted.'],
  [/\b(knife|knives|weapons?|guns?|air ?guns?)\b/i, 'Weapons and sharp tools are not accepted.'],
]

export const MAX_QTY = 1000
export const FLAG_QTY = 300

export function blockedReason(text: string): string | null {
  for (const [re, msg] of BLOCKED_TERMS) if (re.test(text)) return msg
  return null
}

const DAY = 86_400_000
const HOUR = 3_600_000

export function daysUntil(dateIso: string, now = new Date()) {
  const end = new Date(dateIso + (dateIso.length === 10 ? 'T23:59:59' : ''))
  return Math.floor((end.getTime() - now.getTime()) / DAY)
}

/** Generic, organisation-independent safety checks. Returns human-readable problems. */
export function validateItem(item: DonationItemInput, now = new Date()): string[] {
  const p: string[] = []
  const name = item.name.trim()
  if (name.length < 2) p.push('Give the item a short name.')
  if (name.length > 80) p.push('Item name is too long (80 characters max).')
  if (!Number.isInteger(item.quantity) || item.quantity < 1) p.push('Quantity must be a whole number of at least 1.')
  if (item.quantity > MAX_QTY) p.push(`Quantity above ${MAX_QTY} needs to be arranged with the organisation directly.`)
  const blocked = blockedReason(`${name} ${item.description ?? ''}`)
  if (blocked) p.push(blocked)

  if (item.categoryId === 'clothes' && /\b(innerwear|underwear|undergarments?|bras?|briefs)\b/i.test(name) && item.condition !== 'new')
    p.push('Innerwear can only be donated new and unused.')
  if (item.categoryId === 'toys' && item.condition === 'needs_repair') p.push('Toys must be complete, clean and safe — no broken toys.')

  if (item.categoryId === 'packaged_food') {
    const f = item.food
    if (!f || f.kind !== 'packaged') p.push('Add packaging details for packaged food.')
    else {
      if (!f.expiryDate) p.push('Packaged food needs an expiry / best-before date.')
      else if (daysUntil(f.expiryDate, now) < 0) p.push('This food is past its expiry date and cannot be donated.')
      if (!f.sealed) p.push('Packaged food must be sealed and unopened.')
    }
  }
  if (item.categoryId === 'fresh_food') {
    const f = item.food
    if (!f || f.kind !== 'fresh') p.push('Add preparation details for fresh food.')
    else if (!f.preparedAt) p.push('Fresh food needs a preparation / harvest time.')
    else {
      const t = new Date(f.preparedAt).getTime()
      if (t > now.getTime() + 15 * 60_000) p.push('Preparation time cannot be in the future.')
      else if (now.getTime() - t > 24 * HOUR) p.push('Fresh food prepared more than 24 hours ago cannot be donated.')
    }
  }
  return p
}

/** Checks an item against a specific organisation's acceptance policy. */
export function checkAgainstPolicy(
  item: DonationItemInput,
  org: Pick<Organization, 'name'>,
  policy: OrgItemPolicy | undefined,
  now = new Date(),
): string[] {
  const cat = categoryById(item.categoryId)
  if (policy?.acceptance === 'temporarily_unavailable') return [`${org.name} is temporarily not accepting ${cat.label.toLowerCase()}.`]
  if (!policy || policy.acceptance !== 'accepts') return [`${org.name} does not accept ${cat.label.toLowerCase()}.`]
  const p: string[] = []
  if (policy.conditionsAccepted.length && !policy.conditionsAccepted.includes(item.condition))
    p.push(
      `${org.name} accepts ${cat.short.toLowerCase()} only in condition: ${policy.conditionsAccepted
        .map((c) => CONDITIONS[c].toLowerCase())
        .join(', ')}.`,
    )
  if (policy.quantityLimit != null && item.quantity > policy.quantityLimit) p.push(`${org.name} accepts at most ${policy.quantityLimit} per request for ${cat.short.toLowerCase()}.`)
  if (item.categoryId === 'packaged_food' && item.food?.expiryDate && policy.minShelfLifeDays != null) {
    const d = daysUntil(item.food.expiryDate, now)
    if (d < policy.minShelfLifeDays) p.push(`${org.name} needs at least ${policy.minShelfLifeDays} days of shelf life left (this has ${Math.max(d, 0)}).`)
  }
  if (item.categoryId === 'fresh_food' && item.food?.preparedAt && policy.maxHoursSincePrep != null) {
    const h = (now.getTime() - new Date(item.food.preparedAt).getTime()) / HOUR
    if (h > policy.maxHoursSincePrep) p.push(`${org.name} accepts fresh food only within ${policy.maxHoursSincePrep} hours of preparation.`)
  }
  return p
}

/** Normalises Indian mobile numbers to +91XXXXXXXXXX. Demo builds also accept 00000xxxxx test numbers. */
export function normalizePhone(input: string, allowDemo = false): string | null {
  const digits = input.replace(/\D/g, '')
  const local = digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits.length === 11 && digits.startsWith('0') && !digits.startsWith('00000') ? digits.slice(1) : digits
  if (/^[6-9]\d{9}$/.test(local)) return `+91${local}`
  if (allowDemo && /^00000\d{5}$/.test(local)) return `+91${local}`
  return null
}

/** Same rule as the Supabase Auth password policy documented in the README (min 8, letters + digits). */
export function passwordProblem(pw: string): string | null {
  if (pw.length < 8) return 'Use at least 8 characters.'
  if (pw.length > 72) return 'Use at most 72 characters.'
  if (!/[a-z]/i.test(pw) || !/\d/.test(pw)) return 'Use a mix of letters and numbers.'
  return null
}

/** Mirrors the Supabase Storage bucket limits in migration 4 (allowed MIME types + size). */
export const UPLOAD_RULES = {
  document: { types: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'], max: 5 * 1024 * 1024, label: 'PDF, JPG, PNG or WebP' },
  image: { types: ['image/jpeg', 'image/png', 'image/webp'], max: 2 * 1024 * 1024, label: 'JPG, PNG or WebP' },
} as const

export function fileProblem(file: { type: string; size: number }, kind: keyof typeof UPLOAD_RULES, maxBytes: number = UPLOAD_RULES[kind].max): string | null {
  const rule = UPLOAD_RULES[kind]
  if (!(rule.types as readonly string[]).includes(file.type)) return `Upload a ${rule.label} file.`
  if (file.size > maxBytes) return `File is too large (max ${Math.round(maxBytes / 1024 / 102.4) / 10} MB).`
  return null
}

export const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s.trim())

export function maskPhone(p: string) {
  return p.length > 6 ? `${p.slice(0, 3)} ••••• ${p.slice(-3)}` : '•••'
}

export const firstName = (full: string) => full.trim().split(/\s+/)[0] || 'Donor'
