import type { CategoryId } from './types'
import { categoryById } from '../data/categories'

/** YYYY-MM-DD in the user's local timezone (not UTC). */
export function localDateIso(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000)

export function formatDate(iso: string, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }) {
  return new Date(iso.length === 10 ? iso + 'T00:00:00' : iso).toLocaleDateString('en-IN', opts)
}

export function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
}

export function timeAgo(iso: string, now = Date.now()) {
  const s = Math.round((now - new Date(iso).getTime()) / 1000)
  if (s < 45) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} h ago`
  const d = Math.round(h / 24)
  if (d < 31) return `${d} day${d === 1 ? '' : 's'} ago`
  return formatDate(iso)
}

export const catLabel = (id: CategoryId) => categoryById(id).short

export const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`

export function cx(...c: Array<string | false | null | undefined>) {
  return c.filter(Boolean).join(' ')
}
