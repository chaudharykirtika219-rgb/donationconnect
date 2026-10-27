-- KindRoute 1/4 — types, tables, constraints, indexes.
-- Apply all migrations in order:  supabase db push   (or paste each file into the SQL editor, in order)
--
-- Design rules
--  * Clients never write donation state directly. All state changes go through SECURITY DEFINER
--    functions (migration 2) that check the caller's role and validate the transition.
--  * Row Level Security is enabled on every table (migration 3). Default deny: a table without a
--    policy for an operation rejects it.
--  * Server-controlled values (ids, timestamps, statuses) have defaults/triggers; clients cannot set them.
--
-- Naming: where an equivalent structure already existed in the app, its name was kept; see
-- README → "Schema mapping" for the correspondence with the Phase 2 specification.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- enums
create type app_role          as enum ('donor', 'org_staff', 'delivery_partner', 'admin');   -- org_staff = "organization" role
create type account_status    as enum ('active', 'suspended');
create type org_type          as enum ('children_home', 'orphanage', 'old_age_home', 'shelter', 'ngo', 'community_kitchen', 'food_bank', 'special_needs', 'other');
create type approval_status   as enum ('pending', 'under_review', 'needs_info', 'approved', 'rejected', 'suspended');
create type acceptance_status as enum ('accepts', 'does_not_accept', 'temporarily_unavailable');
create type need_status       as enum ('open', 'fulfilled', 'closed');
create type donation_status   as enum (
  'draft',
  'pending_organization_confirmation',
  'organization_accepted',
  'awaiting_delivery_partner',
  'delivery_partner_assigned',
  'pickup_scheduled',
  'picked_up',
  'in_transit',
  'delivered_pending_receipt_confirmation',
  'completed',
  'rejected',
  'cancelled',
  'failed'            -- failed delivery or "not received" dispute; can be re-offered (rescheduled) or cancelled
);
create type delivery_method   as enum ('partner_pickup', 'donor_dropoff');
create type urgency_level     as enum ('low', 'medium', 'high');
create type item_condition    as enum ('new', 'like_new', 'gently_used', 'needs_repair');
create type item_unit         as enum ('pieces', 'sets', 'pairs', 'bags', 'boxes', 'kg', 'litres', 'meals');
create type assignment_status as enum ('open', 'claimed', 'done', 'cancelled');
create type actor_kind        as enum ('donor', 'org', 'partner', 'admin', 'system');

create or replace function kr_touch() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

-- ---------------------------------------------------------------- settings (single row)
create table app_settings (
  id                         boolean primary key default true check (id),
  -- 'production' rejects the demo seed (supabase/seed/demo_seed.sql)
  environment                text not null default 'production' check (environment in ('production', 'staging', 'development')),
  need_freshness_days        int not null default 30 check (need_freshness_days between 1 and 365),
  -- when false, a confirmed email is enough to submit (use only if no SMS provider is available)
  require_phone_for_donation boolean not null default true,
  max_submissions_per_day    int not null default 5 check (max_submissions_per_day between 1 and 100),
  updated_at                 timestamptz not null default now()
);

-- ---------------------------------------------------------------- accounts
create table profiles (
  id             uuid primary key references auth.users(id) on delete cascade,
  full_name      text not null check (char_length(full_name) between 2 and 120),
  email          text check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]{2,}$'),
  email_verified boolean not null default false,
  phone_number   text unique,
  phone_verified boolean not null default false,
  avatar_url     text,
  account_status account_status not null default 'active',
  is_demo        boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table item_categories (
  id           text primary key check (id ~ '^[a-z_]{2,40}$'),
  slug         text generated always as (id) stored unique,
  name         text not null,
  short        text not null,
  description  text not null default '',
  default_unit item_unit not null default 'pieces',
  restricted   boolean not null default false,
  active       boolean not null default true,
  sort         int not null default 0,
  created_at   timestamptz not null default now()
);

