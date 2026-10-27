import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { motion, useInView } from 'framer-motion'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { ArrowRight, ArrowUpRight, BadgeCheck, Box, Building2, ClipboardCheck, EyeOff, FileCheck2, HandHeart, MousePointerClick, PackageCheck, ShieldCheck, Sparkles, Truck } from 'lucide-react'
import { LinkButton, SectionHead, DemoTag, Skeleton, btn } from '../components/ui'
import { OrgCard, SearchBar } from '../components/domain'
import { CategoryIcon, CATEGORY_TINT } from '../components/CategoryIcon'
import { HeroFallback } from '../three/HeroFallback'
import { use3DPreference, useData, useIsMobile, useMedia } from '../state/app'
import { CATEGORIES } from '../data/categories'
import { needIsCurrent, policyAccepts, searchOrganizations } from '../lib/search'
import type { CategoryId } from '../lib/types'
import { cx } from '../lib/format'

gsap.registerPlugin(ScrollTrigger)
const HeroCanvas = lazy(() => import('../three/HeroScene'))

const ease = [0.2, 0.7, 0.2, 1] as const

function Hero() {
  const nav = useNavigate()
  const { enabled, reduced } = use3DPreference()
  const mobile = useIsMobile()
  const desktop = useMedia('(min-width: 1024px)')
  const section = useRef<HTMLElement>(null)
  const copy = useRef<HTMLDivElement>(null)
  const scroll = useRef(0)
  const pick = (c: CategoryId) => nav(`/explore?cat=${c}`)

  useEffect(() => {
    if (!section.current) return
    const ctx = gsap.context(() => {
      ScrollTrigger.create({ trigger: section.current, start: 'top top', end: 'bottom top', scrub: true, onUpdate: (s) => (scroll.current = s.progress) })
      if (!reduced) gsap.to(copy.current, { yPercent: -18, opacity: 0.2, ease: 'none', scrollTrigger: { trigger: section.current, start: 'top top', end: 'bottom top', scrub: true } })
    }, section)
    return () => ctx.revert()
  }, [reduced])

  const words = 'Your unused things can become someone’s everyday hope.'.split(' ')
  return (
    <section ref={section} className="relative -mt-[68px] overflow-hidden pt-[68px]" aria-label="Introduction">
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(70%_60%_at_75%_40%,#E6EEE5_0%,rgba(248,246,240,0)_70%),radial-gradient(40%_40%_at_10%_90%,#FAE8E1_0%,rgba(248,246,240,0)_70%)]" />
      {desktop && (
        <div className="absolute inset-0 top-[68px]">
          {enabled ? (
            <Suspense fallback={<div className="absolute inset-y-0 right-0 w-1/2"><HeroFallback onPick={pick} /></div>}>
              <HeroCanvas onPick={pick} scrollRef={scroll} still={reduced} offsetX={3.1} />
            </Suspense>
          ) : (
            <div className="absolute inset-y-0 right-0 w-1/2"><HeroFallback onPick={pick} /></div>
          )}
        </div>
      )}
      <div className="container-x pointer-events-none relative grid min-h-[calc(100svh-68px)] grid-rows-[auto_1fr] lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] lg:grid-rows-1">
        <div ref={copy} className="pointer-events-auto relative z-10 flex flex-col justify-center pb-6 pt-10 lg:pb-20 lg:pt-0">
          <motion.p initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease }} className="eyebrow flex items-center gap-3">
            <span className="h-px w-8 bg-forest/30" /> Pune · Donation routing
          </motion.p>
          <h1 className="display-xl mt-6 text-balance text-forest">
            {words.map((w, i) => (
              <span key={i} className="inline-block overflow-hidden pb-[0.08em] align-bottom">
                <motion.span className={cx('inline-block', w.startsWith('everyday') && 'italic text-coral-700')} initial={reduced ? false : { y: '105%' }} animate={{ y: 0 }} transition={{ duration: 0.9, delay: 0.1 + i * 0.06, ease }}>
                  {w}&nbsp;
                </motion.span>
              </span>
            ))}
          </h1>
          <motion.p initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, delay: 0.7, ease }} className="mt-7 max-w-[34rem] text-[17px] leading-relaxed text-charcoal-600 sm:text-[18px]">
            Find verified homes across Pune that need what you already have. We connect your donations with the right people and help get them delivered.
          </motion.p>
          <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, delay: 0.85, ease }} className="mt-9 flex flex-col gap-3 sm:flex-row">
            <LinkButton to="/explore" size="lg" arrow>Find What’s Needed</LinkButton>
            <LinkButton to="/donate" size="lg" variant="outline">List Items to Donate</LinkButton>
          </motion.div>
          <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.2 }} className="mt-8 hidden items-center gap-2 text-[12.5px] font-semibold text-charcoal-500 lg:flex">
            <MousePointerClick className="h-4 w-4" /> {enabled ? 'Tap a floating item to see who needs it' : 'Choose an item to see who needs it'}
          </motion.p>
        </div>
        <div className="pointer-events-auto relative -mx-4 h-[440px] sm:-mx-6 sm:h-[520px] lg:hidden">
          {desktop ? null : enabled ? (
            <Suspense fallback={<HeroFallback onPick={pick} />}>
              <HeroCanvas onPick={pick} scrollRef={scroll} still={reduced} mobile={mobile} />
            </Suspense>
          ) : (
            <HeroFallback onPick={pick} />
          )}
        </div>
      </div>
      <div className="relative border-y border-forest/10 bg-white/40 py-4" aria-hidden>
        <div className="flex w-max animate-marquee gap-10 whitespace-nowrap font-display text-[22px] italic text-forest/70">
          {Array.from({ length: 2 }).flatMap((_, k) => ['School textbooks', 'Winter blankets', 'Rice & dal', 'Sanitary pads', 'Board games', 'Walkers', 'Study tables', 'Cotton sarees', 'Storybooks', 'Cooking oil'].map((w) => (
            <span key={w + k} className="flex items-center gap-10">{w}<span className="h-1.5 w-1.5 rounded-full bg-coral" /></span>
          )))}
        </div>
      </div>
    </section>
  )
}

