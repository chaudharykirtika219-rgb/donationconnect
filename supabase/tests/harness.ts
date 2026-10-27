// Test harness: boots real PostgreSQL (PGlite), installs the Supabase shim and the four migrations,
// and runs queries *as* a given user (role `authenticated` + JWT `sub` claim) or as `anon`, exactly
// like PostgREST does. Everything else (RLS, grants, triggers, RPC checks) is the real migration code.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite, type Transaction } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'

const ROOT = join(__dirname, '..')
const MIGRATIONS = join(ROOT, 'migrations')

export async function bootDatabase() {
  const db = await PGlite.create({ extensions: { pgcrypto } })
  await db.exec(readFileSync(join(__dirname, 'supabase_shim.sql'), 'utf8'))
  for (const f of readdirSync(MIGRATIONS).filter((x) => x.endsWith('.sql')).sort()) await db.exec(readFileSync(join(MIGRATIONS, f), 'utf8'))
  return new TestDb(db)
}

export class TestDb {
  constructor(public raw: PGlite) {}

  /** Creates an auth user the way GoTrue would (the profile + donor role come from the migration's trigger). */
  async createUser(opts: { email?: string; phone?: string; name?: string; emailConfirmed?: boolean; phoneConfirmed?: boolean; meta?: Record<string, unknown> } = {}) {
    const meta = { full_name: opts.name ?? 'Test User', ...(opts.meta ?? {}) }
    const r = await this.raw.query<{ id: string }>(
      `insert into auth.users (email, phone, email_confirmed_at, phone_confirmed_at, raw_user_meta_data)
       values ($1, $2, case when $3 then now() end, case when $4 then now() end, $5) returning id`,
      [opts.email ?? null, opts.phone ?? null, opts.emailConfirmed ?? !!opts.email, opts.phoneConfirmed ?? !!opts.phone, JSON.stringify(meta)],
    )
    return r.rows[0].id
  }

  /** Runs fn inside a transaction as `authenticated` with the given user id (or as `anon` when null). */
  async as<T>(userId: string | null, fn: (q: Q) => Promise<T>): Promise<T> {
    return this.raw.transaction(async (tx) => {
      await tx.exec(`set local role ${userId ? 'authenticated' : 'anon'}`)
      await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(userId ? { sub: userId, role: 'authenticated' } : { role: 'anon' })])
      return fn(new Q(tx))
    })
  }

  /** Superuser (SQL editor / migrations) — for test setup only. */
  async admin<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
    return (await this.raw.query<T>(sql, params)).rows
  }

  rpc<T = unknown>(userId: string | null, fn: string, args: Record<string, unknown> = {}) {
    return this.as(userId, (q) => q.rpc<T>(fn, args))
  }
}

export class Q {
  constructor(private tx: Transaction) {}
  async rows<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
    return (await this.tx.query<T>(sql, params)).rows
  }
  /** Calls a function with named arguments, like supabase.rpc(fn, args). */
  async rpc<T = unknown>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
    const keys = Object.keys(args)
    const sql = `select ${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as v`
    const vals = keys.map((k) => {
      const v = args[k]
      return v !== null && typeof v === 'object' && !Array.isArray(v) ? JSON.stringify(v) : v
    })
    const r = await this.tx.query<{ v: T }>(sql, vals)
    return r.rows[0]?.v as T
  }
}