create table organizations (
  id                  uuid primary key default gen_random_uuid(),
  owner_user_id       uuid references profiles(id) on delete set null,
  slug                text not null unique check (slug ~ '^[a-z0-9-]{2,60}$'),
  name                text not null check (char_length(name) between 3 and 140),
  organization_type   org_type not null,
  description         text not null default '',
  address             text not null,
  locality            text not null,
  city                text not null default 'Pune',
  state               text not null default 'Maharashtra',
  postal_code         text not null check (postal_code ~ '^41[0-9]{4}$'),
  lat                 double precision not null check (lat between 18.3 and 18.8),
  lng                 double precision not null check (lng between 73.6 and 74.1),
  coords_precision    text not null default 'locality' check (coords_precision in ('exact', 'locality')),
  public_contact_phone text,
  public_contact_email text,
  website             text,
  contact_verified    boolean not null default false,
  registration_type   text,
  registration_number text,
  verification_status approval_status not null default 'pending',
  verified_at         timestamptz,
  verified_by         uuid references profiles(id),
  verification_notes  text,        -- private: admins and the organisation's own staff only
  next_review_due     timestamptz,
  accepted_donation_methods delivery_method[] not null check (cardinality(accepted_donation_methods) > 0),
  dropoff_hours       text,
  pickup_slots        text[] not null default '{}',
  condition_rules     text not null default '',
  restrictions        text[] not null default '{}',
  show_impact         boolean not null default false,
  is_demo             boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  check (verification_status <> 'approved' or (verified_at is not null and verified_by is not null))
);
create unique index organizations_name_key on organizations (lower(regexp_replace(name, '[^a-zA-Z0-9]+', '', 'g')));

create table user_roles (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profiles(id) on delete cascade,
  role       app_role not null,
  org_id     uuid references organizations(id) on delete cascade,
  granted_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  check ((role = 'org_staff') = (org_id is not null))
);
create unique index user_roles_unique on user_roles (user_id, role, coalesce(org_id, '00000000-0000-0000-0000-000000000000'));

create table organization_verification_documents (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(id) on delete cascade,
  document_type  text not null check (char_length(document_type) between 2 and 80),
  file_name      text not null,
  storage_path   text not null,
  review_status  text not null default 'submitted' check (review_status in ('submitted', 'accepted', 'rejected')),
  reviewer_note  text,
  reviewed_by    uuid references profiles(id),
  reviewed_at    timestamptz,
  uploaded_by    uuid references profiles(id),
  uploaded_at    timestamptz not null default now(),
  retain_until   timestamptz not null default now() + interval '365 days'
);

create table organization_item_policies (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references organizations(id) on delete cascade,
  category_id           text not null references item_categories(id),
  acceptance_status     acceptance_status not null default 'accepts',
  condition_requirements item_condition[] not null default '{new,like_new,gently_used}',
  quantity_limit        int check (quantity_limit is null or quantity_limit between 1 and 10000),
  restrictions          text,
  min_shelf_life_days   int check (min_shelf_life_days is null or min_shelf_life_days >= 0),
  max_hours_since_prep  int check (max_hours_since_prep is null or max_hours_since_prep between 1 and 24),
  updated_at            timestamptz not null default now(),
  unique (org_id, category_id)
);