function Categories() {
  const { data: orgs } = useData((b) => b.listPublicOrganizations(), [])
  const counts = useMemo(() => {
    const m = new Map<CategoryId, { accept: number; need: number }>()
    for (const c of CATEGORIES) m.set(c.id, { accept: 0, need: 0 })
    orgs?.forEach((o) => {
      o.policies.filter(policyAccepts).forEach((p) => m.get(p.categoryId)!.accept++)
      new Set(o.needs.filter((n) => needIsCurrent(n)).map((n) => n.categoryId)).forEach((c) => m.get(c)!.need++)
    })
    return m
  }, [orgs])
  return (
    <section className="container-x py-24 sm:py-32" aria-labelledby="cat-h">
      <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
        <SectionHead index="01" eyebrow="Quick donation categories" title={<span id="cat-h">What do you have <em className="text-coral-700">to give?</em></span>} />
        <p className="max-w-sm text-[15px] text-charcoal-600">Each category opens the organisations that currently need it or explicitly accept it — never a generic list.</p>
      </div>
      <div className="mt-14 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {CATEGORIES.map((c, i) => {
          const n = counts.get(c.id)!
          return (
            <motion.div key={c.id} initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.5, delay: (i % 5) * 0.05, ease }}>
              <Link to={`/explore?cat=${c.id}`} className="card group flex h-full flex-col p-5 transition-all duration-300 hover:-translate-y-1 hover:border-forest/25 hover:shadow-lift">
                <span className={cx('grid h-12 w-12 place-items-center rounded-2xl transition-transform duration-500 group-hover:-rotate-6 group-hover:scale-110', CATEGORY_TINT[c.id].bg, CATEGORY_TINT[c.id].fg)}>
                  <CategoryIcon id={c.id} className="h-6 w-6" />
                </span>
                <p className="mt-5 text-[15px] font-bold leading-snug text-forest">{c.label}</p>
                <p className="mt-1 text-[12.5px] leading-snug text-charcoal-500">{c.blurb}</p>
                <p className="mt-auto flex items-center justify-between pt-4 text-[12px] font-bold text-forest-400">
                  {orgs ? (n.accept ? `${n.accept} accepting${n.need ? ` · ${n.need} need now` : ''}` : 'No matches yet') : '…'}
                  <ArrowUpRight className="h-4 w-4 opacity-0 transition group-hover:opacity-100" />
                </p>
              </Link>
            </motion.div>
          )
        })}
      </div>
    </section>
  )
}

