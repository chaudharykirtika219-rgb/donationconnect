# KindRoute

A donation and community-care platform for Pune. Donors find verified children’s homes, orphanages, old-age homes, shelters, community kitchens and NGOs that need what they have. The receiving organisation confirms each request, a verified delivery partner picks the items up, and the organisation confirms receipt before the donation counts as completed.

The app runs in one of two modes:

| Mode | When | Data |
|---|---|---|
| **Demo** | No Supabase variables set | Fictional sample data in the browser's `localStorage`, clearly bannered. Codes and reset links appear in an on-screen "demo inbox". Nothing is sent. |
| **Supabase** | `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` set | Postgres, Auth and Storage in your Supabase project. Security is enforced by RLS and server-side functions. |

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # all automated tests (demo journeys + database + Supabase adapter)
npm run build      # type-check + production build
```

---

## 1. Connect your Supabase project

1. **Create a project** at supabase.com, using the Mumbai (ap-south-1) region. Create a *second* project for staging or demos; never seed demo data into production.
2. **Apply the migrations** (section 2).
3. **Configure Auth** (section 3).
4. **Set the environment variables.** Copy `.env.example` to `.env.local`:
   ```
   VITE_SUPABASE_URL=https://<project-ref>.supabase.co
   VITE_SUPABASE_ANON_KEY=<anon / publishable key>
   VITE_SUPABASE_PHONE_AUTH=false        # set to true only after SMS is configured and tested
   VITE_SUPABASE_EMAIL_CONFIRM=true      # must match Auth → "Confirm email"
   ```
   Both values are under Project Settings → API. The anon key is public by design; RLS protects the data.
   - **Never use the service-role key or an `sb_secret_…` key here.** The app refuses to start if it detects one.
   - If only one variable is set, or the URL is malformed, the app shows a configuration screen instead of crashing.
5. **Restart** `npm run dev`. The demo banner disappears.
6. **Create the first administrator** (section 4).
7. **Add real organisations** (section 5).

## 2. Run the database migrations

The files in `supabase/migrations/` must run in order:

| File | Contents |
|---|---|
| `20261027000100_schema.sql` | enums, all tables, constraints, indexes, `updated_at` triggers, `app_settings` |
| `20261027000200_workflow.sql` | role helpers, JSON read models, the status state machine, donor, organisation and partner RPCs, auth triggers |
| `20261027000300_admin.sql` | admin RPCs and the `kr_bootstrap_first_admin` function |
| `20261027000400_security.sql` | RLS on every table, privilege lockdown, private storage buckets and policies, realtime publication, category seed |

**With the Supabase CLI:**
```bash
npx supabase login
npx supabase link --project-ref <project-ref>
npx supabase db push
```

**Without the CLI:** open each file in order in Dashboard → SQL Editor and run it.

**Then:**
- Check Database → Publications. `supabase_realtime` should include `notifications`, `donation_status_events` and `delivery_jobs`.
- Check Storage. Three private buckets should exist: `verification-docs` (PDF/JPG/PNG/WebP, 5 MB), `donation-photos` and `delivery-proofs` (JPG/PNG/WebP, 2 MB).

## 3. Enable authentication providers

**Email and password (required):** Authentication → Providers → Email.
- Keep **Confirm email** on and keep `VITE_SUPABASE_EMAIL_CONFIRM=true`.
- Set the minimum password length to 8. The app also requires letters and numbers.
- Authentication → URL Configuration: set **Site URL** to your domain. Add `https://<domain>/reset-password` and `https://<domain>/dashboard` to the **Redirect URLs** (plus the `http://localhost:5173` equivalents for development).
- Authentication → SMTP: Supabase's built-in email sender is heavily rate-limited, so connect a real SMTP provider (Resend, Postmark, Amazon SES or similar) before launch.

**Phone OTP (optional, recommended):** Authentication → Providers → Phone. Connect Twilio, MessageBird, Vonage or Textlocal, then set `VITE_SUPABASE_PHONE_AUTH=true`.
- Until you do, the app hides "Mobile code" sign-in and says SMS isn't configured. It never simulates a successful code in Supabase mode.
- Indian SMS requires DLT template registration with your provider.

**Donation verification policy:** by default donors must verify a phone number before submitting, because the delivery partner needs it. If you can't configure SMS yet, an admin can allow confirmed-email donors instead:
```sql
update app_settings set require_phone_for_donation = false;
```

## 4. Create the first administrator securely

Admin rights can't be obtained from the app: `user_roles` has no client write path, and sign-up only ever grants `donor`.

1. Sign up in the app with the administrator's email and click the confirmation link.
2. In Dashboard → SQL Editor (which runs as the `postgres` owner), run:
   ```sql
   select kr_bootstrap_first_admin('admin@your-domain.org');
   ```
   - It works only for a confirmed email.
   - It refuses to run if an admin already exists.
   - It isn't callable through the API: `EXECUTE` is revoked from `anon` and `authenticated`.
3. Sign out and back in. The account now has the Admin dashboard.

