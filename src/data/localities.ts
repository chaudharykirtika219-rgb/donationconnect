// Pune neighbourhoods with approximate centroid coordinates and a representative PIN.
// Centroids are approximations; any distance derived from them is labelled "approx.".

export interface Locality {
  name: string
  pin: string
  lat: number
  lng: number
  aliases?: string[]
}

export const LOCALITIES: Locality[] = [
  { name: 'Aundh', pin: '411007', lat: 18.559, lng: 73.8077 },
  { name: 'Baner', pin: '411045', lat: 18.559, lng: 73.7868 },
  { name: 'Bibwewadi', pin: '411037', lat: 18.471, lng: 73.864 },
  { name: 'Camp', pin: '411001', lat: 18.5196, lng: 73.878, aliases: ['pune camp', 'cantonment'] },
  { name: 'Chinchwad', pin: '411019', lat: 18.6447, lng: 73.7887 },
  { name: 'Deccan', pin: '411004', lat: 18.5167, lng: 73.8411, aliases: ['deccan gymkhana'] },
  { name: 'Hadapsar', pin: '411028', lat: 18.5089, lng: 73.926 },
  { name: 'Hinjewadi', pin: '411057', lat: 18.5912, lng: 73.7389 },
  { name: 'Katraj', pin: '411046', lat: 18.4575, lng: 73.8677 },
  { name: 'Kharadi', pin: '411014', lat: 18.5515, lng: 73.9348 },
  { name: 'Kondhwa', pin: '411048', lat: 18.4755, lng: 73.8913 },
  { name: 'Koregaon Park', pin: '411001', lat: 18.5362, lng: 73.894, aliases: ['kp'] },
  { name: 'Kothrud', pin: '411038', lat: 18.5074, lng: 73.8077 },
  { name: 'Pimpri', pin: '411018', lat: 18.6298, lng: 73.7997 },
  { name: 'Shivajinagar', pin: '411005', lat: 18.5308, lng: 73.8475 },
  { name: 'Sinhagad Road', pin: '411041', lat: 18.4766, lng: 73.8227 },
  { name: 'Viman Nagar', pin: '411014', lat: 18.5679, lng: 73.9143 },
  { name: 'Wakad', pin: '411057', lat: 18.5974, lng: 73.77 },
  { name: 'Warje', pin: '411058', lat: 18.4823, lng: 73.803 },
  { name: 'Yerawada', pin: '411006', lat: 18.5529, lng: 73.8796, aliases: ['yerwada'] },
]

export const localityByName = (name: string) =>
  LOCALITIES.find((l) => l.name.toLowerCase() === name.toLowerCase())

/** Haversine distance in km. */
export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLng = ((b.lng - a.lng) * Math.PI) / 180
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

export const isPunePin = (pin: string) => /^41\d{4}$/.test(pin.trim())
