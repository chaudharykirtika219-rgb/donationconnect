import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { Bell, ChevronDown, LayoutDashboard, LogOut, Menu, Search, Shield, Truck, Building2, X, User } from 'lucide-react'
import { Logo } from './Logo'
import { btn } from './ui'
import { useData, useSession, useBackend } from '../state/app'
import { cx, timeAgo } from '../lib/format'

const LINKS = [
  { to: '/explore', label: 'Explore Needs' },
  { to: '/donate', label: 'Donate Items' },
  { to: '/how-it-works', label: 'How It Works' },
  { to: '/for-organizations', label: 'For Organisations' },
  { to: '/become-a-partner', label: 'Become a Delivery Partner' },
]

export function Nav() {
  const [scrolled, setScrolled] = useState(false)
  const [open, setOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [q, setQ] = useState('')
  const loc = useLocation()
  const nav = useNavigate()
  const searchRef = useRef<HTMLInputElement>(null)
  const { session } = useSession()

  useEffect(() => {
    const f = () => setScrolled(window.scrollY > 24)
    f()
    window.addEventListener('scroll', f, { passive: true })
    return () => window.removeEventListener('scroll', f)
  }, [])
  useEffect(() => {
    setOpen(false)
    setSearchOpen(false)
  }, [loc.pathname])
  useEffect(() => {
    if (searchOpen) searchRef.current?.focus()
  }, [searchOpen])
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : ''
  }, [open])

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!q.trim()) return
    nav(`/explore?q=${encodeURIComponent(q.trim())}`)
    setQ('')
  }

  return (
    <header className={cx('sticky top-0 z-50 transition-all duration-300', scrolled || open ? 'glass border-x-0 border-t-0 border-b-forest/10 shadow-[0_1px_0_rgba(23,61,50,.04)]' : 'border-b border-transparent bg-transparent')}>
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:rounded-full focus:bg-forest focus:px-4 focus:py-2 focus:text-ivory">
        Skip to content
      </a>
      <div className="container-x flex h-[68px] items-center gap-4">
        <Link to="/" aria-label="KindRoute home" className="shrink-0">
          <Logo />
        </Link>

        <nav aria-label="Primary" className="ml-6 hidden items-center gap-0.5 xl:flex">
          {LINKS.map((l) => (
            <NavLink key={l.to} to={l.to} className={({ isActive }) => cx('rounded-full px-3 py-2 text-[13.5px] font-semibold transition', isActive ? 'bg-forest/[.07] text-forest' : 'text-charcoal-600 hover:text-forest')}>
              {l.label}
            </NavLink>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
          <form onSubmit={submit} className="relative hidden md:block">
            <AnimatePresence initial={false}>
              {searchOpen && (
                <motion.input
                  ref={searchRef}
                  key="s"
                  initial={{ width: 0, opacity: 0 }}
                  animate={{ width: 240, opacity: 1 }}
                  exit={{ width: 0, opacity: 0 }}
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  onBlur={() => !q && setSearchOpen(false)}
                  placeholder="Search needs…"
                  aria-label="Search needs"
                  className="field h-10 rounded-full py-0 pl-4 pr-10 text-[14px]"
                />
              )}
            </AnimatePresence>
            <button type={searchOpen ? 'submit' : 'button'} onClick={() => !searchOpen && setSearchOpen(true)} aria-label="Search" className={cx('grid h-10 w-10 place-items-center rounded-full text-forest transition hover:bg-forest/5', searchOpen && 'absolute right-0 top-0')}>
              <Search className="h-[18px] w-[18px]" />
            </button>
          </form>

          {session && <NotificationsBell />}
          {session ? <ProfileMenu /> : (
            <Link to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} className="hidden rounded-full px-3 py-2 text-[13.5px] font-bold text-forest hover:bg-forest/5 sm:inline-flex">
              Sign in
            </Link>
          )}
          <Link to="/donate" className={btn('coral', 'sm', 'h-10 px-4 sm:px-5')}>
            <span className="sm:hidden">Donate</span>
            <span className="hidden sm:inline">Donate Now</span>
          </Link>
          <button className="grid h-10 w-10 place-items-center rounded-full text-forest hover:bg-forest/5 xl:hidden" aria-label={open ? 'Close menu' : 'Open menu'} aria-expanded={open} aria-controls="mobile-menu" onClick={() => setOpen((v) => !v)}>
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      <AnimatePresence>
        {open && (
          <motion.div id="mobile-menu" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="h-[calc(100dvh-68px)] overflow-y-auto border-t border-forest/10 bg-ivory xl:hidden">
            <div className="container-x py-6">
              <form onSubmit={submit} className="relative mb-6">
                <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-charcoal-400" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="What would you like to donate?" aria-label="Search needs" className="field rounded-full pl-11" />
              </form>
              <nav aria-label="Mobile" className="flex flex-col">
                {LINKS.map((l, i) => (
                  <motion.div key={l.to} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.03 * i }}>
                    <NavLink to={l.to} className="flex items-center justify-between border-b border-forest/10 py-4 font-display text-[26px] text-forest">
                      {l.label}
                    </NavLink>
                  </motion.div>
                ))}
              </nav>
              {!session && (
                <Link to="/login" className={btn('outline', 'lg', 'mt-8 w-full')}>
                  Sign in / Register
                </Link>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  )
}

function useClickAway(onAway: () => void) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const f = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && onAway()
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onAway()
    document.addEventListener('mousedown', f)
    document.addEventListener('keydown', k)
    return () => {
      document.removeEventListener('mousedown', f)
      document.removeEventListener('keydown', k)
    }
  }, [onAway])
  return ref
}

