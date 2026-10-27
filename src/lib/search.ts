import type { CategoryId, OrgItemPolicy, OrgNeed, OrgType, PublicOrganization, Urgency } from './types'
import { LOCALITIES, distanceKm, localityByName } from '../data/localities'
import { CATEGORIES, ORG_TYPES } from '../data/categories'

/* ---------------- query understanding ---------------- */

const CATEGORY_WORDS: Record<string, CategoryId[]> = {}
const add = (cats: CategoryId[], words: string) => words.split(',').forEach((w) => (CATEGORY_WORDS[w.trim()] = cats))

add(['books'], 'book,textbook,novel,storybook,notebook,stationery,pen,pencil,school bag,schoolbag,crayon,geometry box,comic,library')
add(['clothes'], 'cloth,clothes,clothing,shirt,tshirt,t-shirt,saree,sari,kurta,jacket,sweater,shoe,footwear,sandal,chappal,uniform,dress,garment,woollen,winter wear,trouser,jeans,shawl,raincoat')
add(['packaged_food', 'fresh_food'], 'food,eatable')
add(['packaged_food'], 'packet,food packet,rice,dal,atta,flour,grain,ration,grocery,groceries,oil,biscuit,snack,staple,pulses,sugar,tea,milk powder,cereal')
add(['fresh_food'], 'meal,cooked,cooked food,tiffin,fruit,vegetable,veggie,fresh food,leftover')
add(['bedding'], 'blanket,bedding,bedsheet,bed sheet,sheet,pillow,mattress,quilt,razai,mat,duvet,comforter')
add(['toys'], 'toy,game,board game,puzzle,doll,sport,ball,cricket,football,lego,block')
add(['hygiene'], 'hygiene,soap,sanitary,pad,sanitary pad,toothpaste,toothbrush,shampoo,diaper,adult diaper,sanitizer,detergent,hygiene kit,kit,towel')
add(['furniture'], 'furniture,table,chair,desk,shelf,shelves,cupboard,almirah,cot,bench,study table')
add(['medical'], 'wheelchair,walker,crutch,crutches,first aid,first-aid,mobility,commode,walking stick,mobility aid')
add(['other'], 'utensil,vessel,bucket,fan,appliance,steel,plate,water bottle,lunchbox,lunch box')

const TAG_WORDS: Record<string, string> = {
  winter: 'winter', woollen: 'winter', warm: 'winter', sweater: 'winter', jacket: 'winter', thermal: 'winter', shawl: 'winter',
  kid: 'kids', kids: 'kids', child: 'kids', children: 'kids', school: 'school', textbook: 'school', 'school bag': 'school bag', schoolbag: 'school bag',
  women: 'women', woman: 'women', ladies: 'women', saree: 'women', sari: 'women', men: 'men', elderly: 'elderly', senior: 'elderly',
  'sanitary pad': 'women', 'adult diaper': 'elderly', rice: 'staples', dal: 'staples', atta: 'staples', ration: 'staples',
}

const ORG_TYPE_WORDS: Record<string, OrgType> = {
  orphanage: 'children_home', "children's home": 'children_home', 'childrens home': 'children_home', 'children home': 'children_home', 'child care': 'children_home', balgram: 'children_home',
  'old age': 'old_age_home', 'old-age': 'old_age_home', 'old age home': 'old_age_home', 'old-age home': 'old_age_home', elderly: 'old_age_home', elder: 'old_age_home', senior: 'old_age_home', vruddhashram: 'old_age_home', 'senior citizen': 'old_age_home',
  shelter: 'shelter', 'night shelter': 'shelter',
  ngo: 'ngo', foundation: 'ngo', trust: 'ngo',
  kitchen: 'community_kitchen', 'community kitchen': 'community_kitchen', 'food bank': 'food_bank',
  'special needs': 'special_needs', disabled: 'special_needs', disability: 'special_needs',
}

