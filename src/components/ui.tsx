import { forwardRef, useEffect, useId, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { Link, type LinkProps } from 'react-router-dom'
import { AlertTriangle, ArrowUpRight, Loader2, X, FlaskConical } from 'lucide-react'
import { cx } from '../lib/format'

type Variant = 'primary' | 'coral' | 'outline' | 'ghost' | 'danger' | 'light'
type Size = 'sm' | 'md' | 'lg'

const variants: Record<Variant, string> = {
  primary: 'bg-forest text-ivory hover:bg-forest-700 shadow-soft',
  coral: 'bg-coral text-forest-900 hover:bg-[#e3957a] shadow-soft',
  outline: 'border border-forest/25 text-forest hover:border-forest hover:bg-white/70',
  ghost: 'text-forest hover:bg-forest/5',
  danger: 'border border-coral-700/30 text-coral-700 hover:bg-coral-100',
  light: 'bg-ivory text-forest hover:bg-white',
}
const sizes: Record<Size, string> = {
  sm: 'h-9 px-4 text-[13px]',
  md: 'h-11 px-5 text-[14px]',
  lg: 'h-14 px-7 text-[15px]',
}

export const btn = (v: Variant = 'primary', s: Size = 'md', extra?: string) =>
  cx(
    'group inline-flex select-none items-center justify-center gap-2 rounded-full font-bold tracking-[-0.01em] transition-all duration-200 active:scale-[.98] disabled:pointer-events-none disabled:opacity-50',
    variants[v],
    sizes[s],
    extra,
  )

interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  loading?: boolean
  icon?: ReactNode
}

export const Button = forwardRef<HTMLButtonElement, BtnProps>(function Button({ variant = 'primary', size = 'md', loading, icon, className, children, disabled, ...rest }, ref) {
  return (
    <button ref={ref} className={btn(variant, size, className)} disabled={disabled || loading} {...rest}>
      {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  )
})

export function LinkButton({ variant = 'primary', size = 'md', className, children, arrow, ...rest }: LinkProps & { variant?: Variant; size?: Size; arrow?: boolean }) {
  return (
    <Link className={btn(variant, size, className)} {...rest}>
      {children}
      {arrow && <ArrowUpRight className="h-4 w-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden />}
    </Link>
  )
}

type Tone = 'neutral' | 'forest' | 'sage' | 'coral' | 'warn' | 'bad' | 'good' | 'waiting' | 'active'
const tones: Record<Tone, string> = {
  neutral: 'bg-ivory-200 text-charcoal-600',
  forest: 'bg-forest text-ivory',
  sage: 'bg-sage-100 text-forest',
  coral: 'bg-coral-100 text-coral-700',
  warn: 'bg-[#FCF1D9] text-[#7A5410]',
  bad: 'bg-coral-100 text-coral-700',
  good: 'bg-sage-200 text-forest-800',
  waiting: 'bg-[#FCF1D9] text-[#7A5410]',
  active: 'bg-sage-100 text-forest',
}
export function Badge({ tone = 'neutral', children, icon, className }: { tone?: Tone; children: ReactNode; icon?: ReactNode; className?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-[11.5px] font-bold', tones[tone], className)}>
      {icon}
      {children}
    </span>
  )
}

export function DemoTag({ className, label = 'Demo data' }: { className?: string; label?: string }) {
  return (
    <span title="Fictional sample record for demonstration. Not a real organisation, person or verification." className={cx('inline-flex items-center gap-1 rounded-full border border-dashed border-coral-600/50 bg-coral-100/60 px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wider text-coral-700', className)}>
      <FlaskConical className="h-3 w-3" aria-hidden />
      {label}
    </span>
  )
}

export function Field({ label, hint, error, children, required, className }: { label: string; hint?: ReactNode; error?: string | null; children: (id: string) => ReactNode; required?: boolean; className?: string }) {
  const id = useId()
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1.5 block text-[13px] font-bold text-forest">
        {label}
        {required && <span className="text-coral-700"> *</span>}
      </label>
      {children(id)}
      {error ? (
        <p className="mt-1.5 flex items-start gap-1 text-[12.5px] font-semibold text-coral-700" role="alert">
          <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
          {error}
        </p>
      ) : hint ? (
        <p className="mt-1.5 text-[12.5px] text-charcoal-500">{hint}</p>
      ) : null}
    </div>
  )
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...p }, ref) {
  return <input ref={ref} className={cx('field', className)} {...p} />
})
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...p }, ref) {
  return <textarea ref={ref} className={cx('field min-h-[96px] resize-y', className)} {...p} />
})
export function Select({ className, children, ...p }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cx('field appearance-none bg-[url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2712%27 height=%2712%27 viewBox=%270 0 24 24%27 fill=%27none%27 stroke=%27%23173D32%27 stroke-width=%272.5%27%3E%3Cpath d=%27m6 9 6 6 6-6%27/%3E%3C/svg%3E")] bg-[right_1rem_center] bg-no-repeat pr-10', className)} {...p}>
      {children}
    </select>
  )
}