function SearchSection() {
  const { data: orgs, loading } = useData((b) => b.listPublicOrganizations(), [])
  const urgent = useMemo(() => (orgs ? searchOrganizations(orgs, { sort: 'urgency', needsOnly: true }).results.slice(0, 3) : []), [orgs])
  const names = useMemo(() => orgs?.map((o) => ({ name: o.name, slug: o.slug })) ?? [], [orgs])
  return (
    <section className="relative overflow-hidden bg-white/50 py-24 sm:py-32" aria-labelledby="search-h">
      <div className="container-x">
        <SectionHead align="center" index="02" eyebrow="Search for needs" title={<span id="search-h">Search what’s needed, <em className="text-coral-700">right now.</em></span>} body="Try “winter clothes”, “orphanages needing books” or “organisations near Kothrud”. Results come from each organisation’s live needs and acceptance rules." />
        <div className="mx-auto mt-12 max-w-3xl">
          <SearchBar orgNames={names} />
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            {['Books', 'Winter clothes', 'Food packets', 'Blankets', 'School bags', 'Hygiene kits', 'Old-age homes needing clothes', 'Near Kothrud'].map((s) => (
              <Link key={s} to={`/explore?q=${encodeURIComponent(s)}`} className="chip">{s}</Link>
            ))}
          </div>
        </div>
        <div className="mt-20 flex items-end justify-between gap-4">
          <h3 className="font-display text-[30px] text-forest">Needed now</h3>
          <Link to="/explore?needs=1&sort=urgency" className="link-u text-[14px] font-bold text-forest">See all current needs</Link>
        </div>
        <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {loading ? [0, 1, 2].map((i) => <Skeleton key={i} className="h-[420px] rounded-3xl" />) : urgent.map((r, i) => <OrgCard key={r.org.id} result={r} index={i} />)}
        </div>
      </div>
    </section>
  )
}

const STEPS = [
  { icon: Box, title: 'Choose your items', body: 'Add what you have, its condition and quantity. Food needs expiry or preparation details.' },
  { icon: Building2, title: 'Match a verified home', body: 'We show organisations whose current needs and rules fit — and warn you when they don’t.' },
  { icon: ClipboardCheck, title: 'Organisation confirms', body: 'Their authorised staff accept or decline. Nothing is “confirmed” before they do.' },
  { icon: Truck, title: 'Partner picks up', body: 'An approved delivery partner claims the job, confirms your slot and collects the items.' },
  { icon: PackageCheck, title: 'Receipt confirmed', body: 'Delivery proof is recorded and the organisation confirms receipt. Then it’s complete.' },
]

function Process() {
  const ref = useRef<HTMLDivElement>(null)
  const path = useRef<SVGPathElement>(null)
  const { reduced } = use3DPreference()
  useEffect(() => {
    if (!path.current || reduced) return
    const len = path.current.getTotalLength()
    gsap.set(path.current, { strokeDasharray: len, strokeDashoffset: len })
    const t = gsap.to(path.current, { strokeDashoffset: 0, ease: 'none', scrollTrigger: { trigger: ref.current, start: 'top 75%', end: 'bottom 60%', scrub: 0.6 } })
    return () => void t.scrollTrigger?.kill()
  }, [reduced])
  return (
    <section className="container-x py-24 sm:py-32" aria-labelledby="how-h">
      <SectionHead index="03" eyebrow="How it works" title={<span id="how-h">A route you can <em className="text-coral-700">trace</em>, end to end.</span>} body="Every donation moves through clear, recorded steps — like tracking a grocery order, but each hand-off is confirmed by a real person." />
      <div ref={ref} className="relative mt-16">
        <svg className="pointer-events-none absolute left-0 top-[34px] hidden h-24 w-full lg:block" viewBox="0 0 1000 100" preserveAspectRatio="none" aria-hidden>
          <path d="M40 30 C 160 90, 260 -20, 400 40 S 640 90, 780 30 S 930 10, 980 40" stroke="#173D32" strokeOpacity=".08" strokeWidth="2" fill="none" />
          <path ref={path} d="M40 30 C 160 90, 260 -20, 400 40 S 640 90, 780 30 S 930 10, 980 40" stroke="#EAA58D" strokeWidth="3" strokeLinecap="round" fill="none" />
        </svg>
        <ol className="relative grid gap-8 sm:grid-cols-2 lg:grid-cols-5 lg:gap-6">
          {STEPS.map((s, i) => (
            <motion.li key={s.title} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '-60px' }} transition={{ duration: 0.6, delay: i * 0.08, ease }}>
              <div className="relative grid h-[68px] w-[68px] place-items-center rounded-3xl border border-forest/10 bg-white shadow-soft">
                <s.icon className="h-7 w-7 text-forest" strokeWidth={1.6} />
                <span className="absolute -right-2 -top-2 grid h-7 w-7 place-items-center rounded-full bg-coral font-display text-[13px] text-forest-900">{i + 1}</span>
              </div>
              <h3 className="mt-6 text-[17px] font-bold text-forest">{s.title}</h3>
              <p className="mt-2 text-[14px] leading-relaxed text-charcoal-600">{s.body}</p>
            </motion.li>
          ))}
        </ol>
      </div>
      <div className="mt-14">
        <LinkButton to="/how-it-works" variant="outline" arrow>The full process & every status</LinkButton>
      </div>
    </section>
  )
}

