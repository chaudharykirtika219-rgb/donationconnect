/** Minimal RFC-4180 CSV parser (quoted fields, escaped quotes, CRLF). Returns header-keyed rows. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"'
        i++
      } else if (ch === '"') quoted = false
      else field += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') {
      row.push(field)
      field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      if (row.some((c) => c.trim())) rows.push(row)
      row = []
      field = ''
    } else field += ch
  }
  row.push(field)
  if (row.some((c) => c.trim())) rows.push(row)
  if (!rows.length) return []
  const header = rows[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'))
  return rows.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()])))
}

/** Normalised key for duplicate detection: lowercase, alphanumerics only, common filler words removed. */
export function nameKey(name: string) {
  return name
    .toLowerCase()
    .replace(/['’]s\b/g, 's')
    .replace(/\b(the|home|homes|trust|foundation|society|centre|center|pune|for)\b/g, '')
    .replace(/[^a-z0-9]/g, '')
}
