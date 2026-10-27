// In-process stand-in for Supabase's HTTP services, used to run the REAL src/services/supabaseBackend.ts
// through the REAL @supabase/supabase-js client against the REAL migrations (PGlite).
//
// What is emulated (and therefore NOT proven by these tests):
//  * PostgREST — only POST /rest/v1/rpc/<fn> (named arguments → SQL call as `authenticated`/`anon` with JWT claims)
//  * GoTrue   — sign-up, password sign-in, sign-out, password recovery, update user, phone_change OTP
//  * Storage  — upload, signed URLs, remove; authorisation is delegated to the storage.objects RLS policies
//  * JWTs are unsigned. Signature verification, refresh tokens, emails and SMS delivery are not tested here.
import { createClient } from '@supabase/supabase-js'
import type { TestDb } from './harness'

const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
const tokenFor = (sub: string) => `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ sub, role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })}.fake-signature`
const subOf = (auth: string | null) => {
  const t = auth?.replace(/^Bearer /, '')
  if (!t || t.split('.').length !== 3) return null
  try {
    const p = JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString())
    return p.role === 'authenticated' ? (p.sub as string) : null
  } catch {
    return null
  }
}
const json = (body: unknown, status = 200) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

export interface FakeOptions {
  /** emulate "Confirm email" being enabled in Supabase Auth */
  confirmEmail?: boolean
}