function ExperienceTeaser() {
  return (
    <section className="container-x py-10" aria-labelledby="exp-h">
      <div className="relative overflow-hidden rounded-[2.5rem] bg-forest px-6 py-14 text-ivory sm:px-12 sm:py-20">
        <div aria-hidden className="absolute -right-24 -top-24 h-96 w-96 rounded-full bg-forest-400/40 blur-3xl" />
        <div aria-hidden className="absolute -bottom-32 left-1/3 h-96 w-96 rounded-full bg-coral/20 blur-3xl" />
        <div className="relative grid items-center gap-10 lg:grid-cols-2">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-sage">04 — Interactive story</p>
            <h2 id="exp-h" className="display-lg mt-4 text-balance">Watch a book find its <em className="text-coral">reader.</em></h2>
            <p className="mt-5 max-w-lg text-[17px] leading-relaxed text-ivory/75">Choose an item, hand it to our courier and follow its journey across a small 3D neighbourhood — to the child or elder waiting for it.</p>
            <p className="mt-3 inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-[12px] font-semibold text-ivory/80"><Sparkles className="h-3.5 w-3.5 text-coral" /> A visual preview — real donations are tracked separately.</p>
            <div className="mt-9 flex flex-wrap gap-3">
              <Link to="/experience" className={btn('coral', 'lg')}>Try the donation story <ArrowRight className="h-4 w-4" /></Link>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3 sm:gap-4">
            {(['books', 'bedding', 'packaged_food', 'clothes', 'toys', 'hygiene'] as CategoryId[]).map((c, i) => (
              <motion.div key={c} initial={{ opacity: 0, scale: 0.9 }} whileInView={{ opacity: 1, scale: 1 }} viewport={{ once: true }} transition={{ delay: i * 0.06, ease }} className="grid aspect-square place-items-center rounded-3xl border border-white/10 bg-white/5 backdrop-blur">
                <CategoryIcon id={c} className="h-9 w-9 text-sage" />
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

function CountUp({ value }: { value: number }) {
  const ref = useRef<HTMLSpanElement>(null)
  const inView = useInView(ref, { once: true })
  const [n, setN] = useState(0)
  useEffect(() => {
    if (!inView) return
    const o = { v: 0 }
    const t = gsap.to(o, { v: value, duration: 1.4, ease: 'power2.out', onUpdate: () => setN(Math.round(o.v)) })
    return () => void t.kill()
  }, [inView, value])
  return <span ref={ref}>{n.toLocaleString('en-IN')}</span>
}

function Impact() {
  const { data } = useData((b) => b.getImpactStats(), [])
  const stats = data
    ? [
        { label: 'Donations completed', value: data.donationsCompleted, note: 'Receipt confirmed by the organisation' },
        { label: 'Organisations verified', value: data.organizationsVerified, note: 'Reviewed by an administrator' },
        { label: 'Items delivered', value: data.itemsDelivered, note: 'Units across all item types' },
        { label: 'Pune localities served', value: data.localitiesServed, note: 'Pickup or destination locality' },
      ]
    : []
  return (
    <section className="container-x py-24 sm:py-32" aria-labelledby="impact-h">
      <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
        <SectionHead index="05" eyebrow="Impact" title={<span id="impact-h">Counted, <em className="text-coral-700">not claimed.</em></span>} body="These figures are calculated live from completed, receipt-confirmed donations on the platform." />
        {data?.isDemo && <DemoTag label="Illustrative demo figures" className="self-start lg:self-end" />}
      </div>
      <div className="mt-12 grid grid-cols-2 gap-px overflow-hidden rounded-4xl border border-forest/10 bg-forest/10 lg:grid-cols-4">
        {(stats.length ? stats : [0, 1, 2, 3].map(() => null)).map((s, i) => (
          <div key={i} className="bg-ivory p-6 sm:p-8">
            {s ? (
              <>
                <p className="font-display text-[56px] leading-none text-forest sm:text-[72px]"><CountUp value={s.value} /></p>
                <p className="mt-4 text-[14px] font-bold text-forest">{s.label}</p>
                <p className="mt-1 text-[12.5px] text-charcoal-500">{s.note}</p>
              </>
            ) : <Skeleton className="h-28" />}
          </div>
        ))}
      </div>
    </section>
  )
}

function Trust() {
  const items = [
    { icon: BadgeCheck, title: 'Verified by people, not uploads', body: 'An administrator checks registration documents, address and contact details before any organisation is listed as verified — and reviews it again every year.' },
    { icon: EyeOff, title: 'Your details stay private', body: 'Organisations see your first name and locality. Only the assigned delivery partner sees your address, and only while the job is active.' },
    { icon: FileCheck2, title: 'Proof at every hand-off', body: 'Pickup and delivery proof plus the organisation’s receipt confirmation, all in one audit-logged timeline.' },
    { icon: ShieldCheck, title: 'Safety rules built in', body: 'No medicines, expired food or hazardous items. Each organisation sets its own condition and food-safety rules.' },
  ]
  return (
    <section className="bg-sage-100/60 py-24 sm:py-32" aria-labelledby="trust-h">
      <div className="container-x grid gap-14 lg:grid-cols-[1fr_1.4fr]">
        <SectionHead index="06" eyebrow="Trust & safety" title={<span id="trust-h">Care for people who <em className="text-coral-700">can’t speak up</em> online.</span>} body="We work with homes for children and elders. We never publish residents’ names, photos or locations." />
        <div className="grid gap-4 sm:grid-cols-2">
          {items.map((it, i) => (
            <motion.div key={it.title} initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.07, ease }} className="card p-6">
              <it.icon className="h-7 w-7 text-forest" strokeWidth={1.6} />
              <h3 className="mt-5 text-[16px] font-bold text-forest">{it.title}</h3>
              <p className="mt-2 text-[14px] leading-relaxed text-charcoal-600">{it.body}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}

function JoinCtas() {
  return (
    <section className="container-x pt-24 sm:pt-32" aria-label="Join KindRoute">
      <div className="grid gap-4 lg:grid-cols-2">
        <Link to="/for-organizations" className="group relative overflow-hidden rounded-[2.5rem] bg-coral-100 p-8 transition hover:shadow-lift sm:p-12">
          <HandHeart className="h-10 w-10 text-coral-700" strokeWidth={1.5} />
          <h3 className="display-md mt-8 text-forest">Run a home or NGO in Pune?</h3>
          <p className="mt-3 max-w-md text-[15.5px] text-charcoal-600">List what you need, set your rules, and receive only what you can use — with delivery handled.</p>
          <span className="mt-8 inline-flex items-center gap-2 font-bold text-forest">Register your organisation <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" /></span>
        </Link>
        <Link to="/become-a-partner" className="group relative overflow-hidden rounded-[2.5rem] bg-forest p-8 text-ivory transition hover:shadow-lift sm:p-12">
          <Truck className="h-10 w-10 text-sage" strokeWidth={1.5} />
          <h3 className="display-md mt-8">Have a vehicle and a few free hours?</h3>
          <p className="mt-3 max-w-md text-[15.5px] text-ivory/75">Become a verified delivery partner and carry donations between neighbourhoods.</p>
          <span className="mt-8 inline-flex items-center gap-2 font-bold text-coral">Become a delivery partner <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" /></span>
        </Link>
      </div>
    </section>
  )
}

export default function Home() {
  return (
    <>
      <Hero />
      <Categories />
      <SearchSection />
      <Process />
      <ExperienceTeaser />
      <Impact />
      <Trust />
      <JoinCtas />
    </>
  )
}
