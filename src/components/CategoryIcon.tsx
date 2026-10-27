import { Accessibility, Armchair, BedDouble, BookOpen, Boxes, Droplets, Package, Puzzle, Shirt, Soup, type LucideIcon } from 'lucide-react'
import type { CategoryId } from '../lib/types'

export const CATEGORY_ICONS: Record<CategoryId, LucideIcon> = {
  books: BookOpen,
  clothes: Shirt,
  packaged_food: Package,
  fresh_food: Soup,
  bedding: BedDouble,
  toys: Puzzle,
  hygiene: Droplets,
  furniture: Armchair,
  medical: Accessibility,
  other: Boxes,
}

/** Soft palette per category, used for icon tiles and 3D objects. */
export const CATEGORY_TINT: Record<CategoryId, { bg: string; fg: string; hex: string }> = {
  books: { bg: 'bg-sage-100', fg: 'text-forest', hex: '#2E6152' },
  clothes: { bg: 'bg-coral-100', fg: 'text-coral-700', hex: '#EAA58D' },
  packaged_food: { bg: 'bg-[#F6EBD6]', fg: 'text-[#7A5410]', hex: '#D8B27A' },
  fresh_food: { bg: 'bg-[#EAF0DA]', fg: 'text-[#4E6B22]', hex: '#9DB86A' },
  bedding: { bg: 'bg-[#E9E6F2]', fg: 'text-[#4B4473]', hex: '#9C94C4' },
  toys: { bg: 'bg-[#FBE3D2]', fg: 'text-[#9A4B1E]', hex: '#E89A62' },
  hygiene: { bg: 'bg-[#DDEEF0]', fg: 'text-[#1E5E66]', hex: '#7FB6BC' },
  furniture: { bg: 'bg-[#EFE5DA]', fg: 'text-[#6B4A2B]', hex: '#B08A64' },
  medical: { bg: 'bg-[#E3ECF7]', fg: 'text-[#2D4E7A]', hex: '#8AA6CC' },
  other: { bg: 'bg-ivory-200', fg: 'text-charcoal-600', hex: '#B7CDB5' },
}

export function CategoryIcon({ id, className = 'h-5 w-5' }: { id: CategoryId; className?: string }) {
  const I = CATEGORY_ICONS[id]
  return <I className={className} aria-hidden strokeWidth={1.75} />
}