export function fakeSupabase(db: TestDb, opts: FakeOptions = {}) {
  const passwords = new Map<string, string>() // user id → password
  const pendingPhone = new Map<string, { phone: string; code: string }>()
  const signatures = new Map<string, { argnames: string[]; argtypes: string[]; returns: string }>()
  const sent = { recoveryEmails: [] as string[], sms: [] as string[] }

  async function userJson(id: string) {
    const [u] = await db.admin<Record<string, unknown>>('select * from auth.users where id = $1', [id])
    return {
      id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, phone: u.phone ?? '', email_confirmed_at: u.email_confirmed_at, phone_confirmed_at: u.phone_confirmed_at,
      confirmed_at: u.email_confirmed_at ?? u.phone_confirmed_at, user_metadata: u.raw_user_meta_data, app_metadata: { provider: 'email' },
      identities: [{ id: u.id, user_id: u.id, provider: 'email', identity_data: {} }], created_at: u.created_at, updated_at: u.created_at,
    }
  }
  async function session(id: string) {
    return { access_token: tokenFor(id), token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: crypto.randomUUID(), user: await userJson(id) }
  }

  async function signature(fn: string) {
    if (!signatures.has(fn)) {
      const rows = await db.admin<{ argnames: string[] | null; argtypes: string; returns: string }>(
        `select proargnames as argnames, oidvectortypes(proargtypes) as argtypes, prorettype::regtype::text as returns from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and proname = $1`, [fn])
      if (!rows.length) return null
      signatures.set(fn, { argnames: rows[0].argnames ?? [], argtypes: rows[0].argtypes ? rows[0].argtypes.split(', ') : [], returns: rows[0].returns })
    }
    return signatures.get(fn)!
  }

  async function rpc(fn: string, args: Record<string, unknown>, sub: string | null) {
    const sig = await signature(fn)
    if (!sig) return json({ code: 'PGRST202', message: `Could not find the function public.${fn} in the schema cache` }, 404)
    const keys = Object.keys(args)
    const unknown = keys.filter((k) => !sig.argnames.includes(k))
    if (unknown.length) return json({ code: 'PGRST202', message: `Could not find the function public.${fn}(${keys.join(', ')}) in the schema cache` }, 404)
    const vals: unknown[] = []
    const parts = keys.map((k, i) => {
      const type = sig.argtypes[sig.argnames.indexOf(k)]
      const v = args[k]
      if (v === null || v === undefined) vals.push(null)
      else if (type === 'jsonb' || type === 'json') vals.push(JSON.stringify(v))
      else if (type.endsWith('[]')) vals.push(`{${(v as unknown[]).map((x) => `"${String(x).replace(/"/g, '\\"')}"`).join(',')}}`)
      else vals.push(typeof v === 'object' ? JSON.stringify(v) : String(v))
      return `${k} => $${i + 1}::${type}`
    })
    const call = `${fn}(${parts.join(', ')})`
    try {
      const v = await db.as(sub, (q) => q.rows<{ v: unknown }>(sig.returns === 'void' ? `select ${call}, null::jsonb as v` : `select to_jsonb(${call}) as v`, vals))
      return json(v[0]?.v ?? null)
    } catch (e) {
      const err = e as { message: string; code?: string }
      return json({ code: err.code ?? 'P0001', message: err.message, details: null, hint: null }, err.code === '42501' ? 403 : 400)
    }
  }

  async function storage(req: Request, path: string, sub: string | null) {
    if (!sub) return json({ statusCode: '403', error: 'Unauthorized', message: 'Missing token' }, 400)
    const m = /^\/storage\/v1\/object\/(sign\/)?([^/]+)\/?(.*)$/.exec(path)!
    const [, sign, bucket, name] = m
    if (req.method === 'POST' && !sign) {
      const form = await req.formData()
      const file = [...form.values()].find((v): v is File => typeof v !== 'string')!
      const [b] = await db.admin<{ file_size_limit: number; allowed_mime_types: string[] }>('select file_size_limit, allowed_mime_types from storage.buckets where id = $1', [bucket])
      if (!b) return json({ statusCode: '404', error: 'Bucket not found', message: 'Bucket not found' }, 400)
      if (file.size > b.file_size_limit) return json({ statusCode: '413', error: 'Payload too large', message: 'The object exceeded the maximum allowed size' }, 400)
      if (!b.allowed_mime_types.includes(file.type)) return json({ statusCode: '415', error: 'invalid_mime_type', message: `mime type ${file.type} is not supported` }, 400)
      try {
        await db.as(sub, (q) => q.rows('insert into storage.objects (bucket_id, name, metadata) values ($1, $2, $3)', [bucket, decodeURIComponent(name), JSON.stringify({ size: file.size, mimetype: file.type })]))
      } catch (e) {
        return json({ statusCode: '403', error: 'Unauthorized', message: (e as Error).message }, 400)
      }
      return json({ Key: `${bucket}/${name}`, Id: crypto.randomUUID() })
    }
    if (req.method === 'POST' && sign) {
      const body = (await req.json()) as { paths?: string[]; expiresIn: number }
      const paths = body.paths ?? [decodeURIComponent(name)]
      const visible = await db.as(sub, (q) => q.rows<{ name: string }>('select name from storage.objects where bucket_id = $1 and name = any($2::text[])', [bucket, `{${paths.map((p) => `"${p}"`).join(',')}}`]))
      const ok = new Set(visible.map((v) => v.name))
      const out = paths.map((p) => ({ path: p, signedURL: ok.has(p) ? `/object/sign/${bucket}/${p}?token=fake` : null, error: ok.has(p) ? null : 'Either the object does not exist or you do not have access to it' }))
      if (!body.paths) return ok.has(paths[0]) ? json({ signedURL: out[0].signedURL }) : json({ statusCode: '400', error: 'not_found', message: 'Object not found' }, 400)
      return json(out)
    }
    if (req.method === 'DELETE') {
      const { prefixes } = (await req.json()) as { prefixes: string[] }
      const removed = await db.as(sub, (q) => q.rows<{ name: string }>('delete from storage.objects where bucket_id = $1 and name = any($2::text[]) returning name', [bucket, `{${prefixes.map((p) => `"${p}"`).join(',')}}`]))
      return json(removed)
    }
    return json({ message: 'unsupported' }, 400)
  }

  async function auth(req: Request, path: string, sub: string | null) {
    const body = req.method === 'GET' ? {} : ((await req.json().catch(() => ({}))) as Record<string, any>)
    if (path === '/auth/v1/signup') {
      if (!body.password || body.password.length < 6) return json({ code: 'weak_password', msg: 'Password should be at least 6 characters.' }, 422)
      const [existing] = await db.admin<{ id: string }>('select id from auth.users where lower(email) = lower($1)', [body.email])
      if (existing) {
        // with confirmation enabled GoTrue returns an obfuscated user with no identities
        if (opts.confirmEmail) return json({ ...(await userJson(existing.id)), id: crypto.randomUUID(), identities: [] })
        return json({ code: 'user_already_exists', msg: 'User already registered' }, 422)
      }
      const id = await db.createUser({ email: body.email, name: body.data?.full_name, emailConfirmed: !opts.confirmEmail, meta: body.data ?? {} })
      passwords.set(id, body.password)
      return json(opts.confirmEmail ? await userJson(id) : await session(id))
    }
    if (path === '/auth/v1/token') {
      const [u] = await db.admin<{ id: string; email_confirmed_at: string | null }>('select id, email_confirmed_at from auth.users where lower(email) = lower($1)', [body.email ?? ''])
      if (!u || passwords.get(u.id) !== body.password) return json({ error: 'invalid_grant', error_description: 'Invalid login credentials', code: 'invalid_credentials', msg: 'Invalid login credentials' }, 400)
      if (!u.email_confirmed_at) return json({ error: 'invalid_grant', code: 'email_not_confirmed', msg: 'Email not confirmed' }, 400)
      return json(await session(u.id))
    }
    if (path === '/auth/v1/logout') return new Response(null, { status: 204 })
    if (path === '/auth/v1/recover') {
      sent.recoveryEmails.push(body.email)
      return json({})
    }
    if (path === '/auth/v1/user') {
      if (!sub) return json({ code: 'no_authorization', msg: 'This endpoint requires a valid Bearer token' }, 401)
      if (req.method === 'PUT') {
        if (body.password) passwords.set(sub, body.password)
        if (body.phone) {
          const code = String(100000 + Math.floor(Math.random() * 900000))
          pendingPhone.set(sub, { phone: body.phone.replace(/^\+/, ''), code })
          sent.sms.push(code)
        }
        if (body.email) sent.recoveryEmails.push(`change:${body.email}`)
      }
      return json(await userJson(sub))
    }
    if (path === '/auth/v1/verify' && body.type === 'phone_change') {
      // GoTrue matches the pending phone change by number + token
      const entry = [...pendingPhone.entries()].find(([, v]) => v.phone === String(body.phone).replace(/^\+/, '') && v.code === body.token)
      if (!entry) return json({ code: 'otp_expired', msg: 'Token has expired or is invalid' }, 403)
      pendingPhone.delete(entry[0])
      await db.admin('update auth.users set phone = $2, phone_confirmed_at = now() where id = $1', [entry[0], '+' + entry[1].phone])
      return json(await session(entry[0]))
    }
    return json({ code: 'unsupported', msg: `fake auth does not implement ${req.method} ${path}` }, 400)
  }

  const fetchImpl: typeof fetch = async (input, init) => {
    const req = new Request(input as RequestInfo, init)
    const url = new URL(req.url)
    const sub = subOf(req.headers.get('authorization'))
    if (url.pathname.startsWith('/rest/v1/rpc/')) {
      const args = req.method === 'GET' ? Object.fromEntries(url.searchParams) : ((await req.json().catch(() => ({}))) as Record<string, unknown>)
      return rpc(url.pathname.slice('/rest/v1/rpc/'.length), args, sub)
    }
    if (url.pathname.startsWith('/rest/v1/')) return json({ message: 'Direct table access is not used by KindRoute' }, 400)
    if (url.pathname.startsWith('/auth/v1/')) return auth(req, url.pathname, sub)
    if (url.pathname.startsWith('/storage/v1/')) return storage(req, url.pathname, sub)
    return json({ message: 'not found' }, 404)
  }

  /** A fresh browser-like supabase-js client (own in-memory session) that talks to the emulator. */
  function client() {
    const mem = new Map<string, string>()
    return createClient('http://kindroute.test', 'test-anon-key', {
      global: { fetch: fetchImpl },
      auth: { persistSession: true, autoRefreshToken: false, detectSessionInUrl: false, storage: { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, v), removeItem: (k) => void mem.delete(k) } },
    })
  }

  return { client, sent, passwords }
}
