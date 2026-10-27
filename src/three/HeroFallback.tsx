import type { CategoryId } from '../lib/types'

/**
 * Static illustration used when WebGL is unavailable, the device is low-powered, the user prefers
 * reduced motion, or 3D is switched off. Every object is still a real, focusable control.
 */
export function HeroFallback({ onPick }: { onPick: (c: CategoryId) => void }) {
  const items: Array<{ cat: CategoryId; label: string; x: number; y: number; draw: JSX.Element }> = [
    { cat: 'books', label: 'Books', x: 70, y: 70, draw: <g><rect x="-30" y="0" width="60" height="12" rx="3" fill="#2E6152" /><rect x="-26" y="-12" width="56" height="12" rx="3" fill="#EAA58D" /><rect x="-24" y="-23" width="48" height="11" rx="3" fill="#E3C47A" /></g> },
    { cat: 'clothes', label: 'Clothes', x: 520, y: 60, draw: <g><rect x="-34" y="0" width="68" height="12" rx="6" fill="#8FB08C" /><rect x="-32" y="-12" width="64" height="12" rx="6" fill="#EAA58D" /><rect x="-30" y="-24" width="60" height="12" rx="6" fill="#F1EADC" stroke="#E4DFD1" /></g> },
    { cat: 'packaged_food', label: 'Food', x: 560, y: 200, draw: <g><rect x="-30" y="-30" width="34" height="46" rx="4" fill="#E9D3A8" /><rect x="-26" y="-18" width="26" height="16" fill="#2E6152" /><rect x="8" y="-14" width="24" height="30" rx="5" fill="#D9866B" /></g> },
    { cat: 'toys', label: 'Toys', x: 40, y: 215, draw: <g><rect x="-26" y="-6" width="22" height="22" rx="4" fill="#E89A62" /><rect x="0" y="-6" width="22" height="22" rx="4" fill="#8FB08C" /><rect x="-13" y="-28" width="22" height="22" rx="4" fill="#7FB6BC" /><circle cx="34" cy="8" r="11" fill="#EAA58D" /></g> },
    { cat: 'bedding', label: 'Blankets', x: 300, y: 28, draw: <g><rect x="-34" y="-14" width="68" height="28" rx="14" fill="#9C94C4" /><rect x="-18" y="-14" width="6" height="28" fill="#EAA58D" /><rect x="12" y="-14" width="6" height="28" fill="#EAA58D" /></g> },
  ]
  return (
    <div className="absolute inset-0 flex items-end justify-center">
      <svg viewBox="0 0 620 420" className="h-full max-h-[620px] w-full" role="img" aria-label="Illustration: a delivery volunteer carrying a donation box toward a community home, surrounded by donation items.">
        <defs>
          <radialGradient id="hf-sh" cx="50%" cy="50%" r="50%"><stop offset="0" stopColor="#173D32" stopOpacity=".25" /><stop offset="1" stopColor="#173D32" stopOpacity="0" /></radialGradient>
        </defs>
        <ellipse cx="310" cy="350" rx="290" ry="70" fill="#D8C9AE" />
        <ellipse cx="310" cy="335" rx="290" ry="66" fill="#CFDFCB" />
        <path d="M60 380 C 180 340, 260 330, 420 290" stroke="#EFE6D3" strokeWidth="26" fill="none" strokeLinecap="round" />
        {/* home */}
        <g transform="translate(420 200)">
          <ellipse cx="0" cy="100" rx="100" ry="18" fill="url(#hf-sh)" />
          <rect x="-70" y="10" width="140" height="90" rx="6" fill="#F1EADC" />
          <path d="M-86 14 L0 -48 L86 14 Z" fill="#EAA58D" />
          <rect x="-16" y="46" width="32" height="54" rx="4" fill="#173D32" />
          <rect x="-56" y="34" width="28" height="26" rx="3" fill="#FFE2B8" stroke="#173D32" strokeWidth="3" />
          <rect x="28" y="34" width="28" height="26" rx="3" fill="#FFE2B8" stroke="#173D32" strokeWidth="3" />
        </g>
        {/* tree */}
        <g transform="translate(140 230)"><rect x="-4" y="20" width="8" height="50" fill="#8A6A4C" /><circle cx="0" cy="10" r="34" fill="#8FB08C" /><circle cx="14" cy="-14" r="20" fill="#B7CDB5" /></g>
        {/* courier */}
        <g transform="translate(270 250)">
          <ellipse cx="0" cy="92" rx="38" ry="9" fill="url(#hf-sh)" />
          <rect x="-15" y="40" width="12" height="50" rx="6" fill="#3A4A44" />
          <rect x="3" y="40" width="12" height="50" rx="6" fill="#3A4A44" />
          <rect x="-24" y="-6" width="48" height="56" rx="22" fill="#173D32" />
          <circle cx="0" cy="-24" r="19" fill="#E9B996" />
          <path d="M-19 -28 A19 19 0 0 1 19 -28 Z" fill="#EAA58D" />
          <rect x="-4" y="-31" width="30" height="5" rx="2" fill="#D9866B" />
          <circle cx="-6" cy="-22" r="2" fill="#252925" /><circle cx="7" cy="-22" r="2" fill="#252925" />
          <rect x="-30" y="6" width="60" height="42" rx="4" fill="#C99A6B" />
          <rect x="-30" y="6" width="60" height="5" fill="#E8D6B8" />
          <path d="M0 34 l-7 -7 a4.5 4.5 0 0 1 7 -5 a4.5 4.5 0 0 1 7 5 z" fill="#EAA58D" />
        </g>
        {items.map((it) => (
          <g key={it.cat} transform={`translate(${it.x} ${it.y})`}>
            <a href={`/explore?cat=${it.cat}`} onClick={(e) => { e.preventDefault(); onPick(it.cat) }} aria-label={`Explore ${it.label}`} className="cursor-pointer [&:focus]:outline-none">
              <circle r="46" fill="#fff" opacity=".55" />
              {it.draw}
              <text y="40" textAnchor="middle" fontSize="12" fontWeight="700" fill="#173D32" fontFamily="Manrope">{it.label}</text>
            </a>
          </g>
        ))}
      </svg>
    </div>
  )
}