Further admins are granted by an existing admin calling `admin_grant_admin(user_id, note)`. The account must be verified, and the grant is written to the audit log.

## 5. Add and verify real Pune organisations

No real organisation data is included. Two supported routes:

**A. The organisation registers itself**
1. Someone from the organisation signs up, choosing "Register an organisation", and fills in the registration form.
2. They upload a registration certificate and an address proof (Verification tab). Files go to the private `verification-docs` bucket.
3. An admin opens Admin → Organisations → **Start review** (status becomes `under_review`) and views the documents through 60-second signed links.
4. The admin independently verifies the organisation:
   - registration with the Charity Commissioner, NGO Darpan or the Registrar of Companies;
   - the address, by visit or a geotagged photo;
   - a phone call to the public number.
5. The admin accepts at least one document, ticks both checks and approves. The server refuses approval without an accepted document and both checks.
6. Only `approved` organisations appear publicly. Rejected and suspended ones see a clear status and the reviewer's note in their portal.

**B. Bulk import from your own research** (Admin → CSV import)
- Columns: `name,type,locality,address,pin_code,phone,email,accepted_categories` (see `public/sample-org-import.csv`).
- Rows are staged, not published. Duplicates are flagged by name and phone.
- For each row, record that you verified the address, contact details and the organisation's **permission to be listed**, plus an evidence note (what was checked, by whom, when). Only then can it be published.

Re-verification: approved organisations get `next_review_due` one year out (imports: 180 days). Search can filter out overdue ones.

## 6. Demo and staging data

`supabase/seed/demo_seed.sql` adds 4 fictional organisations, every row flagged `is_demo` and labelled "(demo)", with `example.org` email addresses and unassignable `+91 00000` numbers.
- It refuses to run unless you first set `update app_settings set environment = 'staging';` on a staging project.
- It needs an admin to exist.
- Public impact counters exclude demo records.

---

## Architecture

```
src/
  services/backend.ts         the single contract the UI uses (auth, search, workflow, admin)
  services/supabaseBackend.ts Supabase implementation: RPC calls, private uploads, signed URLs, realtime
  services/demoBackend.ts     browser-only implementation for demo mode (a simulation, NOT a security boundary)
  services/index.ts           picks the backend; validates env (refuses service-role keys)
  components/auth.tsx         email/password + phone OTP panel, phone verification, RequireAuth route guard
  pages/Login.tsx, ResetPassword.tsx   sign-in, sign-up with intent-based redirect, password reset
  lib/status.ts               the 13-status state machine (mirrored by kr_transition_allowed in SQL)
  lib/search.ts               query parsing → structured plan; standing labels; freshness rule
  lib/validation.ts           item safety, password rule, upload type/size rules (mirror the SQL/bucket rules)
supabase/
  migrations/                 4 ordered migrations
  seed/demo_seed.sql          staging-only fictional data
  tests/                      database + Supabase-adapter integration tests
```

**Security model (Supabase mode)**
- **Default deny.** RLS is on for all 21 tables. Clients have `SELECT` only, filtered by policies, and no `INSERT`, `UPDATE` or `DELETE` on any table.
- **Every write is a server-side RPC.** Each is a `SECURITY DEFINER` function with a fixed `search_path` that checks the caller's role and the organisation or job relationship. `EXECUTE` is revoked from everyone and granted back only on the client API, so internal helpers like `kr_apply_transition` can't be called directly.
- **Roles live only in `user_roles`.** User metadata is never trusted. Organisation-staff rights only reach a pending organisation, and accepting donations requires `approved`. The `delivery_partner` role is granted only by `admin_review_partner`.
- **Status changes go through one function,** `kr_apply_transition`. It locks the row, validates against the state machine, stamps `submitted_at`, `accepted_at` and so on, writes `donation_status_events` and `audit_logs`, and notifies participants.
- **Job claims are an atomic conditional update** (`assignment_status = 'open' AND version = expected`). Only one partner can win; the others get `conflict`.
- **Duplicate submissions are prevented.** The client sends a `clientRequestId` per draft. The server serialises on it with an advisory lock, a unique index backs it up, and a retry returns the original request.
- **Responses are redacted per viewer:**
  - The organisation sees the donor's first name and locality.
  - The assigned partner sees the address and phone only while the job is active.
  - Public search never includes registration numbers, verification notes, documents or donor data.
- **Storage:** private buckets with MIME and size limits; uploads only into `<uid>/…`. RPCs reject file paths outside the caller's folder. Read access follows the request's participants. Files are served through short-lived signed URLs.
- **Realtime:** `notifications`, `donation_status_events` and `delivery_jobs` push changes (RLS applies). Screens also poll every 10–20 s as a fallback.