export function Checkbox({ checked, onChange, children, id }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode; id?: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 text-[14px] leading-snug text-charcoal-600">
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 cursor-pointer rounded-md border-forest/30 accent-forest" />
      <span>{children}</span>
    </label>
  )
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)} className={cx('relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-50', checked ? 'bg-forest' : 'bg-charcoal-400/40')}>
      <span className={cx('absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all', checked ? 'left-6' : 'left-1')} />
    </button>
  )
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  // Runs only when the modal opens/closes — callers often pass a new onClose every render.
  useEffect(() => {
    if (!open) return
    const prev = document.activeElement as HTMLElement | null
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeRef.current()
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    const t = setTimeout(() => (ref.current?.querySelector<HTMLElement>('input:not([type=hidden]),textarea,select') ?? ref.current?.querySelector<HTMLElement>('button'))?.focus(), 30)
    return () => {
      clearTimeout(t)
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
      prev?.focus()
    }
  }, [open])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-forest-900/40 p-0 backdrop-blur-sm sm:items-center sm:p-6" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={title} className={cx('max-h-[92vh] w-full overflow-y-auto rounded-t-4xl bg-ivory p-6 shadow-lift sm:rounded-4xl sm:p-8', wide ? 'max-w-3xl' : 'max-w-lg')}>
        <div className="mb-5 flex items-start justify-between gap-4">
          <h2 className="font-display text-2xl text-forest">{title}</h2>
          <button onClick={onClose} className="-mr-2 -mt-1 rounded-full p-2 text-charcoal-500 hover:bg-forest/5" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-charcoal-500" role="status">
      <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
      <span className="text-sm font-semibold">{label}</span>
    </div>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('animate-pulse rounded-2xl bg-forest/[.06]', className)} />
}

export function EmptyState({ icon, title, body, action }: { icon?: ReactNode; title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-4xl border border-dashed border-forest/20 bg-white/40 px-6 py-14 text-center">
      {icon && <div className="mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-sage-100 text-forest">{icon}</div>}
      <h3 className="font-display text-xl text-forest">{title}</h3>
      {body && <div className="mt-2 max-w-md text-[14.5px] text-charcoal-500">{body}</div>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  )
}

export function ErrorState({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  return (
    <div className="rounded-3xl border border-coral-600/25 bg-coral-100/50 p-6" role="alert">
      <p className="flex items-center gap-2 font-bold text-coral-700">
        <AlertTriangle className="h-4 w-4" /> {error.message}
      </p>
      {onRetry && (
        <Button variant="outline" size="sm" className="mt-4" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  )
}

export function Notice({ tone = 'info', title, children, icon }: { tone?: 'info' | 'warn' | 'bad' | 'good'; title?: string; children: ReactNode; icon?: ReactNode }) {
  const t = { info: 'bg-sage-100/70 border-sage-600/30 text-forest', warn: 'bg-[#FCF1D9] border-[#E7C77A] text-[#5E410C]', bad: 'bg-coral-100 border-coral-600/30 text-coral-700', good: 'bg-sage-200/70 border-sage-600/40 text-forest-800' }[tone]
  return (
    <div className={cx('flex gap-3 rounded-2xl border p-4 text-[13.5px] leading-relaxed', t)}>
      {icon && <div className="mt-0.5 shrink-0">{icon}</div>}
      <div>
        {title && <p className="font-bold">{title}</p>}
        <div className={title ? 'mt-0.5 opacity-90' : ''}>{children}</div>
      </div>
    </div>
  )
}

export function SectionHead({ index, eyebrow, title, body, className, align = 'left' }: { index?: string; eyebrow: string; title: ReactNode; body?: ReactNode; className?: string; align?: 'left' | 'center' }) {
  return (
    <div className={cx(align === 'center' && 'mx-auto max-w-3xl text-center', className)}>
      <p className="eyebrow flex items-center gap-3" style={align === 'center' ? { justifyContent: 'center' } : undefined}>
        {index && <span className="font-display text-[13px] normal-case tracking-normal text-coral-700">{index}</span>}
        {index && <span className="h-px w-8 bg-forest/25" />}
        {eyebrow}
      </p>
      <h2 className="display-lg mt-4 text-balance text-forest">{title}</h2>
      {body && <p className="mt-5 max-w-2xl text-[17px] leading-relaxed text-charcoal-600" style={align === 'center' ? { marginInline: 'auto' } : undefined}>{body}</p>}
    </div>
  )
}

export function Tabs<T extends string>({ value, onChange, tabs }: { value: T; onChange: (v: T) => void; tabs: Array<{ id: T; label: string; count?: number }> }) {
  return (
    <div role="tablist" className="scrollbar-none -mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} onClick={() => onChange(t.id)} className={cx('chip shrink-0', value === t.id && 'chip-on')}>
          {t.label}
          {t.count != null && t.count > 0 && <span className={cx('rounded-full px-1.5 text-[11px]', value === t.id ? 'bg-ivory/20' : 'bg-forest/10')}>{t.count}</span>}
        </button>
      ))}
    </div>
  )
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="card p-5">
      <p className="text-[12px] font-bold uppercase tracking-wider text-charcoal-500">{label}</p>
      <p className="mt-2 font-display text-4xl text-forest">{value}</p>
      {sub && <p className="mt-1 text-[12.5px] text-charcoal-500">{sub}</p>}
    </div>
  )
}
