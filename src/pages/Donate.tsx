import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { AlertTriangle, ArrowLeft, ArrowRight, Check, CheckCircle2, ChevronDown, Info, PartyPopper, Phone, Plus, ShieldCheck, Sparkles, Store, Trash2, Truck } from 'lucide-react'
import type { CategoryId, ContactMethod, DeliveryMethod, DonationItemInput, DonationRequest, PublicOrganization, Unit, Condition } from '../lib/types'
import { Badge, Button, Checkbox, DemoTag, Field, Input, Notice, Select, Spinner, Textarea, btn, ErrorState } from '../components/ui'
import { PhotoInput, VerificationBadge } from '../components/domain'
import { AuthPanel, PhoneVerifyForm, useAuthCaps } from '../components/auth'
import { CategoryIcon, CATEGORY_TINT } from '../components/CategoryIcon'
import { useAction, useBackend, useData, useSession } from '../state/app'
import { CATEGORIES, CONDITIONS, DELIVERY_FEE_CONFIG, ORG_TYPES, PICKUP_SLOTS, UNITS, categoryById } from '../data/categories'
import { LOCALITIES, localityByName } from '../data/localities'
import { checkAgainstPolicy, maskPhone, validateItem } from '../lib/validation'
import { policyAccepts, searchOrganizations } from '../lib/search'
import { addDays, cx, localDateIso } from '../lib/format'

interface DraftItem extends DonationItemInput {
  key: string
  orgId?: string
}
interface Draft {
  /** idempotency key: one per draft, so double clicks and retries cannot create duplicate requests */
  clientRequestId: string
  step: number
  items: DraftItem[]
  mode: 'single' | 'split'
  orgId?: string
  methods: Record<string, DeliveryMethod>
  donor: { fullName: string; email: string; contactMethod: ContactMethod }
  pickup: { line1: string; landmark: string; locality: string; pinCode: string; instructions: string }
  preferredDate: string
  preferredSlot: string
  notes: string
  consent: boolean
}

const DRAFT_KEY = 'kindroute.donation-draft'
const newRequestId = () => globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36)
const emptyDraft = (): Draft => ({
  clientRequestId: newRequestId(),
  step: 0, items: [], mode: 'single', methods: {},
  donor: { fullName: '', email: '', contactMethod: 'phone' },
  pickup: { line1: '', landmark: '', locality: '', pinCode: '', instructions: '' },
  preferredDate: localDateIso(addDays(new Date(), 1)), preferredSlot: PICKUP_SLOTS[0], notes: '', consent: false,
})
const loadDraft = (): Draft => {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY)
    return raw ? { ...emptyDraft(), ...JSON.parse(raw) } : emptyDraft()
  } catch {
    return emptyDraft()
  }
}

const NAME_HINTS: Record<CategoryId, string> = {
  books: 'e.g. Class 6 Maths textbooks', clothes: 'e.g. Children’s winter jackets', packaged_food: 'e.g. Rice (sealed 5 kg bags)', fresh_food: 'e.g. Vegetable pulao, freshly cooked',
  bedding: 'e.g. Woollen blankets', toys: 'e.g. Jigsaw puzzles (complete)', hygiene: 'e.g. Sanitary pads (sealed)', furniture: 'e.g. Wooden study table', medical: 'e.g. Folding walker', other: 'e.g. Steel lunch boxes',
}

const SINGULAR: Record<Unit, string> = { pieces: 'piece', sets: 'set', pairs: 'pair', bags: 'bag', boxes: 'box', kg: 'kg', litres: 'litre', meals: 'meal' }
const unitLabel = (u: Unit, n: number) => (n === 1 ? SINGULAR[u] : UNITS[u])

const STEPS = ['Select items', 'Choose organisation', 'Your details', 'Review & submit']
const newKey = () => Math.random().toString(36).slice(2)

