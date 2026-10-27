import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Crosshair, Filter, Loader2, SearchX, SlidersHorizontal, X } from 'lucide-react'
import { OrgCard, SearchBar, PageHeader } from '../components/domain'
import { Button, EmptyState, ErrorState, Select, Skeleton, Toggle } from '../components/ui'
import { CategoryIcon } from '../components/CategoryIcon'
import { useData } from '../state/app'
import { CATEGORIES, ORG_TYPES } from '../data/categories'
import { LOCALITIES, localityByName } from '../data/localities'
import type { SortKey } from '../lib/search'
import type { CategoryId, OrgType } from '../lib/types'
import { cx } from '../lib/format'

const PAGE = 12
const list = (v: string | null) => (v ? v.split(',').filter(Boolean) : [])

export default function Explore() {
  const [params, setParams] = useSearchParams()
  const [geo, setGeo] = useState<{ lat: number; lng: number } | null>(null)
  const [geoState, setGeoState] = useState<'idle' | 'loading' | 'denied'>('idle')
  const [filtersOpen, setFiltersOpen] = useState(false)

  const q = params.get('q') ?? ''
  const cats = list(params.get('cat')) as CategoryId[]
  const locs = list(params.get('loc'))
  const types = list(params.get('type')) as OrgType[]
  const needsOnly = params.get('needs') === '1'
  const pickupOnly = params.get('pickup') === '1'
  const verifiedOnly = params.get('verified') === '1'
  const sort = (params.get('sort') as SortKey) || 'relevance'
  const from = params.get('from') ?? ''

  const set = (k: string, v: string | null) => {
    const p = new URLSearchParams(params)
    if (v) p.set(k, v)
    else p.delete(k)
    setParams(p, { replace: true })
  }
  const toggleIn = (k: string, cur: string[], v: string) => set(k, (cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v]).join(',') || null)

  const origin = useMemo(() => {
    if (from === 'me' && geo) return { ...geo, label: 'your location', precise: true }
    const l = from && from !== 'me' ? localityByName(from) : undefined
    return l ? { lat: l.lat, lng: l.lng, label: l.name, precise: false } : undefined
  }, [from, geo])

  const searchKey = [q, cats.join(), locs.join(), types.join(), needsOnly, pickupOnly, verifiedOnly, sort, origin?.lat, origin?.lng].join('|')
  const [limit, setLimit] = useState(PAGE)
  useEffect(() => setLimit(PAGE), [searchKey])
  const { data: res, loading, error, reload } = useData(
    (b) => b.searchOrganizations({ q, categories: cats, localities: locs, orgTypes: types, needsOnly, pickupOnly, verifiedOnly, sort, origin }, { offset: 0, limit }),
    [searchKey, limit],
  )
  const [shown, setShown] = useState(res)
  useEffect(() => { if (res) setShown(res) }, [res])
  const names = useMemo(() => shown?.results.map((r) => ({ name: r.org.name, slug: r.org.slug })) ?? [], [shown])
  const activeFilters = cats.length + locs.length + types.length + +needsOnly + +pickupOnly + +verifiedOnly

  const locate = () => {
    if (!navigator.geolocation) return setGeoState('denied')
    setGeoState('loading')
    navigator.geolocation.getCurrentPosition(
      (p) => { setGeo({ lat: p.coords.latitude, lng: p.coords.longitude }); setGeoState('idle'); set('from', 'me') },
      () => setGeoState('denied'),
      { timeout: 8000 },
    )
  }

  const filters = (
    <div className="space-y-7">
      <div>
        <p className="mb-3 text-[12px] font-bold uppercase tracking-wider text-charcoal-500">Item category</p>
        <div className="flex flex-wrap gap-1.5">
          {CATEGORIES.map((c) => (
            <button key={c.id} onClick={() => toggleIn('cat', cats, c.id)} aria-pressed={cats.includes(c.id)} className={cx('chip', cats.includes(c.id) && 'chip-on')}>
              <CategoryIcon id={c.id} className="h-3.5 w-3.5" /> {c.short}
            </button>
          ))}
        </div>
      </div>
      <div>
        <p className="mb-3 text-[12px] font-bold uppercase tracking-wider text-charcoal-500">Organisation type</p>
        <div className="flex flex-wrap gap-1.5">
          {(Object.keys(ORG_TYPES) as OrgType[]).map((t) => (
            <button key={t} onClick={() => toggleIn('type', types, t)} aria-pressed={types.includes(t)} className={cx('chip', types.includes(t) && 'chip-on')}>{ORG_TYPES[t]}</button>
          ))}
        </div>
      </div>
      <div>
        <label htmlFor="f-loc" className="mb-3 block text-[12px] font-bold uppercase tracking-wider text-charcoal-500">Pune locality</label>
        <Select id="f-loc" value="" onChange={(e) => e.target.value && toggleIn('loc', locs, e.target.value)}>
          <option value="">Add a locality…</option>
          {LOCALITIES.filter((l) => !locs.includes(l.name)).map((l) => <option key={l.name}>{l.name}</option>)}
        </Select>
        {locs.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {locs.map((l) => <button key={l} onClick={() => toggleIn('loc', locs, l)} className="chip chip-on">{l} <X className="h-3 w-3" /></button>)}
          </div>
        )}
      </div>
      <div className="space-y-4">
        {[
          { k: 'needs', v: needsOnly, label: 'Current needs only', hint: 'Hide orgs that only “generally accept” the item' },
          { k: 'pickup', v: pickupOnly, label: 'Pickup available', hint: 'A delivery partner can collect from you' },
          { k: 'verified', v: verifiedOnly, label: 'Verification up to date', hint: 'Exclude orgs whose annual review is overdue' },
        ].map((f) => (
          <div key={f.k} className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[14px] font-bold text-forest">{f.label}</p>
              <p className="text-[12.5px] text-charcoal-500">{f.hint}</p>
            </div>
            <Toggle checked={f.v} onChange={(v) => set(f.k, v ? '1' : null)} label={f.label} />
          </div>
        ))}
      </div>
      {activeFilters > 0 && <Button variant="ghost" size="sm" onClick={() => setParams(q ? { q } : {}, { replace: true })}>Clear all filters</Button>}
    </div>
  )

  return (
    <>
      <PageHeader eyebrow="Explore needs" title={<>Who needs <em className="text-coral-700">what you have?</em></>}>
        <div className="mt-8 max-w-3xl">
          <SearchBar initial={q} size="md" orgNames={names} onSearch={(v) => set('q', v || null)} />
        </div>
      </PageHeader>

      <div className="container-x grid gap-10 lg:grid-cols-[300px_1fr]">
        <aside className="hidden lg:block">
          <div className="sticky top-24">{filters}</div>
        </aside>

        <div>
          <div className="mb-6 flex flex-wrap items-center gap-3">
            <Button variant="outline" size="sm" className="lg:hidden" icon={<SlidersHorizontal className="h-4 w-4" />} onClick={() => setFiltersOpen(true)}>
              Filters{activeFilters ? ` (${activeFilters})` : ''}
            </Button>
            <p className="text-[14px] text-charcoal-600" aria-live="polite">
              {shown ? <><b className="text-forest">{shown.total}</b> organisation{shown.total === 1 ? '' : 's'}{shown.wantCats.length ? <> for <b className="text-forest">{shown.wantCats.map((c) => CATEGORIES.find((x) => x.id === c)!.short.toLowerCase()).join(' / ')}</b></> : null}{shown.origin && <> · near {shown.origin.label}</>}</> : 'Loading…'}
            </p>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <Select aria-label="Distance from" value={from} onChange={(e) => (e.target.value === 'me' ? locate() : set('from', e.target.value || null))} className="h-10 w-auto py-0 text-[13px]">
                <option value="">Distance from…</option>
                <option value="me">My current location</option>
                {LOCALITIES.map((l) => <option key={l.name} value={l.name}>{l.name}</option>)}
              </Select>
              <Select aria-label="Sort" value={sort} onChange={(e) => set('sort', e.target.value === 'relevance' ? null : e.target.value)} className="h-10 w-auto py-0 text-[13px]">
                <option value="relevance">Most relevant</option>
                <option value="urgency">Most urgent</option>
                <option value="distance" disabled={!shown?.distanceSortAvailable}>Nearest {shown?.distanceSortAvailable ? '' : '(choose a location)'}</option>
              </Select>
            </div>
          </div>
          {geoState === 'loading' && <p className="mb-4 flex items-center gap-2 text-[13px] text-charcoal-500"><Loader2 className="h-4 w-4 animate-spin" /> Getting your location…</p>}
          {geoState === 'denied' && <p className="mb-4 flex items-center gap-2 text-[13px] text-coral-700"><Crosshair className="h-4 w-4" /> Location unavailable — choose a locality instead.</p>}
          {origin && <p className="mb-4 text-[12.5px] text-charcoal-500">Distances are approximate — demo organisations are placed at their locality’s centre point.</p>}

          {error ? <ErrorState error={error} onRetry={reload} /> : !shown ? (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-[420px] rounded-3xl" />)}</div>
          ) : shown.total ? (
            <>
              <div className={cx('grid gap-4 transition-opacity md:grid-cols-2 xl:grid-cols-3', loading && 'opacity-60')} aria-busy={loading}>
                {shown.results.map((r, i) => <OrgCard key={r.org.id} result={r} index={i % PAGE} />)}
              </div>
              {shown.hasMore && (
                <div className="mt-8 flex flex-col items-center gap-2">
                  <Button variant="outline" loading={loading && limit > shown.results.length} onClick={() => setLimit((l) => l + PAGE)}>Show more organisations</Button>
                  <p className="text-[12.5px] text-charcoal-500">Showing {shown.results.length} of {shown.total}</p>
                </div>
              )}
            </>
          ) : (
            <EmptyState
              icon={<SearchX className="h-6 w-6" />}
              title={shown.conflict ? 'That search conflicts with your category filter' : 'No organisation matches that yet'}
              body={
                <>
                  {shown.conflict ? 'Your text search and the selected category point to different items. Clear one of them.' : 'Nobody on KindRoute currently needs or accepts this combination. Try a broader category, remove a locality, or turn off “current needs only”.'}
                  <div className="mt-5 flex flex-wrap justify-center gap-2">
                    {['Books', 'Blankets', 'Food packets', 'Hygiene kits'].map((s) => <Link key={s} to={`/explore?q=${encodeURIComponent(s)}`} className="chip">{s}</Link>)}
                  </div>
                </>
              }
              action={activeFilters > 0 ? <Button variant="outline" onClick={() => setParams(q ? { q } : {}, { replace: true })}>Clear filters</Button> : undefined}
            />
          )}
        </div>
      </div>

      {filtersOpen && (
        <div className="fixed inset-0 z-[70] flex items-end bg-forest-900/40 backdrop-blur-sm lg:hidden" onClick={(e) => e.target === e.currentTarget && setFiltersOpen(false)}>
          <div role="dialog" aria-modal="true" aria-label="Filters" className="max-h-[85vh] w-full overflow-y-auto rounded-t-4xl bg-ivory p-6">
            <div className="mb-6 flex items-center justify-between">
              <p className="flex items-center gap-2 font-display text-2xl text-forest"><Filter className="h-5 w-5" /> Filters</p>
              <button onClick={() => setFiltersOpen(false)} aria-label="Close filters" className="rounded-full p-2 hover:bg-forest/5"><X className="h-5 w-5" /></button>
            </div>
            {filters}
            <Button size="lg" className="mt-8 w-full" onClick={() => setFiltersOpen(false)}>Show {shown?.total ?? 0} results</Button>
          </div>
        </div>
      )}
    </>
  )
}
