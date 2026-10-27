import { cx } from '../lib/format'

/** KindRoute mark: a route that loops back on itself (care returning) and ends at a destination dot. */
export function LogoMark({ className, light }: { className?: string; light?: boolean }) {
  return (
    <svg viewBox="0 0 40 40" className={cx('h-9 w-9', className)} aria-hidden>
      <rect width="40" height="40" rx="12" fill={light ? '#F8F6F0' : '#173D32'} />
      <path d="M10 28.5c0-6.6 5-9.2 9.4-9.2 4 0 6.6-2.6 6.6-6.4a5.3 5.3 0 0 0-10.6 0" fill="none" stroke={light ? '#173D32' : '#F8F6F0'} strokeWidth="3.2" strokeLinecap="round" />
      <circle cx="29" cy="28.5" r="3.8" fill="#EAA58D" />
    </svg>
  )
}

export function Logo({ className, light }: { className?: string; light?: boolean }) {
  return (
    <span className={cx('inline-flex items-center gap-2.5', className)}>
      <LogoMark light={light} />
      <span className={cx('font-display text-[22px] font-[460] tracking-[-0.03em]', light ? 'text-ivory' : 'text-forest')}>
        Kind<span className="italic font-[380]">Route</span>
      </span>
    </span>
  )
}