export default function Donate() {
  const [params] = useSearchParams()
  const [draft, setDraft] = useState<Draft>(loadDraft)
  const [done, setDone] = useState<DonationRequest[] | null>(null)
  const { data: orgs, loading, error, reload } = useData((b) => b.listPublicOrganizations(), [])
  const update = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }))

  useEffect(() => {
    try {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ ...draft, items: draft.items.map((i) => ({ ...i, photo: undefined })) }))
    } catch {
      /* storage unavailable — draft lives in memory only */
    }
  }, [draft])

  // deep links: /donate?org=slug&cat=books
  useEffect(() => {
    if (!orgs) return
    const slug = params.get('org')
    const cat = params.get('cat') as CategoryId | null
    setDraft((d) => {
      let next = d
      const org = slug ? orgs.find((o) => o.slug === slug) : undefined
      if (org && d.orgId !== org.id) next = { ...next, orgId: org.id, mode: 'single' }
      if (cat && CATEGORIES.some((c) => c.id === cat) && !d.items.some((i) => i.categoryId === cat))
        next = { ...next, step: 0, items: [...next.items, blankItem(cat)] }
      return next
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgs])

  if (done) return <Submitted requests={done} orgs={orgs ?? []} />
  if (error) return <div className="container-x py-16"><ErrorState error={error} onRetry={reload} /></div>
  if (loading || !orgs) return <Spinner label="Loading organisations…" />

  return (
    <div className="container-x pb-10 pt-8 sm:pt-12">
      <p className="eyebrow">Donation builder</p>
      <h1 className="display-md mt-3 text-forest">Let’s route your donation</h1>
      <Stepper step={draft.step} onJump={(s) => s < draft.step && update({ step: s })} />
      <AnimatePresence mode="wait">
        <motion.div key={draft.step} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.3 }}>
          {draft.step === 0 && <StepItems draft={draft} update={update} />}
          {draft.step === 1 && <StepOrg draft={draft} update={update} orgs={orgs} />}
          {draft.step === 2 && <StepDetails draft={draft} update={update} orgs={orgs} />}
          {draft.step === 3 && <StepReview draft={draft} update={update} orgs={orgs} onDone={(r) => { sessionStorage.removeItem(DRAFT_KEY); setDone(r) }} />}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

function blankItem(categoryId: CategoryId): DraftItem {
  const cat = categoryById(categoryId)
  const food = categoryId === 'packaged_food' ? { kind: 'packaged' as const, expiryDate: '', packaging: '', storage: 'room' as const, sealed: true } : categoryId === 'fresh_food' ? { kind: 'fresh' as const, preparedAt: '', packaging: '', storage: 'room' as const, sealed: true } : undefined
  return { key: newKey(), categoryId, name: '', quantity: 1, unit: cat.defaultUnit, condition: categoryId.includes('food') || categoryId === 'hygiene' ? 'new' : 'gently_used', food }
}

function Stepper({ step, onJump }: { step: number; onJump: (s: number) => void }) {
  return (
    <ol className="scrollbar-none my-8 flex gap-2 overflow-x-auto sm:my-10" aria-label="Progress">
      {STEPS.map((s, i) => (
        <li key={s} className="flex-1">
          <button onClick={() => onJump(i)} disabled={i >= step} aria-current={i === step ? 'step' : undefined} className="w-full min-w-[120px] text-left disabled:cursor-default">
            <span className={cx('block h-1 rounded-full transition-colors', i <= step ? 'bg-forest' : 'bg-forest/10')} />
            <span className={cx('mt-2.5 flex items-center gap-1.5 text-[12.5px] font-bold', i === step ? 'text-forest' : i < step ? 'text-forest-400' : 'text-charcoal-400')}>
              {i < step ? <Check className="h-3.5 w-3.5" /> : <span className="font-display">{i + 1}</span>} {s}
            </span>
          </button>
        </li>
      ))}
    </ol>
  )
}

function NavButtons({ back, next, nextLabel = 'Continue', disabled, hint }: { back?: () => void; next?: () => void; nextLabel?: string; disabled?: boolean; hint?: string }) {
  return (
    <div className="sticky bottom-0 z-20 -mx-4 mt-10 border-t border-forest/10 bg-ivory/90 px-4 py-4 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:px-0 sm:backdrop-blur-none">
      <div className="flex items-center gap-3">
        {back && <Button variant="ghost" onClick={back} icon={<ArrowLeft className="h-4 w-4" />}>Back</Button>}
        {hint && <p className="hidden text-[13px] text-charcoal-500 sm:block">{hint}</p>}
        {next && <Button className="ml-auto" size="lg" onClick={next} disabled={disabled}>{nextLabel} <ArrowRight className="h-4 w-4" /></Button>}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------ step 1 */

function StepItems({ draft, update }: { draft: Draft; update: (p: Partial<Draft>) => void }) {
  const [openKey, setOpenKey] = useState<string | null>(draft.items[draft.items.length - 1]?.key ?? null)
  const lastKey = draft.items[draft.items.length - 1]?.key
  useEffect(() => {
    // open items that arrive via deep link (/donate?cat=books) and still need a name
    const last = draft.items[draft.items.length - 1]
    if (last && !last.name && openKey === null) setOpenKey(last.key)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastKey])
  const setItem = (key: string, patch: Partial<DraftItem>) => update({ items: draft.items.map((i) => (i.key === key ? { ...i, ...patch } : i)) })
  const add = (c: CategoryId) => {
    const it = blankItem(c)
    update({ items: [...draft.items, it] })
    setOpenKey(it.key)
  }
  const problems = draft.items.map((i) => validateItem(i))
  const valid = draft.items.length > 0 && problems.every((p) => !p.length)
  return (
    <div className="grid gap-10 lg:grid-cols-[1fr_1.15fr]">
      <div>
        <h2 className="font-display text-2xl text-forest">What are you donating?</h2>
        <p className="mt-1 text-[14px] text-charcoal-500">Tap a category to add an item. You can add several.</p>
        <div className="mt-6 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3">
          {CATEGORIES.map((c) => {
            const count = draft.items.filter((i) => i.categoryId === c.id).length
            return (
              <motion.button whileTap={{ scale: 0.97 }} key={c.id} onClick={() => add(c.id)} className={cx('card group relative flex flex-col items-start p-4 text-left transition hover:-translate-y-0.5 hover:border-forest/30 hover:shadow-lift', count > 0 && 'border-forest/40 ring-2 ring-forest/10')}>
                <span className={cx('grid h-10 w-10 place-items-center rounded-xl transition group-hover:scale-110', CATEGORY_TINT[c.id].bg, CATEGORY_TINT[c.id].fg)}><CategoryIcon id={c.id} /></span>
                <span className="mt-3 text-[13.5px] font-bold leading-tight text-forest">{c.label}</span>
                {c.restricted && <span className="mt-1 text-[11px] font-semibold text-[#7A5410]">Extra safety checks</span>}
                <span className={cx('absolute right-3 top-3 grid h-6 w-6 place-items-center rounded-full text-[11px] font-bold', count ? 'bg-forest text-ivory' : 'bg-forest/5 text-forest opacity-0 group-hover:opacity-100')}>{count || <Plus className="h-3.5 w-3.5" />}</span>
              </motion.button>
            )
          })}
        </div>
      </div>

      <div>
        <h2 className="font-display text-2xl text-forest">Your items <span className="text-charcoal-400">({draft.items.length})</span></h2>
        <div className="mt-6 space-y-3">
          {!draft.items.length && <div className="rounded-3xl border border-dashed border-forest/20 p-10 text-center text-[14px] text-charcoal-500">No items yet — choose a category to start.</div>}
          {draft.items.map((it, idx) => (
            <ItemEditor key={it.key} item={it} open={openKey === it.key} onToggle={() => setOpenKey(openKey === it.key ? null : it.key)} problems={problems[idx]} onChange={(p) => setItem(it.key, p)} onRemove={() => update({ items: draft.items.filter((x) => x.key !== it.key) })} />
          ))}
        </div>
        <NavButtons next={() => update({ step: 1 })} disabled={!valid} hint={draft.items.length && !valid ? 'Fix the highlighted items to continue' : undefined} />
      </div>
    </div>
  )
}

function ItemEditor({ item, open, onToggle, onChange, onRemove, problems }: { item: DraftItem; open: boolean; onToggle: () => void; onChange: (p: Partial<DraftItem>) => void; onRemove: () => void; problems: string[] }) {
  const cat = categoryById(item.categoryId)
  const f = item.food
  const touched = item.name.length > 0
  const now = new Date()
  return (
    <motion.div layout className={cx('card overflow-hidden', problems.length > 0 && touched && 'border-coral-600/40')}>
      <button onClick={onToggle} aria-expanded={open} className="flex w-full items-center gap-3 p-4 text-left">
        <span className={cx('grid h-10 w-10 shrink-0 place-items-center rounded-xl', CATEGORY_TINT[item.categoryId].bg, CATEGORY_TINT[item.categoryId].fg)}><CategoryIcon id={item.categoryId} /></span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14.5px] font-bold text-forest">{item.name || `New ${cat.short.toLowerCase()} item`}</span>
          <span className="block text-[12.5px] text-charcoal-500">{item.quantity} {unitLabel(item.unit, item.quantity)} · {CONDITIONS[item.condition]}</span>
        </span>
        {problems.length ? touched && <AlertTriangle className="h-4 w-4 text-coral-700" aria-label="Needs attention" /> : <CheckCircle2 className="h-4 w-4 text-forest-400" aria-label="Looks good" />}
        <ChevronDown className={cx('h-4 w-4 text-charcoal-400 transition', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="space-y-4 border-t border-forest/10 p-4 sm:p-5">
          <Field label="Item name" required>{(id) => <Input id={id} value={item.name} onChange={(e) => onChange({ name: e.target.value })} placeholder={NAME_HINTS[item.categoryId]} maxLength={80} />}</Field>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Field label="Quantity" required>{(id) => <Input id={id} type="number" min={1} max={1000} value={item.quantity} onChange={(e) => onChange({ quantity: Math.floor(Number(e.target.value)) })} />}</Field>
            <Field label="Unit">{(id) => <Select id={id} value={item.unit} onChange={(e) => onChange({ unit: e.target.value as Unit })}>{Object.entries(UNITS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>}</Field>
            <Field label="Condition" className="col-span-2 sm:col-span-1">{(id) => <Select id={id} value={item.condition} onChange={(e) => onChange({ condition: e.target.value as Condition })}>{Object.entries(CONDITIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>}</Field>
          </div>

          {f && (
            <div className="space-y-4 rounded-2xl bg-[#FCF6EA] p-4">
              <p className="flex items-center gap-2 text-[13px] font-bold text-[#5E410C]"><ShieldCheck className="h-4 w-4" /> Food safety details</p>
              {f.kind === 'packaged' ? (
                <Field label="Expiry / best-before date" required>{(id) => <Input id={id} type="date" min={localDateIso(now)} value={f.expiryDate ?? ''} onChange={(e) => onChange({ food: { ...f, expiryDate: e.target.value } })} />}</Field>
              ) : (
                <Field label="Prepared / harvested at" required hint="Fresh food must be picked up well within the organisation’s time limit.">{(id) => <Input id={id} type="datetime-local" max={new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16)} value={f.preparedAt ? f.preparedAt.slice(0, 16) : ''} onChange={(e) => onChange({ food: { ...f, preparedAt: e.target.value ? new Date(e.target.value).toISOString() : '' } })} />}</Field>
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Packaging">{(id) => <Input id={id} value={f.packaging} onChange={(e) => onChange({ food: { ...f, packaging: e.target.value } })} placeholder={f.kind === 'packaged' ? 'Sealed bag, tin, box…' : 'Covered steel container…'} />}</Field>
                <Field label="Storage">{(id) => <Select id={id} value={f.storage} onChange={(e) => onChange({ food: { ...f, storage: e.target.value as 'room' } })}><option value="room">Room temperature</option><option value="refrigerated">Refrigerated</option><option value="frozen">Frozen</option></Select>}</Field>
              </div>
              <Field label="Allergens or ingredients to note">{(id) => <Input id={id} value={f.allergens ?? ''} onChange={(e) => onChange({ food: { ...f, allergens: e.target.value } })} placeholder="e.g. contains peanuts, dairy" />}</Field>
              <div className="space-y-2">
                {f.kind === 'packaged' && <Checkbox checked={f.sealed} onChange={(v) => onChange({ food: { ...f, sealed: v } })}>The packaging is sealed and unopened</Checkbox>}
                <Checkbox checked={!!f.vegetarian} onChange={(v) => onChange({ food: { ...f, vegetarian: v } })}>Vegetarian</Checkbox>
              </div>
            </div>
          )}
          {item.categoryId === 'medical' && <Notice tone="warn" icon={<Info className="h-4 w-4" />}>Mobility aids and first-aid kits only. Medicines of any kind cannot be donated. The organisation will inspect equipment before use.</Notice>}

          <Field label="Description" hint="Sizes, language, age group — anything that helps the organisation decide.">{(id) => <Textarea id={id} value={item.description ?? ''} onChange={(e) => onChange({ description: e.target.value })} className="min-h-[72px]" />}</Field>
          <PhotoInput value={item.photo} onChange={(photo) => onChange({ photo })} note="Optional. Photograph only the items — no people. Location data is removed." />
          {problems.length > 0 && touched && (
            <ul className="space-y-1" role="alert">
              {problems.map((p) => <li key={p} className="flex items-start gap-1.5 text-[13px] font-semibold text-coral-700"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {p}</li>)}
            </ul>
          )}
          <button onClick={onRemove} className="flex items-center gap-1.5 text-[13px] font-bold text-coral-700 hover:underline"><Trash2 className="h-3.5 w-3.5" /> Remove item</button>
        </div>
      )}
    </motion.div>
  )
}

/* ------------------------------------------------------------ step 2 */

function policyProblems(item: DonationItemInput, org: PublicOrganization) {
  return checkAgainstPolicy(item, org, org.policies.find((p) => p.categoryId === item.categoryId))
}

function StepOrg({ draft, update, orgs }: { draft: Draft; update: (p: Partial<Draft>) => void; orgs: PublicOrganization[] }) {
  const cats = [...new Set(draft.items.map((i) => i.categoryId))]
  const ranked = useMemo(() => {
    const res = searchOrganizations(orgs, { categories: cats }).results
    return res
      .map((r) => ({ ...r, fits: draft.items.filter((i) => !policyProblems(i, r.org).length).length }))
      .sort((a, b) => b.fits - a.fits || b.score - a.score)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgs, cats.join()])
  const chosen = orgs.find((o) => o.id === draft.orgId)
  // also offer a deep-linked org that matched nothing, so the user sees why
  const list = chosen && !ranked.some((r) => r.org.id === chosen.id) ? [{ org: chosen, fits: 0, matchedNeeds: [], score: 0 }, ...ranked] : ranked

  const assignAll = (orgId: string) => update({ orgId, items: draft.items.map((i) => ({ ...i, orgId })) })
  const effectiveOrg = (i: DraftItem) => (draft.mode === 'single' ? draft.orgId : i.orgId)
  const blocked = draft.items.filter((i) => {
    const o = orgs.find((x) => x.id === effectiveOrg(i))
    return !o || policyProblems(i, o).length > 0
  })
  const orgIds = [...new Set(draft.items.map(effectiveOrg).filter(Boolean))] as string[]
  const ok = blocked.length === 0 && orgIds.length > 0

  const goNext = () => {
    const methods = { ...draft.methods }
    for (const id of orgIds) {
      const o = orgs.find((x) => x.id === id)!
      if (!methods[id] || !o.deliveryMethods.includes(methods[id])) methods[id] = o.deliveryMethods[0]
    }
    update({ step: 2, methods, items: draft.items.map((i) => ({ ...i, orgId: effectiveOrg(i) })) })
  }

  return (
    <div>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="font-display text-2xl text-forest">Where should it go?</h2>
          <p className="mt-1 text-[14px] text-charcoal-500">Only organisations that accept your items are shown, ranked by how well their current needs fit.</p>
        </div>
        <div className="flex rounded-full border border-forest/15 bg-white p-1" role="radiogroup" aria-label="Allocation">
          {(['single', 'split'] as const).map((m) => (
            <button key={m} role="radio" aria-checked={draft.mode === m} onClick={() => update({ mode: m })} className={cx('rounded-full px-4 py-2 text-[13px] font-bold transition', draft.mode === m ? 'bg-forest text-ivory' : 'text-forest')}>
              {m === 'single' ? 'One organisation' : 'Split across several'}
            </button>
          ))}
        </div>
      </div>

      {draft.mode === 'single' ? (
        <div className="mt-8 grid gap-3 lg:grid-cols-2">
          {!list.length && <Notice tone="warn" title="No organisation accepts this combination">Go back and adjust your items, or try splitting them.</Notice>}
          {list.map(({ org, fits }) => {
            const selected = draft.orgId === org.id
            return (
              <button key={org.id} onClick={() => assignAll(org.id)} aria-pressed={selected} className={cx('card p-5 text-left transition hover:shadow-lift', selected && 'border-forest ring-2 ring-forest/15')}>
                <div className="flex items-start gap-3">
                  <span className={cx('mt-1 grid h-5 w-5 shrink-0 place-items-center rounded-full border-2', selected ? 'border-forest bg-forest' : 'border-forest/25')}>{selected && <Check className="h-3 w-3 text-ivory" strokeWidth={3} />}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2"><p className="font-display text-xl text-forest">{org.name}</p>{org.isDemo && <DemoTag />}</div>
                    <p className="mt-0.5 text-[13px] text-charcoal-500">{ORG_TYPES[org.type]} · {org.locality} · <VerificationBadge org={org} compact /></p>
                    <ul className="mt-3 space-y-1.5">
                      {draft.items.map((i) => {
                        const p = policyProblems(i, org)
                        const need = org.needs.find((n) => n.categoryId === i.categoryId)
                        return (
                          <li key={i.key} className={cx('flex items-start gap-2 text-[13px]', p.length ? 'text-coral-700' : 'text-charcoal-600')}>
                            {p.length ? <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-forest-400" />}
                            <span><b>{i.name || categoryById(i.categoryId).short}</b> — {p.length ? p[0] : need ? `matches current need: ${need.title.toLowerCase()}` : 'generally accepted'}</span>
                          </li>
                        )
                      })}
                    </ul>
                    <p className="mt-3 text-[12px] font-bold text-forest-400">{fits}/{draft.items.length} items accepted</p>
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      ) : (
        <div className="mt-8 space-y-3">
          {draft.items.map((i) => {
            const options = orgs.filter((o) => o.policies.some((p) => p.categoryId === i.categoryId && policyAccepts(p)))
            const cur = orgs.find((o) => o.id === i.orgId)
            const p = cur ? policyProblems(i, cur) : []
            return (
              <div key={i.key} className="card flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
                <span className={cx('grid h-10 w-10 shrink-0 place-items-center rounded-xl', CATEGORY_TINT[i.categoryId].bg, CATEGORY_TINT[i.categoryId].fg)}><CategoryIcon id={i.categoryId} /></span>
                <div className="min-w-0 flex-1">
                  <p className="text-[14.5px] font-bold text-forest">{i.name}</p>
                  <p className="text-[12.5px] text-charcoal-500">{i.quantity} {UNITS[i.unit]} · {CONDITIONS[i.condition]}</p>
                  {p.length > 0 && <p className="mt-1 text-[12.5px] font-semibold text-coral-700">{p[0]}</p>}
                </div>
                <Select aria-label={`Organisation for ${i.name}`} value={i.orgId ?? ''} onChange={(e) => update({ items: draft.items.map((x) => (x.key === i.key ? { ...x, orgId: e.target.value || undefined } : x)) })} className="sm:w-80">
                  <option value="">Choose organisation…</option>
                  {options.map((o) => {
                    const bad = policyProblems(i, o)
                    return <option key={o.id} value={o.id} disabled={bad.length > 0}>{o.name} ({o.locality}){bad.length ? ' — rules not met' : ''}</option>
                  })}
                </Select>
              </div>
            )
          })}
        </div>
      )}

      {blocked.length > 0 && (draft.mode === 'split' || draft.orgId) && (
        <div className="mt-6"><Notice tone="bad" icon={<AlertTriangle className="h-4 w-4" />} title={`${blocked.length} item${blocked.length > 1 ? 's' : ''} can’t go to the selected organisation`}>
          {draft.mode === 'single' ? 'Switch to “Split across several” to send those items elsewhere, or go back and remove them.' : 'Choose a compatible organisation for every item.'}
        </Notice></div>
      )}
      <NavButtons back={() => update({ step: 0 })} next={goNext} disabled={!ok} />
    </div>
  )
}

/* ------------------------------------------------------------ step 3 */

function StepDetails({ draft, update, orgs }: { draft: Draft; update: (p: Partial<Draft>) => void; orgs: PublicOrganization[] }) {
  const { session } = useSession()
  const { data: addresses } = useData((b) => b.listMyAddresses(), [session?.user.id], { enabled: !!session })
  const orgIds = [...new Set(draft.items.map((i) => i.orgId!))]
  const needsPickup = orgIds.some((id) => draft.methods[id] === 'partner_pickup')
  const d = draft.donor
  const a = draft.pickup
  const setDonor = (p: Partial<Draft['donor']>) => update({ donor: { ...d, ...p } })
  const setPickup = (p: Partial<Draft['pickup']>) => update({ pickup: { ...a, ...p } })

  useEffect(() => {
    if (session && !d.fullName) setDonor({ fullName: session.user.fullName, email: session.user.email ?? '' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session])

  const errors: Record<string, string | null> = {
    fullName: d.fullName.trim().length < 2 ? 'Enter your full name.' : null,
    email: d.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(d.email) ? 'That email address does not look right.' : d.contactMethod === 'email' && !d.email ? 'Add an email to be contacted by email.' : null,
    line1: needsPickup && a.line1.trim().length < 5 ? 'Enter the flat / house, building and street.' : null,
    locality: needsPickup && !localityByName(a.locality) ? 'Choose your locality.' : null,
    pinCode: needsPickup && !/^41\d{4}$/.test(a.pinCode) ? 'Pune PIN codes look like 411038.' : null,
  }
  const caps = useAuthCaps()
  const verified = !!session && (session.user.phoneVerified || (!!caps && !caps.requirePhoneForDonation && !!session.user.emailVerified))
  const ok = verified && Object.values(errors).every((e) => !e) && draft.consent
  const [showErr, setShowErr] = useState(false)
  const e = (k: string) => (showErr ? errors[k] : null)

  return (
    <div className="grid gap-10 lg:grid-cols-[1.2fr_1fr]">
      <div className="space-y-8">
        <section className="card space-y-4 p-6 sm:p-7">
            <h2 className="font-display text-2xl text-forest">About you</h2>
            <Field label="Full name" required error={e('fullName')}>{(id) => <Input id={id} value={d.fullName} onChange={(x) => setDonor({ fullName: x.target.value })} autoComplete="name" />}</Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Email" hint="Optional — for receipts" error={e('email')}>{(id) => <Input id={id} type="email" value={d.email} onChange={(x) => setDonor({ email: x.target.value })} autoComplete="email" />}</Field>
              <Field label="Preferred contact">{(id) => <Select id={id} value={d.contactMethod} onChange={(x) => setDonor({ contactMethod: x.target.value as ContactMethod })}><option value="phone">Phone call</option><option value="sms">SMS</option><option value="whatsapp">WhatsApp</option><option value="email">Email</option></Select>}</Field>
            </div>
          </section>
        <section className="card p-6 sm:p-7">
          <h2 className="flex items-center gap-2 font-display text-2xl text-forest"><Phone className="h-5 w-5" /> {session ? 'Verify your contact' : 'Sign in to continue'}</h2>
          {!session ? (
            <>
              <p className="mt-1 mb-5 text-[14px] text-charcoal-500">Your draft is kept while you sign in or create an account. Your contact details are never shown publicly.</p>
              <AuthPanel onDone={() => undefined} initialMode="signup" signupName={d.fullName.trim()} redirectPath="/donate" />
            </>
          ) : verified ? (
            <p className="mt-3 flex items-center gap-2 text-[14px] text-charcoal-600"><CheckCircle2 className="h-4 w-4 text-forest-400" /> {session.user.phoneVerified ? <>Verified as <b className="text-forest">{maskPhone(session.user.phone)}</b></> : <>Verified email <b className="text-forest">{session.user.email}</b></>}</p>
          ) : caps?.requirePhoneForDonation ? (
            <>
              <p className="mt-1 mb-5 text-[14px] text-charcoal-500">We need a verified mobile number before anyone is asked to collect from you. It is shared only with your assigned delivery partner while the job is active.</p>
              <PhoneVerifyForm />
            </>
          ) : (
            <div className="mt-3"><Notice tone="warn" title="Confirm your email first">Open the confirmation link we emailed to {session.user.email}, then reload this page.</Notice></div>
          )}
        </section>

        <fieldset disabled={!verified} className="space-y-8 disabled:opacity-50">


          <section className="card space-y-4 p-6 sm:p-7">
            <h2 className="font-display text-2xl text-forest">Delivery</h2>
            {orgIds.map((id) => {
              const o = orgs.find((x) => x.id === id)!
              return (
                <div key={id} className="rounded-2xl bg-ivory p-4">
                  <p className="text-[14px] font-bold text-forest">{o.name}</p>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {(['partner_pickup', 'donor_dropoff'] as const).map((m) => {
                      const avail = o.deliveryMethods.includes(m)
                      const sel = draft.methods[id] === m
                      return (
                        <button key={m} type="button" disabled={!avail} onClick={() => update({ methods: { ...draft.methods, [id]: m } })} aria-pressed={sel} className={cx('flex items-center gap-3 rounded-2xl border bg-white p-3 text-left text-[13.5px] transition disabled:opacity-40', sel ? 'border-forest ring-2 ring-forest/10' : 'border-forest/10')}>
                          {m === 'partner_pickup' ? <Truck className="h-5 w-5 text-forest" /> : <Store className="h-5 w-5 text-forest" />}
                          <span><b className="block text-forest">{m === 'partner_pickup' ? 'Pickup by partner' : 'I’ll drop it off'}</b><span className="text-[12px] text-charcoal-500">{avail ? (m === 'partner_pickup' ? 'From your address' : o.dropoffHours ?? 'During drop-off hours') : 'Not offered'}</span></span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            })}
            {needsPickup && (
              <div className="space-y-4 pt-2">
                {addresses && addresses.length > 0 && (
                  <Field label="Use a saved address">{(id) => (
                    <Select id={id} value="" onChange={(x) => { const s = addresses.find((v) => v.id === x.target.value); if (s) setPickup({ line1: s.line1, landmark: s.landmark ?? '', locality: s.locality, pinCode: s.pinCode, instructions: s.instructions ?? '' }) }}>
                      <option value="">Choose…</option>
                      {addresses.map((s) => <option key={s.id} value={s.id}>{s.line1}, {s.locality}</option>)}
                    </Select>
                  )}</Field>
                )}
                <Field label="Pickup address" required error={e('line1')} hint="Flat / house no., building, street">{(id) => <Input id={id} value={a.line1} onChange={(x) => setPickup({ line1: x.target.value })} autoComplete="street-address" />}</Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Pune locality" required error={e('locality')}>{(id) => (
                    <Select id={id} value={a.locality} onChange={(x) => { const l = localityByName(x.target.value); setPickup({ locality: x.target.value, pinCode: a.pinCode || l?.pin || '' }) }}>
                      <option value="">Choose locality…</option>
                      {LOCALITIES.map((l) => <option key={l.name}>{l.name}</option>)}
                    </Select>
                  )}</Field>
                  <Field label="PIN code" required error={e('pinCode')}>{(id) => <Input id={id} value={a.pinCode} onChange={(x) => setPickup({ pinCode: x.target.value.replace(/\D/g, '').slice(0, 6) })} inputMode="numeric" autoComplete="postal-code" />}</Field>
                </div>
                <Field label="Landmark">{(id) => <Input id={id} value={a.landmark} onChange={(x) => setPickup({ landmark: x.target.value })} />}</Field>
                <Field label="Pickup instructions" hint="Gate code, floor, whom to ask for…">{(id) => <Textarea id={id} value={a.instructions} onChange={(x) => setPickup({ instructions: x.target.value })} className="min-h-[72px]" />}</Field>
              </div>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={needsPickup ? 'Preferred pickup date' : 'Preferred drop-off date'} required>{(id) => <Input id={id} type="date" min={localDateIso(addDays(new Date(), 1))} max={localDateIso(addDays(new Date(), 14))} value={draft.preferredDate} onChange={(x) => update({ preferredDate: x.target.value })} />}</Field>
              <Field label="Time slot" required>{(id) => <Select id={id} value={draft.preferredSlot} onChange={(x) => update({ preferredSlot: x.target.value })}>{PICKUP_SLOTS.map((s) => <option key={s}>{s}</option>)}</Select>}</Field>
            </div>
            <Field label="Note for the organisation">{(id) => <Textarea id={id} value={draft.notes} onChange={(x) => update({ notes: x.target.value })} className="min-h-[72px]" />}</Field>
          </section>

          <section className="card p-6 sm:p-7">
            <Checkbox checked={draft.consent} onChange={(v) => update({ consent: v })}>
              I agree to the <Link to="/privacy" target="_blank" className="link-u font-bold text-forest">privacy policy</Link> and <Link to="/terms" target="_blank" className="link-u font-bold text-forest">terms</Link>. I confirm the items are mine to give, clean, safe and as described. My phone and address are shared only with the assigned delivery partner while the job is active.
            </Checkbox>
            {showErr && !draft.consent && <p className="mt-2 text-[12.5px] font-semibold text-coral-700">Please accept to continue.</p>}
          </section>
        </fieldset>
        <NavButtons back={() => update({ step: 1 })} next={() => (ok ? update({ step: 3 }) : setShowErr(true))} nextLabel="Review" disabled={!verified} />
      </div>
      <Summary draft={draft} orgs={orgs} />
    </div>
  )
}

function Summary({ draft, orgs }: { draft: Draft; orgs: PublicOrganization[] }) {
  const groups = [...new Set(draft.items.map((i) => i.orgId))].map((id) => ({ org: orgs.find((o) => o.id === id), items: draft.items.filter((i) => i.orgId === id) }))
  return (
    <aside className="lg:sticky lg:top-24 lg:self-start">
      <div className="card p-6">
        <p className="text-[12px] font-bold uppercase tracking-wider text-charcoal-500">Your donation</p>
        <div className="mt-4 space-y-5">
          {groups.map((g) => (
            <div key={g.org?.id ?? 'none'}>
              <p className="flex items-center gap-2 font-display text-lg text-forest">{g.org?.name ?? 'Unassigned'}</p>
              <p className="text-[12px] text-charcoal-500">{g.org && (draft.methods[g.org.id] === 'donor_dropoff' ? 'You drop off' : 'Partner pickup')}</p>
              <ul className="mt-2 space-y-1.5">
                {g.items.map((i) => (
                  <li key={i.key} className="flex items-center gap-2 text-[13.5px] text-charcoal-600"><CategoryIcon id={i.categoryId} className="h-4 w-4 text-forest-400" /> <span className="flex-1 truncate">{i.name}</span> <span className="font-semibold">{i.quantity} {UNITS[i.unit]}</span></li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </aside>
  )
}

/* ------------------------------------------------------------ step 4 */

function StepReview({ draft, update, orgs, onDone }: { draft: Draft; update: (p: Partial<Draft>) => void; orgs: PublicOrganization[]; onDone: (r: DonationRequest[]) => void }) {
  const backend = useBackend()
  const { run, busy } = useAction()
  const [error, setError] = useState<string | null>(null)
  const orgIds = [...new Set(draft.items.map((i) => i.orgId!))]
  const needsPickup = orgIds.some((id) => draft.methods[id] === 'partner_pickup')
  const submit = async () => {
    setError(null)
    const r = await run('submit', () =>
      backend.submitDonation({
        clientRequestId: draft.clientRequestId,
        items: draft.items.map(({ key: _k, orgId, ...i }) => ({ ...i, orgId: orgId! })),
        methods: draft.methods,
        donor: { fullName: draft.donor.fullName, email: draft.donor.email || undefined, contactMethod: draft.donor.contactMethod },
        pickup: needsPickup ? draft.pickup : undefined,
        preferredDate: draft.preferredDate,
        preferredSlot: draft.preferredSlot,
        notes: draft.notes,
        consent: draft.consent,
      }),
    )
    if (r.ok) onDone(r.value)
    else setError(r.error)
  }
  return (
    <div className="grid gap-10 lg:grid-cols-[1.2fr_1fr]">
      <div className="space-y-6">
        <section className="card p-6 sm:p-7">
          <h2 className="font-display text-2xl text-forest">Review</h2>
          <dl className="mt-5 grid gap-4 text-[14px] sm:grid-cols-2">
            <div><dt className="text-charcoal-500">Donor</dt><dd className="font-semibold text-forest">{draft.donor.fullName}</dd></div>
            <div><dt className="text-charcoal-500">Contact by</dt><dd className="font-semibold capitalize text-forest">{draft.donor.contactMethod}</dd></div>
            <div><dt className="text-charcoal-500">Preferred date</dt><dd className="font-semibold text-forest">{draft.preferredDate} · {draft.preferredSlot}</dd></div>
            {needsPickup && <div><dt className="text-charcoal-500">Pickup from</dt><dd className="font-semibold text-forest">{draft.pickup.line1}, {draft.pickup.locality} {draft.pickup.pinCode}</dd></div>}
          </dl>
        </section>
        <section className="card p-6 sm:p-7">
          <h3 className="text-[15px] font-bold text-forest">Fees</h3>
          <p className="mt-1.5 text-[14px] text-charcoal-600">
            {DELIVERY_FEE_CONFIG ? `Base ₹${DELIVERY_FEE_CONFIG.baseInr} + ₹${DELIVERY_FEE_CONFIG.perKmInr}/km; free under ${DELIVERY_FEE_CONFIG.freeUnderKm} km.` : 'No delivery or service fees are configured. You will not be charged anything for this request.'}
          </p>
          <h3 className="mt-6 text-[15px] font-bold text-forest">What happens next</h3>
          <ol className="mt-2 space-y-2 text-[14px] text-charcoal-600">
            <li className="flex gap-2"><span className="font-display text-coral-700">1</span> Your request is sent to the organisation. Status: <Badge tone="waiting">Awaiting organisation confirmation</Badge></li>
            <li className="flex gap-2"><span className="font-display text-coral-700">2</span> They accept or decline. {needsPickup ? 'If accepted, approved delivery partners can claim the pickup.' : 'If accepted, you drop the items off.'}</li>
            <li className="flex gap-2"><span className="font-display text-coral-700">3</span> The donation is completed only when the organisation confirms receipt.</li>
          </ol>
          <Notice tone="warn" icon={<Info className="h-4 w-4" />}>This is a request, not a confirmed pickup. Please keep the items ready but don’t hand them to anyone who is not shown as your assigned partner.</Notice>
        </section>
        {error && <Notice tone="bad" icon={<AlertTriangle className="h-4 w-4" />} title="Not submitted">{error}</Notice>}
        <NavButtons back={() => update({ step: 2 })} />
        <Button size="lg" className="w-full" onClick={submit} loading={busy === 'submit'} disabled={!draft.consent}>Submit donation request</Button>
      </div>
      <Summary draft={draft} orgs={orgs} />
    </div>
  )
}

function Submitted({ requests, orgs }: { requests: DonationRequest[]; orgs: PublicOrganization[] }) {
  return (
    <div className="container-x py-14 sm:py-20">
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="mx-auto max-w-2xl text-center">
        <span className="mx-auto grid h-16 w-16 place-items-center rounded-3xl bg-sage-100 text-forest"><PartyPopper className="h-7 w-7" /></span>
        <h1 className="display-md mt-6 text-forest">Request submitted</h1>
        <p className="mt-3 text-[16px] text-charcoal-600">We’ve notified {requests.length > 1 ? 'the organisations' : 'the organisation'}. Nothing is confirmed until they accept — we’ll notify you at each step.</p>
        <div className="mt-8 space-y-3 text-left">
          {requests.map((r) => (
            <div key={r.id} className="card flex flex-wrap items-center gap-3 p-5">
              <div className="min-w-0 flex-1">
                <p className="font-mono text-[13px] font-bold tracking-wider text-forest-400">{r.code}</p>
                <p className="font-display text-xl text-forest">{orgs.find((o) => o.id === r.orgId)?.name}</p>
                <div className="mt-1"><Badge tone="waiting">Awaiting organisation confirmation</Badge></div>
              </div>
              <Link to={`/track/${r.code}`} className={btn('primary', 'sm')}>Track</Link>
            </div>
          ))}
        </div>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link to={`/experience?request=${requests[0].code}`} className={btn('outline')}><Sparkles className="h-4 w-4" /> Watch the 3D story (preview)</Link>
          <Link to="/dashboard" className={btn('ghost')}>My donations</Link>
        </div>
      </motion.div>
    </div>
  )
}