function ProfileMenu() {
  const [open, setOpen] = useState(false)
  const { session, hasRole, signOut } = useSession()
  const ref = useClickAway(() => setOpen(false))
  const nav = useNavigate()
  if (!session) return null
  const items = [
    { to: '/dashboard', label: 'My donations', icon: LayoutDashboard, show: true },
    { to: '/portal/organization', label: 'Organisation portal', icon: Building2, show: hasRole('org_staff') },
    { to: '/portal/partner', label: 'Partner portal', icon: Truck, show: true },
    { to: '/admin', label: 'Admin', icon: Shield, show: hasRole('admin') },
  ]
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((v) => !v)} aria-haspopup="menu" aria-expanded={open} className="flex h-10 items-center gap-1.5 rounded-full border border-forest/15 bg-white/70 pl-1 pr-2.5 text-[13px] font-bold text-forest hover:border-forest/30">
        <span className="grid h-8 w-8 place-items-center rounded-full bg-sage text-[13px] text-forest">{session.user.fullName.slice(0, 1).toUpperCase()}</span>
        <ChevronDown className="h-3.5 w-3.5" />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div role="menu" initial={{ opacity: 0, y: 6, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 6 }} className="absolute right-0 top-12 w-64 rounded-3xl border border-forest/10 bg-white p-2 shadow-lift">
            <div className="px-3 py-2.5">
              <p className="truncate text-[14px] font-bold text-forest">{session.user.fullName}</p>
              <p className="text-[12px] text-charcoal-500">{session.roles.map((r) => r.role.replace('_', ' ')).join(' · ')}</p>
            </div>
            {items.filter((i) => i.show).map((i) => (
              <Link key={i.to} to={i.to} role="menuitem" onClick={() => setOpen(false)} className="flex items-center gap-3 rounded-2xl px-3 py-2.5 text-[14px] font-semibold text-charcoal hover:bg-ivory">
                <i.icon className="h-4 w-4 text-forest-400" /> {i.label}
              </Link>
            ))}
            <Link to="/dashboard?tab=profile" role="menuitem" onClick={() => setOpen(false)} className="flex items-center gap-3 rounded-2xl px-3 py-2.5 text-[14px] font-semibold text-charcoal hover:bg-ivory">
              <User className="h-4 w-4 text-forest-400" /> Profile
            </Link>
            <button role="menuitem" onClick={async () => { setOpen(false); await signOut(); nav('/') }} className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left text-[14px] font-semibold text-coral-700 hover:bg-coral-100/60">
              <LogOut className="h-4 w-4" /> Sign out
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function NotificationsBell() {
  const [open, setOpen] = useState(false)
  const backend = useBackend()
  const ref = useClickAway(() => setOpen(false))
  const { data } = useData((b) => b.listNotifications(), [], { poll: 20000 })
  const unread = (data ?? []).filter((n) => !n.read).length
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((v) => !v)} aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`} aria-expanded={open} className="relative grid h-10 w-10 place-items-center rounded-full text-forest hover:bg-forest/5">
        <Bell className="h-[18px] w-[18px]" />
        {unread > 0 && <span className="absolute right-1.5 top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-coral-600 px-1 text-[10px] font-bold text-white">{unread > 9 ? '9+' : unread}</span>}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }} className="fixed inset-x-3 top-[72px] rounded-3xl border border-forest/10 bg-white shadow-lift sm:absolute sm:inset-x-auto sm:right-0 sm:top-12 sm:w-96">
            <div className="flex items-center justify-between px-5 pb-2 pt-4">
              <p className="font-display text-lg text-forest">Notifications</p>
              {unread > 0 && (
                <button className="text-[12.5px] font-bold text-forest-400 hover:text-forest" onClick={() => backend.markNotificationsRead()}>
                  Mark all read
                </button>
              )}
            </div>
            <div className="max-h-[60vh] overflow-y-auto p-2">
              {!data?.length && <p className="px-3 py-8 text-center text-sm text-charcoal-500">No notifications yet.</p>}
              {data?.map((n) => (
                <Link key={n.id} to={n.link ?? '#'} onClick={() => { setOpen(false); if (!n.read) backend.markNotificationsRead([n.id]) }} className={cx('block rounded-2xl px-3 py-3 hover:bg-ivory', !n.read && 'bg-sage-100/50')}>
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-[13.5px] font-bold text-forest">{n.title}</p>
                    <span className="shrink-0 text-[11px] text-charcoal-400">{timeAgo(n.at)}</span>
                  </div>
                  <p className="mt-0.5 text-[13px] leading-snug text-charcoal-600">{n.body}</p>
                </Link>
              ))}
            </div>
            <p className="border-t border-forest/10 px-5 py-3 text-[11.5px] text-charcoal-500">In-app notifications. SMS / email delivery activates when a provider is configured.</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