const STOP = new Set(
  'near,in,at,for,needing,need,needs,needed,who,that,which,with,the,a,an,to,of,and,or,home,homes,organisation,organisations,organization,organizations,org,orgs,donate,donation,i,want,my,some,old,new,used,around,pune,me,please,any,accept,accepting,accepts,from,area,give,can,where,is,are,what,item,items,stuff,things'.split(','),
)

export interface ParsedQuery {
  categories: CategoryId[]
  tags: string[]
  orgTypes: OrgType[]
  localities: string[]
  residual: string[]
  raw: string
}

const forms = (w: string) => {
  const f = [w]
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) f.push(w.slice(0, -1))
  if (w.length > 4 && w.endsWith('es')) f.push(w.slice(0, -2))
  return f
}
const lookup = <T,>(dict: Record<string, T>, w: string): T | undefined => {
  for (const f of forms(w)) if (dict[f] !== undefined) return dict[f]
  return undefined
}

export function parseQuery(raw: string): ParsedQuery {
  let q = ` ${raw.toLowerCase().replace(/[’`]/g, "'").replace(/[^a-z0-9' -]/g, ' ').replace(/\s+/g, ' ')} `
  const cats = new Set<CategoryId>()
  const tags = new Set<string>()
  const types = new Set<OrgType>()
  const locs = new Set<string>()

  const take = (phrase: string) => {
    const re = new RegExp(`\\s${phrase.replace(/[-']/g, (m) => '\\' + m)}(s|es)?(?=\\s)`)
    if (re.test(q)) {
      q = q.replace(re, ' ')
      return true
    }
    return false
  }

  // localities first (multiword names), then multiword org types and category phrases
  for (const l of LOCALITIES) for (const n of [l.name.toLowerCase(), ...(l.aliases ?? [])]) if (take(n)) locs.add(l.name)
  const multi = [...Object.keys(ORG_TYPE_WORDS), ...Object.keys(CATEGORY_WORDS)].filter((k) => /[ -]/.test(k)).sort((a, b) => b.length - a.length)
  for (const phrase of multi) {
    if (take(phrase)) {
      if (ORG_TYPE_WORDS[phrase]) types.add(ORG_TYPE_WORDS[phrase])
      CATEGORY_WORDS[phrase]?.forEach((c) => cats.add(c))
      if (TAG_WORDS[phrase]) tags.add(TAG_WORDS[phrase])
    }
  }
  const residual: string[] = []
  for (const tok of q.trim().split(' ').filter(Boolean)) {
    let used = false
    const tag = lookup(TAG_WORDS, tok)
    if (tag) {
      tags.add(tag)
      used = true
    }
    const orgType = lookup(ORG_TYPE_WORDS, tok)
    if (orgType) {
      types.add(orgType)
      used = true
    }
    const c = lookup(CATEGORY_WORDS, tok)
    if (c) {
      c.forEach((x) => cats.add(x))
      used = true
    }
    if (!used && !STOP.has(tok) && tok.length > 1) residual.push(tok)
  }
  return { categories: [...cats], tags: [...tags], orgTypes: [...types], localities: [...locs], residual, raw }
}

/* ---------------- ranking ---------------- */

export type SortKey = 'relevance' | 'distance' | 'urgency'

export interface SearchParams {
  q?: string
  categories?: CategoryId[]
  localities?: string[]
  orgTypes?: OrgType[]
  needsOnly?: boolean
  pickupOnly?: boolean
  verifiedOnly?: boolean
  sort?: SortKey
  /** reliable origin: device geolocation or a chosen locality centroid */
  origin?: { lat: number; lng: number; label: string; precise: boolean }
  now?: Date
}

/** How an organisation stands for one item category — shown on cards and profiles. */
export type Standing = 'currently_needed' | 'generally_accepted' | 'temporarily_unavailable' | 'not_accepted'

export const STANDING_LABEL: Record<Standing, string> = {
  currently_needed: 'Currently needed',
  generally_accepted: 'Generally accepted',
  temporarily_unavailable: 'Temporarily unavailable',
  not_accepted: 'Not accepted',
}

export interface SearchResult {
  org: PublicOrganization
  /** open needs confirmed within the freshness window that match the searched categories */
  matchedNeeds: OrgNeed[]
  acceptedMatches: CategoryId[]
  standing: Partial<Record<CategoryId, Standing>>
  score: number
  reasons: string[]
  distanceKm?: number
  /** only set from current (fresh, open) needs — never inferred */
  topUrgency?: Urgency
}

const URG: Record<Urgency, number> = { high: 3, medium: 2, low: 1 }
export const NEAR_KM = 8
/** A need counts as "current" only if the organisation confirmed it within this many days. Server: app_settings.need_freshness_days. */
export const NEED_FRESHNESS_DAYS = 30

export function isVerificationCurrent(org: Pick<PublicOrganization, 'status' | 'nextReviewDue'>, now = new Date()) {
  return org.status === 'approved' && (!org.nextReviewDue || new Date(org.nextReviewDue) >= now)
}

export function needIsStale(n: Pick<OrgNeed, 'lastConfirmedAt'>, now = new Date(), days = NEED_FRESHNESS_DAYS) {
  return now.getTime() - new Date(n.lastConfirmedAt).getTime() > days * 86_400_000
}
export const needIsCurrent = (n: OrgNeed, now = new Date(), days = NEED_FRESHNESS_DAYS) => n.status === 'open' && !needIsStale(n, now, days)
export const policyAccepts = (p?: Pick<OrgItemPolicy, 'acceptance'>) => p?.acceptance === 'accepts'

export function categoryStanding(org: Pick<PublicOrganization, 'policies' | 'needs'>, cat: CategoryId, now = new Date(), days = NEED_FRESHNESS_DAYS): Standing {
  const p = org.policies.find((x) => x.categoryId === cat)
  if (!p || p.acceptance === 'does_not_accept') return 'not_accepted'
  if (p.acceptance === 'temporarily_unavailable') return 'temporarily_unavailable'
  return org.needs.some((n) => n.categoryId === cat && needIsCurrent(n, now, days)) ? 'currently_needed' : 'generally_accepted'
}

/** Structured interpretation of a search — evaluated in the browser (demo) or by the search_organizations RPC (Supabase). */
export interface SearchPlan {
  parsed: ParsedQuery
  wantCats: CategoryId[]
  wantTypes: OrgType[]
  strictLocs: string[]
  /** locality mentioned in the text query — results are limited to it or within NEAR_KM of it */
  near?: { name: string; lat: number; lng: number }
  origin?: { lat: number; lng: number; label: string; precise: boolean }
  conflict: boolean
  needsOnly: boolean
  pickupOnly: boolean
  verifiedOnly: boolean
  sort: SortKey
  freshnessDays: number
}

/** "Orphanage" and "children's home" are used interchangeably in Pune — searching either finds both. */
const expandTypes = (t: OrgType[]) => {
  const set = new Set(t)
  if (set.has('orphanage') || set.has('children_home')) set.add('orphanage').add('children_home')
  return [...set]
}

export function planSearch(params: SearchParams, freshnessDays = NEED_FRESHNESS_DAYS): SearchPlan {
  const parsed = parseQuery(params.q ?? '')
  const filterCats = params.categories ?? []
  let wantCats: CategoryId[]
  if (filterCats.length && parsed.categories.length) wantCats = filterCats.filter((c) => parsed.categories.includes(c))
  else wantCats = filterCats.length ? filterCats : parsed.categories
  const conflict = filterCats.length > 0 && parsed.categories.length > 0 && wantCats.length === 0
  const nearLoc = parsed.localities.length ? localityByName(parsed.localities[0]) : undefined
  return {
    parsed,
    wantCats,
    conflict,
    wantTypes: expandTypes([...(params.orgTypes ?? []), ...parsed.orgTypes]),
    strictLocs: params.localities ?? [],
    near: nearLoc && !params.origin ? { name: nearLoc.name, lat: nearLoc.lat, lng: nearLoc.lng } : undefined,
    origin: params.origin ?? (nearLoc ? { lat: nearLoc.lat, lng: nearLoc.lng, label: nearLoc.name, precise: false } : undefined),
    needsOnly: !!params.needsOnly,
    pickupOnly: !!params.pickupOnly,
    verifiedOnly: !!params.verifiedOnly,
    sort: params.sort ?? 'relevance',
    freshnessDays,
  }
}

/** Returns null when the organisation is not an eligible match for the plan. */
export function evaluateOrg(org: PublicOrganization, plan: SearchPlan, now = new Date()): SearchResult | null {
  const { parsed, wantCats, wantTypes } = plan
  if (plan.conflict || org.status !== 'approved') return null
  if (wantTypes.length && !wantTypes.includes(org.type)) return null
  if (plan.strictLocs.length && !plan.strictLocs.includes(org.locality)) return null
  if (plan.pickupOnly && !org.deliveryMethods.includes('partner_pickup')) return null
  if (plan.verifiedOnly && !isVerificationCurrent(org, now)) return null

  const dist = plan.origin ? distanceKm(plan.origin, org) : undefined
  if (plan.near && org.locality !== plan.near.name && distanceKm(plan.near, org) > NEAR_KM) return null

  const acceptedCats = org.policies.filter(policyAccepts).map((p) => p.categoryId)
  const currentNeeds = org.needs.filter((n) => needIsCurrent(n, now, plan.freshnessDays) && acceptedCats.includes(n.categoryId))
  const matchedNeeds = wantCats.length ? currentNeeds.filter((n) => wantCats.includes(n.categoryId)) : currentNeeds
  const acceptedMatches = wantCats.filter((c) => acceptedCats.includes(c))

  if (wantCats.length && !acceptedMatches.length) return null
  if (plan.needsOnly && !matchedNeeds.length) return null

  const hay = `${org.name} ${org.intro} ${org.needs.filter((n) => n.status === 'open').map((n) => `${n.title} ${n.tags.join(' ')}`).join(' ')}`.toLowerCase()
  const residualHits = parsed.residual.filter((r) => hay.includes(r))
  const noStructured = !wantCats.length && !wantTypes.length && !parsed.localities.length && !parsed.tags.length
  if (noStructured && parsed.residual.length && !residualHits.length) return null

  const reasons: string[] = []
  let score = 0
  const tagged = parsed.tags.length ? matchedNeeds.filter((n) => parsed.tags.some((t) => n.tags.includes(t) || n.title.toLowerCase().includes(t))) : []
  if (wantCats.length && matchedNeeds.length) {
    score += 50
    reasons.push(`Currently needs ${matchedNeeds.map((n) => n.title.toLowerCase()).slice(0, 2).join(', ')}`)
  } else if (acceptedMatches.length) {
    score += 20
    reasons.push(`Generally accepts ${acceptedMatches.map((c) => CATEGORIES.find((x) => x.id === c)!.short.toLowerCase()).join(', ')}`)
  }
  if (tagged.length) score += 20
  if (parsed.tags.length && wantCats.length === 0 && !tagged.length && currentNeeds.some((n) => parsed.tags.some((t) => n.tags.includes(t)))) score += 20
  const top = matchedNeeds.reduce<Urgency | undefined>((m, n) => (!m || URG[n.urgency] > URG[m] ? n.urgency : m), undefined)
  if (top) score += URG[top] * 10
  if (isVerificationCurrent(org, now)) score += 5
  if (residualHits.length) score += 10 * residualHits.length
  if (wantTypes.includes(org.type)) reasons.push(ORG_TYPES[org.type])
  if (dist != null) score -= Math.min(dist, 20) * 0.5

  const standing: SearchResult['standing'] = {}
  for (const c of wantCats) standing[c] = categoryStanding(org, c, now, plan.freshnessDays)
  return { org, matchedNeeds, acceptedMatches, standing, score, reasons, distanceKm: dist, topUrgency: top }
}

export function sortResults(results: SearchResult[], sort: SortKey) {
  return results.sort((a, b) => {
    if (sort === 'distance' && a.distanceKm != null && b.distanceKm != null) return a.distanceKm - b.distanceKm
    if (sort === 'urgency') {
      const d = (b.topUrgency ? URG[b.topUrgency] : 0) - (a.topUrgency ? URG[a.topUrgency] : 0)
      if (d) return d
    }
    return b.score - a.score || a.org.name.localeCompare(b.org.name)
  })
}

export interface SearchPage {
  results: SearchResult[]
  total: number
  hasMore: boolean
  parsed: ParsedQuery
  wantCats: CategoryId[]
  conflict: boolean
  origin?: SearchPlan['origin']
  distanceSortAvailable: boolean
}

export const pageFromPlan = (plan: SearchPlan, results: SearchResult[], total: number, offset: number): SearchPage => ({
  results, total, hasMore: offset + results.length < total, parsed: plan.parsed, wantCats: plan.wantCats, conflict: plan.conflict, origin: plan.origin, distanceSortAvailable: !!plan.origin,
})

export function searchOrganizations(orgs: PublicOrganization[], params: SearchParams, page = { offset: 0, limit: Infinity }): SearchPage {
  const now = params.now ?? new Date()
  const plan = planSearch(params)
  const all = sortResults(orgs.map((o) => evaluateOrg(o, plan, now)).filter((r): r is SearchResult => !!r), plan.sort)
  return pageFromPlan(plan, all.slice(page.offset, page.offset + page.limit), all.length, page.offset)
}

/* ---------------- suggestions ---------------- */

export interface Suggestion {
  label: string
  hint: string
  kind: 'category' | 'locality' | 'orgType' | 'query' | 'org'
  value: string
}

const SAMPLE_QUERIES = [
  'Books', 'Winter clothes', 'Food packets', 'Blankets', 'School bags', 'Toys', 'Hygiene kits',
  'Old-age homes needing clothes', 'Orphanages needing books', 'Organisations near Kothrud', 'Wheelchair', 'Cooked meals',
]

export function suggest(input: string, orgNames: { name: string; slug: string }[] = [], limit = 7): Suggestion[] {
  const q = input.trim().toLowerCase()
  if (!q) return SAMPLE_QUERIES.slice(0, 6).map((s) => ({ label: s, hint: 'Popular search', kind: 'query', value: s }))
  const out: Suggestion[] = []
  const seen = new Set<string>()
  const push = (s: Suggestion) => {
    if (!seen.has(s.label.toLowerCase())) {
      seen.add(s.label.toLowerCase())
      out.push(s)
    }
  }
  for (const c of CATEGORIES) if (c.label.toLowerCase().includes(q) || c.short.toLowerCase().startsWith(q)) push({ label: c.label, hint: 'Category', kind: 'category', value: c.id })
  for (const s of SAMPLE_QUERIES) if (s.toLowerCase().includes(q)) push({ label: s, hint: 'Search', kind: 'query', value: s })
  for (const w of Object.keys(CATEGORY_WORDS)) if (w.startsWith(q) && w.length > 2) push({ label: w[0].toUpperCase() + w.slice(1), hint: CATEGORIES.find((c) => c.id === CATEGORY_WORDS[w][0])!.label, kind: 'query', value: w })
  for (const l of LOCALITIES) if (l.name.toLowerCase().startsWith(q)) push({ label: `Near ${l.name}`, hint: 'Pune locality', kind: 'locality', value: l.name })
  for (const [w, t] of Object.entries(ORG_TYPE_WORDS)) if (w.startsWith(q)) push({ label: ORG_TYPES[t], hint: 'Organisation type', kind: 'orgType', value: t })
  for (const o of orgNames) if (o.name.toLowerCase().includes(q)) push({ label: o.name, hint: 'Organisation', kind: 'org', value: o.slug })
  return out.slice(0, limit)
}