create table organization_needs (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references organizations(id) on delete cascade,
  category_id        text not null references item_categories(id),
  item_name          text not null check (char_length(item_name) between 3 and 140),
  description        text,
  tags               text[] not null default '{}',
  requested_quantity int check (requested_quantity is null or requested_quantity between 1 and 10000),
  quantity_unit      item_unit,
  fulfilled_quantity int not null default 0 check (fulfilled_quantity >= 0),
  urgency            urgency_level not null default 'medium',
  need_status        need_status not null default 'open',
  last_confirmed_at  timestamptz not null default now(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create table pickup_addresses (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references profiles(id) on delete cascade,
  address_line        text not null check (char_length(address_line) between 5 and 300),
  landmark            text,
  locality            text not null,
  postal_code         text not null check (postal_code ~ '^41[0-9]{4}$'),
  access_instructions text,
  created_at          timestamptz not null default now()
);

create table delivery_partners (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null unique references profiles(id) on delete cascade,
  full_name           text not null,
  phone               text,
  transport_type      text not null check (transport_type in ('bicycle', 'two_wheeler', 'three_wheeler', 'car', 'van')),
  service_localities  text[] not null default '{}',
  approval_status     approval_status not null default 'pending',
  review_note         text,
  availability_status boolean not null default false,
  is_demo             boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  check (approval_status = 'approved' or not availability_status)
);

create table partner_verification_documents (
  id            uuid primary key default gen_random_uuid(),
  partner_id    uuid not null references delivery_partners(id) on delete cascade,
  document_type text not null,
  file_name     text not null,
  storage_path  text not null,
  review_status text not null default 'submitted' check (review_status in ('submitted', 'accepted', 'rejected')),
  reviewer_note text,
  reviewed_by   uuid references profiles(id),
  reviewed_at   timestamptz,
  uploaded_at   timestamptz not null default now(),
  retain_until  timestamptz not null default now() + interval '180 days'
);

create table donation_requests (
  id                    uuid primary key default gen_random_uuid(),
  code                  text not null unique,                      -- human-readable request id, e.g. KR-7F2Q-9KXM
  client_request_id     uuid not null,                             -- idempotency key from the client draft
  batch_id              uuid not null,                             -- one submission split across organisations
  donor_user_id         uuid not null references profiles(id),
  organization_id       uuid not null references organizations(id),
  status                donation_status not null default 'draft',
  delivery_method       delivery_method not null,
  pickup_address_id     uuid references pickup_addresses(id),
  pickup_date           date not null,
  pickup_time_slot      text not null,
  contact_method        text not null check (contact_method in ('phone', 'sms', 'email', 'whatsapp')),
  donor_notes           text check (donor_notes is null or char_length(donor_notes) <= 1000),
  organization_response text,
  delivery_partner_id   uuid references delivery_partners(id),
  flagged               text,                                      -- held for admin review
  rejection_reason      text,
  cancel_reason         text,
  failure_reason        text,
  submitted_at          timestamptz,
  accepted_at           timestamptz,
  picked_up_at          timestamptz,
  delivered_at          timestamptz,
  completed_at          timestamptz,
  is_demo               boolean not null default false,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  check (delivery_method <> 'partner_pickup' or pickup_address_id is not null),
  check (status <> 'completed' or completed_at is not null)
);
-- one client draft → at most one request per organisation (retries return the original)
create unique index donation_requests_idempotency on donation_requests (donor_user_id, client_request_id, organization_id);

create table donation_request_items (
  id                  uuid primary key default gen_random_uuid(),
  donation_request_id uuid not null references donation_requests(id) on delete cascade,
  category_id         text not null references item_categories(id),
  item_name           text not null check (char_length(item_name) between 2 and 80),
  quantity            int not null check (quantity between 1 and 1000),
  quantity_unit       item_unit not null,
  item_condition      item_condition not null,
  description         text check (description is null or char_length(description) <= 500),
  image_path          text,
  food_expiry_or_preparation_details jsonb,
  created_at          timestamptz not null default now(),
  check (category_id not in ('packaged_food', 'fresh_food') or food_expiry_or_preparation_details is not null)
);

create table delivery_jobs (
  id                    uuid primary key default gen_random_uuid(),
  donation_request_id   uuid not null unique references donation_requests(id) on delete cascade,
  partner_id            uuid references delivery_partners(id),
  partner_user_id       uuid references profiles(id),
  assignment_status     assignment_status not null default 'open',
  package_size          text not null default 'small' check (package_size in ('small', 'medium', 'large')),
  version               int not null default 0,                  -- optimistic-concurrency token
  accepted_at           timestamptz,
  pickup_confirmed_at   timestamptz,
  delivery_confirmed_at timestamptz,
  pickup_proof_path     text,
  delivery_proof_path   text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  check (assignment_status <> 'claimed' or (partner_id is not null and partner_user_id is not null))
);

create table donation_status_events (
  id                  uuid primary key default gen_random_uuid(),
  seq                 bigint generated always as identity,   -- total order (several events can share one transaction timestamp)
  donation_request_id uuid not null references donation_requests(id) on delete cascade,
  previous_status     donation_status,
  new_status          donation_status not null,
  changed_by          uuid references profiles(id),
  actor               actor_kind not null,
  notes               text,
  created_at          timestamptz not null default clock_timestamp()
);

create table donation_proofs (
  id                  uuid primary key default gen_random_uuid(),
  donation_request_id uuid not null references donation_requests(id) on delete cascade,
  kind                text not null check (kind in ('pickup', 'delivery', 'receipt')),
  uploaded_by         uuid not null references profiles(id),
  note                text,
  photo_path          text,
  created_at          timestamptz not null default now()
);

create table notifications (
  id                  uuid primary key default gen_random_uuid(),
  recipient_user_id   uuid not null references profiles(id) on delete cascade,
  donation_request_id uuid references donation_requests(id) on delete cascade,
  notification_type   text not null,
  title               text not null,
  message             text not null,
  link                text,
  read_at             timestamptz,
  created_at          timestamptz not null default now()
);

create table reports_and_disputes (
  id          uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references profiles(id),
  request_id  uuid references donation_requests(id),
  org_id      uuid references organizations(id),
  kind        text not null check (kind in ('dispute', 'complaint', 'safety', 'other')),
  message     text not null check (char_length(message) between 10 and 2000),
  status      text not null default 'open' check (status in ('open', 'investigating', 'resolved')),
  resolution  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Never store passwords, OTPs, tokens or contact details here — ids and short descriptions only.
create table audit_logs (
  id         uuid primary key default gen_random_uuid(),
  actor_id   uuid,
  action     text not null,
  entity     text not null,
  entity_id  text not null,
  details    text check (details is null or char_length(details) <= 500),
  created_at timestamptz not null default now()
);

create table organization_imports (
  id                   uuid primary key default gen_random_uuid(),
  name                 text not null,
  organization_type    org_type not null default 'other',
  locality             text not null,
  address              text not null default '',
  postal_code          text not null default '',
  phone                text not null default '',
  email                text not null default '',
  accepted_categories  text[] not null default '{}',
  source               text not null,
  state                text not null default 'staged' check (state in ('staged', 'contacted', 'confirmed', 'published', 'discarded')),
  duplicate_of         uuid references organizations(id),
  address_verified     boolean not null default false,
  contact_verified     boolean not null default false,
  permission_confirmed boolean not null default false,
  evidence_note        text,
  reviewed_at          timestamptz,
  created_at           timestamptz not null default now()
);

-- Server-side rate limiting buckets (e.g. failed claims, report spam). Written only by functions.
create table rate_limit_events (
  id         bigint generated always as identity primary key,
  user_id    uuid not null,
  action     text not null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- indexes
create index on donation_requests (donor_user_id, created_at desc);
create index on donation_requests (organization_id, status);
create index on donation_requests (status) where flagged is not null;
create index on donation_requests (delivery_partner_id) where delivery_partner_id is not null;
create index on donation_request_items (donation_request_id);
create index on delivery_jobs (assignment_status) where assignment_status = 'open';
create index on delivery_jobs (partner_id) where partner_id is not null;
create index on donation_status_events (donation_request_id, seq);
create index on donation_proofs (donation_request_id);
create index on organization_needs (org_id) where need_status = 'open';
create index on organization_needs (category_id) where need_status = 'open';
create index on organization_item_policies (category_id) where acceptance_status = 'accepts';
create index on organizations (verification_status, locality);
create index on notifications (recipient_user_id, created_at desc);
create index on audit_logs (created_at desc);
create index on user_roles (user_id);
create index on rate_limit_events (user_id, action, created_at);
create index on pickup_addresses (user_id);

create trigger t_settings_touch before update on app_settings for each row execute function kr_touch();
create trigger t_profiles_touch before update on profiles for each row execute function kr_touch();
create trigger t_orgs_touch before update on organizations for each row execute function kr_touch();
create trigger t_policies_touch before update on organization_item_policies for each row execute function kr_touch();
create trigger t_needs_touch before update on organization_needs for each row execute function kr_touch();
create trigger t_requests_touch before update on donation_requests for each row execute function kr_touch();
create trigger t_partners_touch before update on delivery_partners for each row execute function kr_touch();
create trigger t_jobs_touch before update on delivery_jobs for each row execute function kr_touch();
create trigger t_reports_touch before update on reports_and_disputes for each row execute function kr_touch();
