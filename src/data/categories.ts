import type { Category, CategoryId, OrgType, Unit, Condition, Vehicle } from '../lib/types'

export const CATEGORIES: Category[] = [
  { id: 'books', label: 'Books & stationery', short: 'Books', blurb: 'Textbooks, storybooks, notebooks, school bags', defaultUnit: 'pieces', active: true, sort: 1 },
  { id: 'clothes', label: 'Clothes & footwear', short: 'Clothes', blurb: 'Clean, wearable clothing, winter wear, shoes', defaultUnit: 'pieces', active: true, sort: 2 },
  { id: 'packaged_food', label: 'Packaged food', short: 'Packaged food', blurb: 'Sealed staples and packets within expiry', defaultUnit: 'kg', active: true, sort: 3 },
  { id: 'fresh_food', label: 'Fresh food', short: 'Fresh food', blurb: 'Freshly cooked meals, fruit and vegetables', defaultUnit: 'meals', restricted: true, active: true, sort: 4 },
  { id: 'bedding', label: 'Blankets & bedding', short: 'Blankets', blurb: 'Blankets, bedsheets, pillows, mats', defaultUnit: 'pieces', active: true, sort: 5 },
  { id: 'toys', label: 'Toys & games', short: 'Toys', blurb: 'Safe, complete toys, puzzles, sports gear', defaultUnit: 'pieces', active: true, sort: 6 },
  { id: 'hygiene', label: 'Hygiene essentials', short: 'Hygiene', blurb: 'Soap, sanitary pads, toothpaste, adult diapers', defaultUnit: 'pieces', active: true, sort: 7 },
  { id: 'furniture', label: 'Furniture', short: 'Furniture', blurb: 'Study tables, chairs, shelves, cots', defaultUnit: 'pieces', active: true, sort: 8 },
  { id: 'medical', label: 'Medical & mobility supplies', short: 'Mobility aids', blurb: 'Walkers, wheelchairs, first-aid kits — never medicines', defaultUnit: 'pieces', restricted: true, active: true, sort: 9 },
  { id: 'other', label: 'Other useful items', short: 'Other', blurb: 'Utensils, bags, small appliances in working order', defaultUnit: 'pieces', active: true, sort: 10 },
]

export const categoryById = (id: CategoryId) => CATEGORIES.find((c) => c.id === id)!

export const ORG_TYPES: Record<OrgType, string> = {
  children_home: "Children's home",
  orphanage: 'Orphanage',
  old_age_home: 'Old-age home',
  shelter: 'Shelter',
  ngo: 'NGO',
  community_kitchen: 'Community kitchen',
  food_bank: 'Food distribution',
  special_needs: 'Special-needs care',
  other: 'Care organisation',
}

export const UNITS: Record<Unit, string> = {
  pieces: 'pieces',
  sets: 'sets',
  pairs: 'pairs',
  bags: 'bags',
  boxes: 'boxes',
  kg: 'kg',
  litres: 'litres',
  meals: 'meals',
}

export const CONDITIONS: Record<Condition, string> = {
  new: 'New / unused',
  like_new: 'Like new',
  gently_used: 'Gently used',
  needs_repair: 'Needs minor repair',
}

export const VEHICLES: Record<Vehicle, string> = {
  bicycle: 'Bicycle',
  two_wheeler: 'Two-wheeler',
  three_wheeler: 'Three-wheeler / auto',
  car: 'Car',
  van: 'Van / tempo',
}

export const PICKUP_SLOTS = ['09:00 – 12:00', '12:00 – 15:00', '15:00 – 18:00', '18:00 – 20:00']

/** Delivery fees are not configured in this build. Set to an object to enable. */
export const DELIVERY_FEE_CONFIG: null | { baseInr: number; perKmInr: number; freeUnderKm: number } = null
