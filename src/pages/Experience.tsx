import { Suspense, lazy, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { Hand, HeartHandshake, Home, Info, RotateCcw, Truck } from 'lucide-react'
import { Badge, Button, btn } from '../components/ui'
import { StatusPill } from '../components/domain'
import { CategoryIcon } from '../components/CategoryIcon'
import { use3DPreference, useData, useSession } from '../state/app'
import type { CategoryId } from '../lib/types'
import { ITEM_RECIPIENT, type ItemKind, type StoryPhase } from '../three/story'
import { cx } from '../lib/format'

const ExperienceCanvas = lazy(() => import('../three/ExperienceScene'))

const ITEMS: Array<{ kind: ItemKind; label: string; cat: CategoryId }> = [
  { kind: 'book', label: 'Books', cat: 'books' },
  { kind: 'blanket', label: 'Blanket', cat: 'bedding' },
  { kind: 'food', label: 'Food package', cat: 'packaged_food' },
  { kind: 'clothes', label: 'Clothes', cat: 'clothes' },
  { kind: 'toy', label: 'Toys', cat: 'toys' },
]

const CAPTIONS: Record<StoryPhase, string> = {
  ready: 'Choose an item, then tap “Donate this item”. Tap the scene to say hello to the courier.',
  approach: 'The courier walks over to collect it…',
  lift: 'Carefully picked up.',
  journey: 'On its way across the neighbourhood…',
  handoff: 'Handing it over to someone who has been waiting.',
  celebrate: 'Received with a smile.',
  done: '',
}

export default function Experience() {
  const [params] = useSearchParams()
  const requestCode = params.get('request')
  const { enabled, reduced } = use3DPreference()
  const [item, setItem] = useState<ItemKind>('book')
  const [phase, setPhase] = useState<StoryPhase>('ready')
  const [play, setPlay] = useState(0)
  const [wave, setWave] = useState(0)
  const playing = phase !== 'ready' && phase !== 'done'
  const recipient = ITEM_RECIPIENT[item] === 'child' ? 'a child' : 'an elder'
  const cat = ITEMS.find((i) => i.kind === item)!.cat

  // Without WebGL the scene can't drive the story, so a simple timer sequence does.
  useEffect(() => {
    if (enabled || !play) return
    const seq: Array<[StoryPhase, number]> = [['approach', 0], ['journey', 1300], ['handoff', 2800], ['celebrate', 4000], ['done', 5200]]
    const k = reduced ? 0.3 : 1
    const timers = seq.map(([p, t]) => setTimeout(() => setPhase(p), t * k))
    return () => timers.forEach(clearTimeout)
  }, [enabled, play, reduced])

  const start = () => {
    setPhase('approach')
    setPlay((p) => p + 1)
  }
  const reset = () => {
    setPhase('ready')
    setPlay(0)
  }

  return (
    <div className="container-x pb-10 pt-8 sm:pt-12">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="eyebrow">Interactive donation story</p>
          <h1 className="display-md mt-3 max-w-3xl text-forest">Follow one small thing <em className="text-coral-700">all the way</em> to someone.</h1>
        </div>
        <Badge tone="warn" icon={<Info className="h-3.5 w-3.5" />} className="self-start px-3 py-1.5 text-[12px]">Preview animation — not a real donation</Badge>
      </div>

      <RealStatus code={requestCode} />

      <div className="relative mt-8 h-[68vh] min-h-[460px] overflow-hidden rounded-[2.5rem] border border-forest/10 bg-[radial-gradient(80%_70%_at_50%_30%,#EEF3EC_0%,#E5ECE3_45%,#DCE6DA_100%)]">
        {enabled ? (
          <Suspense fallback={<div className="grid h-full place-items-center text-sm font-semibold text-charcoal-500">Preparing the scene…</div>}>
            <ExperienceCanvas item={item} playToken={play} onPhase={setPhase} still={reduced} waveToken={wave} onCourierClick={() => !playing && setWave((w) => w + 1)} />
          </Suspense>
        ) : (
          <StoryFallback item={item} phase={phase} />
        )}

        {/* item picker */}
        <div className="absolute inset-x-3 top-3 sm:inset-x-auto sm:left-5 sm:top-5">
          <div className="glass flex gap-1.5 overflow-x-auto rounded-3xl p-1.5 sm:flex-col sm:overflow-visible" role="radiogroup" aria-label="Choose an item">
            {ITEMS.map((i) => (
              <button key={i.kind} role="radio" aria-checked={item === i.kind} disabled={playing} onClick={() => { setItem(i.kind); reset() }} className={cx('flex shrink-0 items-center gap-2 rounded-2xl px-3 py-2 text-[13px] font-bold transition disabled:opacity-50', item === i.kind ? 'bg-forest text-ivory' : 'text-forest hover:bg-white/70')}>
                <CategoryIcon id={i.cat} className="h-4 w-4" /> {i.label}
              </button>
            ))}
          </div>
        </div>

        {/* caption + action */}
        <div className="absolute inset-x-3 bottom-3 sm:inset-x-5 sm:bottom-5">
          <AnimatePresence mode="wait">
            {phase !== 'done' ? (
              <motion.div key={phase} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} className="glass flex flex-col gap-3 rounded-3xl p-4 sm:flex-row sm:items-center sm:p-5">
                <p className="flex-1 text-[14.5px] font-semibold text-forest" aria-live="polite">{CAPTIONS[phase]}</p>
                {phase === 'ready' && <Button size="lg" onClick={start} icon={<HeartHandshake className="h-5 w-5" />}>Donate this item</Button>}
                {phase === 'ready' && enabled && <Button variant="outline" onClick={() => setWave((w) => w + 1)} icon={<Hand className="h-4 w-4" />}>Wave</Button>}
              </motion.div>
            ) : (
              <motion.div key="done" initial={{ opacity: 0, y: 16, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} className="rounded-[2rem] bg-forest p-6 text-ivory shadow-lift sm:p-8">
                <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-sage">Preview complete</p>
                <p className="mt-2 font-display text-[30px] leading-tight sm:text-[38px]">A little kindness, one meaningful step.</p>
                <p className="mt-2 max-w-xl text-[14px] text-ivory/75">In real life, {item === 'book' ? 'books' : item === 'blanket' ? 'blankets' : item === 'food' ? 'food packages' : item === 'toy' ? 'toys' : 'clothes'} reach {recipient} only after an organisation accepts the request and confirms receipt.</p>
                <div className="mt-6 flex flex-wrap gap-2">
                  <Link to={`/explore?cat=${cat}`} className={btn('coral')}>Find another need</Link>
                  <Link to={requestCode ? `/track/${requestCode}` : '/dashboard'} className={btn('light')}>Track real donation</Link>
                  <button onClick={reset} className={btn('ghost', 'md', 'text-ivory hover:bg-white/10')}><RotateCcw className="h-4 w-4" /> Replay</button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
      {!enabled && <p className="mt-3 text-[12.5px] text-charcoal-500">Showing the simplified version because 3D is off, unsupported, or reduced motion is preferred. You can switch 3D on in the footer.</p>}
    </div>
  )
}

function RealStatus({ code }: { code: string | null }) {
  const { session } = useSession()
  const { data, error } = useData((b) => b.getDonation(code!), [code, session?.user.id], { enabled: !!code && !!session })
  if (!code) return <p className="mt-4 max-w-2xl text-[14px] text-charcoal-600">This is a storytelling preview. It doesn’t create or confirm a donation — real requests are tracked on your dashboard.</p>
  if (!session) return <p className="mt-4 text-[14px] text-charcoal-600">Sign in to see the real status of {code}.</p>
  if (error) return <p className="mt-4 text-[14px] text-coral-700">Could not load {code}: {error.message}</p>
  if (!data) return null
  return (
    <div className="mt-5 flex flex-wrap items-center gap-3 rounded-2xl border border-forest/10 bg-white/70 px-4 py-3 text-[14px]">
      <span className="font-semibold text-forest">Your real request <span className="font-mono">{data.request.code}</span> is:</span>
      <StatusPill status={data.request.status} />
      <Link to={`/track/${data.request.code}`} className="link-u ml-auto text-[13px] font-bold text-forest">Open tracking</Link>
    </div>
  )
}

/** 2D storytelling fallback (no WebGL / reduced motion / 3D off). */
function StoryFallback({ item, phase }: { item: ItemKind; phase: StoryPhase }) {
  const cat = ITEMS.find((i) => i.kind === item)!.cat
  const stops: StoryPhase[] = ['ready', 'approach', 'journey', 'handoff', 'celebrate']
  const idx = phase === 'done' ? 4 : Math.max(0, stops.indexOf(phase === 'lift' ? 'approach' : phase))
  const x = ['8%', '22%', '55%', '78%', '82%'][idx]
  return (
    <div className="absolute inset-0 flex items-center justify-center px-6">
      <div className="relative h-40 w-full max-w-3xl">
        <div className="absolute inset-x-0 top-1/2 h-3 -translate-y-1/2 rounded-full bg-[#EFE6D3]" />
        <div className="absolute left-[4%] top-1/2 grid h-14 w-14 -translate-y-1/2 place-items-center rounded-2xl bg-white text-forest shadow-soft"><Truck className="h-6 w-6" /></div>
        <div className="absolute right-[2%] top-1/2 grid h-20 w-20 -translate-y-1/2 place-items-center rounded-3xl bg-coral-100 text-coral-700 shadow-soft"><Home className="h-8 w-8" /></div>
        <motion.div animate={{ left: x }} transition={{ duration: 1.2, ease: 'easeInOut' }} className="absolute top-1/2 grid h-12 w-12 -translate-x-1/2 -translate-y-[130%] place-items-center rounded-2xl bg-forest text-ivory shadow-lift">
          <CategoryIcon id={cat} className="h-5 w-5" />
        </motion.div>
        {phase === 'celebrate' || phase === 'done' ? <p className="absolute right-0 top-[85%] text-[13px] font-bold text-forest">Received ♥</p> : null}
      </div>
    </div>
  )
}