**Schema mapping.** Where an equivalent structure already existed, the name was kept:
- `user_roles.role = 'org_staff'` is the "organization" role, linked to `org_id`.
- `pickup_date` and `pickup_time_slot` appear in the client as `preferredDate` and `preferredSlot`.
- `delivery_jobs.assignment_status` is `open`, `claimed`, `done` or `cancelled`.
- Disputes use the `failed` status plus a `reports_and_disputes` row. Rescheduling is `failed` → `awaiting_delivery_partner` (re-offer), or a partner releasing the job.
- Pickup and delivery proofs are kept both on `delivery_jobs` and in `donation_proofs`, which also holds receipt photos.

---

## Test results

`npm test` runs 53 automated tests, all passing:

| Suite | Count | What it covers | Against |
|---|---|---|---|
| `src/tests/journeys.test.ts` | 8 | demo-mode journeys | the demo backend |
| `supabase/tests/database.test.ts` | 37 | A–O at the data layer (details below) | the **real migrations on real PostgreSQL** (PGlite 0.5, Postgres 18), called as `anon` or `authenticated` with JWT claims, the way PostgREST calls them |
| `supabase/tests/supabaseBackend.contract.test.ts` | 8 | A–L end to end | the **real `supabaseBackend.ts` through the real `supabase-js` client** against the same real SQL. Only the HTTP layer (PostgREST RPC, GoTrue, Storage) is an in-process emulator (`fakeSupabase.ts`). |

The database suite covers:
- sign-up profile and role creation; metadata can't grant admin;
- org pending → under review → approved or rejected;
- search: eligibility, freshness, temporarily unavailable, food policy, pagination;
- atomic and idempotent submission;
- org accept and reject, and cross-organisation isolation;
- single-winner claim, unapproved partners blocked, full status history, only the organisation can complete;
- pickup address, document and storage isolation;
- privilege escalation and direct calls to internal functions rejected;
- suspended accounts, rate limit, and demo-seed isolation.

The contract suite covers: sign-up, duplicate account, wrong password, sign-out, session restore, password change, phone change, confirm-email mode, uploads with type rejection, signed URLs, search standing labels, the full delivery with photo proofs, and admin tools.

**Browser end-to-end** (headless Chrome, demo mode; scratchpad script, not part of the repo): all 11 journeys passed with no page errors.
- A–D: donate → accept → claim, pick up and deliver → confirm receipt; the organisation never sees the address.
- F: a donor is blocked from Admin.
- G: 3D story (see the first limitation below).
- Admin: approve and CSV import.
- Auth: email sign-up with org intent → wrong password → reset via the demo inbox → sign in → reload keeps the session.
- Org rules: three-state acceptance and search standing labels.
- P: mobile 390 px on Explore, Donate, Dashboard, Org portal and Login, with no horizontal overflow.
- H: the mobile menu opens.

**Not tested here:**
- **Live Supabase.** Without project credentials, nothing has run against hosted PostgREST, GoTrue, Storage or Realtime. JWT signature checks, email and SMS delivery, the storage service's own MIME enforcement and realtime events are untested. Run the test plan below once connected.
- **True parallel claims on separate connections.** PGlite has one connection, so concurrent claims were tested as interleaved transactions. Correctness rests on Postgres row locks (`UPDATE … WHERE assignment_status='open' AND version=$v`), which is standard behaviour but wasn't exercised with two real connections.
- **The full 3D story in headless Chrome.** Software WebGL renders at about 3 fps, which starves page timers. The scene was verified to start and drive the story phases; completion was verified via the 2D fallback. It completed in 3D in earlier runs and the 3D code is unchanged.

**After connecting Supabase:**
1. Sign up, confirm the email, and bootstrap yourself as admin.
2. Sign up a second account and register an organisation. Approve it as admin.
3. With a third account (donor), submit a donation.
4. Confirm that the org sees the request without the donor's address, and that a fourth account can't open `/track/<code>`.
5. Apply as a partner, approve, claim the job, deliver with a photo, and confirm receipt as the org.
6. In the SQL editor, confirm `select * from donation_status_events where donation_request_id = …` shows the full history.

## Working vs needs configuration

| Feature | Status |
|---|---|
| Demo mode (all journeys) | Working, tested in browser |
| Schema, RLS, workflow RPCs, storage policies | Working and tested on real Postgres; not yet applied to a live project |
| Supabase adapter (`supabaseBackend.ts`) | Tested through supabase-js against emulated HTTP; needs your project to verify live |
| Email/password sign-up, login, logout, reset, session persistence | Implemented; tested in demo and contract tests. Live use needs a project, redirect URLs and SMTP |
| Phone OTP sign-in and phone verification | Implemented; **needs an SMS provider** and `VITE_SUPABASE_PHONE_AUTH=true` |
| In-app notifications (persisted), realtime updates | Implemented; realtime needs the live project (polling fallback works) |
| SMS, email or push notifications for status changes | **Not implemented.** Needs an Edge Function or webhook with a provider |
| Live GPS, routing, delivery fees | Not implemented, by design. Tracking is status-based and labelled |
| Real organisation data | None included. Add it via section 5 |
| Legal (Privacy and Terms) | Drafts; need review, including under the DPDP Act 2023 |
