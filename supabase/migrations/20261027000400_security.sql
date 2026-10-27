-- KindRoute 4/4 — Row Level Security, privileges, storage, realtime, reference data.
--
-- Model
--  * Default deny. RLS is on for every table; clients get SELECT only (no INSERT/UPDATE/DELETE on any
--    table). Every write goes through a SECURITY DEFINER RPC that authorises the caller.
--  * EXECUTE on functions is revoked from PUBLIC and granted back only for the client API below.
--    Internal helpers (kr_apply_transition, kr_open_job, kr_notify, …) are therefore unreachable.
--  * Never put the service-role key in the frontend: it bypasses all of this.

-- ---------------------------------------------------------------- table privileges
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

-- read access (rows still filtered by the policies below)
grant select on profiles, user_roles, item_categories, organizations, organization_item_policies, organization_needs,
  organization_verification_documents, partner_verification_documents, pickup_addresses, donation_requests, donation_request_items,
  delivery_partners, delivery_jobs, donation_status_events, donation_proofs, notifications, reports_and_disputes, audit_logs,
  organization_imports, app_settings to authenticated;
grant select on item_categories, organization_item_policies, organization_needs, app_settings to anon;

-- ---------------------------------------------------------------- row level security
alter table app_settings enable row level security;
alter table profiles enable row level security;
alter table user_roles enable row level security;
alter table item_categories enable row level security;
alter table organizations enable row level security;
alter table organization_verification_documents enable row level security;
alter table partner_verification_documents enable row level security;
alter table organization_item_policies enable row level security;
alter table organization_needs enable row level security;
alter table pickup_addresses enable row level security;
alter table donation_requests enable row level security;
alter table donation_request_items enable row level security;
alter table delivery_partners enable row level security;
alter table delivery_jobs enable row level security;
alter table donation_status_events enable row level security;
alter table donation_proofs enable row level security;
alter table notifications enable row level security;
alter table reports_and_disputes enable row level security;
alter table audit_logs enable row level security;
alter table organization_imports enable row level security;
alter table rate_limit_events enable row level security;

create policy "settings readable" on app_settings for select using (true);

create policy "own profile or admin" on profiles for select using (id = auth.uid() or kr_is_admin());
create policy "own roles or admin" on user_roles for select using (user_id = auth.uid() or kr_is_admin());
create policy "categories readable" on item_categories for select using (active or kr_is_admin());

-- organisations table holds private columns (registration number, verification notes): staff of that org and admins only.
-- The public reads approved organisations through list_public_organizations / search_organizations, which expose public fields only.
create policy "staff or admin read org" on organizations for select using (id = kr_staff_org() or kr_is_admin());

create policy "org docs: own org or admin" on organization_verification_documents for select using (org_id = kr_staff_org() or kr_is_admin());
create policy "partner docs: own or admin" on partner_verification_documents for select
  using (kr_is_admin() or partner_id in (select id from delivery_partners where user_id = auth.uid()));

create policy "policies of approved orgs are public" on organization_item_policies for select
  using (exists (select 1 from organizations o where o.id = org_id and o.verification_status = 'approved') or org_id = kr_staff_org() or kr_is_admin());
create policy "open needs of approved orgs are public" on organization_needs for select
  using ((need_status = 'open' and exists (select 1 from organizations o where o.id = org_id and o.verification_status = 'approved')) or org_id = kr_staff_org() or kr_is_admin());

-- exact addresses: owner and admins only (assigned partners get them through kr_donation_view while the job is active)
create policy "own addresses" on pickup_addresses for select using (user_id = auth.uid() or kr_is_admin());

create policy "participants read requests" on donation_requests for select
  using (donor_user_id = auth.uid() or organization_id = kr_staff_org() or kr_is_admin()
         or (delivery_partner_id is not null and delivery_partner_id = kr_partner_id()));
create policy "participants read items" on donation_request_items for select using (kr_can_view_request(donation_request_id));
create policy "participants read events" on donation_status_events for select using (kr_can_view_request(donation_request_id));
create policy "participants read proofs" on donation_proofs for select using (kr_can_view_request(donation_request_id));

create policy "own partner record or admin" on delivery_partners for select using (user_id = auth.uid() or kr_is_admin());
create policy "assigned partner, receiving org or admin read jobs" on delivery_jobs for select
  using ((partner_user_id = auth.uid() and kr_partner_id() is not null) or kr_is_admin()
         or exists (select 1 from donation_requests r where r.id = donation_request_id and r.organization_id = kr_staff_org()));

create policy "own notifications" on notifications for select using (recipient_user_id = auth.uid());
create policy "own reports or admin" on reports_and_disputes for select using (reporter_id = auth.uid() or kr_is_admin());
create policy "admin reads audit" on audit_logs for select using (kr_is_admin());
create policy "admin reads imports" on organization_imports for select using (kr_is_admin());
-- rate_limit_events: no policies → no client access at all

-- ---------------------------------------------------------------- function privileges
revoke execute on all functions in schema public from public, anon, authenticated;

-- helpers referenced by RLS policies must be executable by the querying role (they only reveal the caller's own role)
grant execute on function kr_has_role(app_role), kr_is_admin(), kr_staff_org(), kr_partner_id(), kr_can_view_request(uuid) to anon, authenticated;

-- public API (signed-out visitors)
grant execute on function list_public_organizations(), get_public_organization(text), search_organizations(jsonb), list_categories(),
  impact_stats(), get_public_settings(), get_my_session() to anon, authenticated;

-- signed-in API
grant execute on function
  ensure_my_profile(), update_my_profile(text), list_my_notifications(), mark_notifications_read(uuid[]),
  submit_donation(jsonb), cancel_donation(uuid, text), confirm_dropoff(uuid, text), list_my_donations(), get_donation(text), list_my_addresses(),
  file_report(text, text, uuid, uuid),
  register_organization(jsonb), get_my_organization(), org_update_profile(jsonb), org_save_policy(jsonb), org_save_need(jsonb), org_confirm_need(uuid),
  org_close_need(uuid, text), org_add_document(text, text, text), list_org_requests(), org_decide(uuid, text, text), org_confirm_receipt(uuid, text, text),
  org_report_not_received(uuid, text), org_reoffer(uuid),
  apply_as_partner(jsonb), get_my_partner_profile(), set_partner_availability(boolean), list_available_jobs(), list_my_jobs(),
  claim_delivery_job(uuid, int), release_job(uuid, text), partner_advance(uuid, donation_status, text, text),
  admin_stats(), admin_list_organizations(), admin_review_organization(uuid, approval_status, text, boolean, boolean), admin_review_document(uuid, text, text),
  admin_list_partners(), admin_review_partner(uuid, approval_status, text), admin_list_requests(), admin_transition(uuid, donation_status, text),
  admin_clear_flag(uuid, text), admin_list_reports(), admin_update_report(uuid, text, text), admin_list_audit(), admin_list_imports(),
  admin_import_rows(jsonb, text), admin_update_import(uuid, jsonb), admin_publish_import(uuid), admin_save_category(jsonb),
  admin_purge_expired_documents(), admin_set_account_status(uuid, account_status, text), admin_grant_admin(uuid, text), admin_update_settings(jsonb)
to authenticated;
-- kr_bootstrap_first_admin(text) deliberately has NO grant: run it from the SQL editor (postgres role) only.

-- ---------------------------------------------------------------- realtime (RLS applies to change events)
alter publication supabase_realtime add table notifications, donation_status_events, delivery_jobs;

-- ---------------------------------------------------------------- storage: private buckets, typed and size-limited
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('verification-docs', 'verification-docs', false, 5242880, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']),
  ('donation-photos',   'donation-photos',   false, 2097152, array['image/jpeg', 'image/png', 'image/webp']),
  ('delivery-proofs',   'delivery-proofs',   false, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Uploads go to "<auth.uid()>/<random>.<ext>"; extensions are allow-listed (no executables / html / svg).
create policy "kr upload verification docs" on storage.objects for insert to authenticated
  with check (bucket_id = 'verification-docs' and (storage.foldername(name))[1] = auth.uid()::text and lower(storage.extension(name)) in ('pdf', 'jpg', 'jpeg', 'png', 'webp'));
create policy "kr read verification docs" on storage.objects for select to authenticated
  using (bucket_id = 'verification-docs' and ((storage.foldername(name))[1] = auth.uid()::text or kr_is_admin()));
-- admins delete files whose rows were purged by admin_purge_expired_documents (retention policy)
create policy "kr admin delete verification docs" on storage.objects for delete to authenticated
  using (bucket_id = 'verification-docs' and kr_is_admin());

create policy "kr upload donation photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'donation-photos' and (storage.foldername(name))[1] = auth.uid()::text and lower(storage.extension(name)) in ('jpg', 'jpeg', 'png', 'webp'));
create policy "kr read donation photos" on storage.objects for select to authenticated
  using (bucket_id = 'donation-photos' and ((storage.foldername(name))[1] = auth.uid()::text or kr_is_admin()
    or exists (select 1 from public.donation_request_items i where i.image_path = name and kr_can_view_request(i.donation_request_id))));

-- proofs: only an approved partner or organisation staff may upload
create policy "kr upload delivery proofs" on storage.objects for insert to authenticated
  with check (bucket_id = 'delivery-proofs' and (storage.foldername(name))[1] = auth.uid()::text and lower(storage.extension(name)) in ('jpg', 'jpeg', 'png', 'webp')
    and (kr_partner_id() is not null or kr_staff_org() is not null));
create policy "kr read delivery proofs" on storage.objects for select to authenticated
  using (bucket_id = 'delivery-proofs' and ((storage.foldername(name))[1] = auth.uid()::text or kr_is_admin()
    or exists (select 1 from public.donation_proofs p where p.photo_path = name and kr_can_view_request(p.donation_request_id))));

-- ---------------------------------------------------------------- reference data
insert into app_settings (id) values (true) on conflict do nothing;

insert into item_categories (id, name, short, description, default_unit, restricted, sort) values
  ('books', 'Books & stationery', 'Books', 'Textbooks, storybooks, notebooks, school bags', 'pieces', false, 1),
  ('clothes', 'Clothes & footwear', 'Clothes', 'Clean, wearable clothing, winter wear, shoes', 'pieces', false, 2),
  ('packaged_food', 'Packaged food', 'Packaged food', 'Sealed staples and packets within expiry', 'kg', false, 3),
  ('fresh_food', 'Fresh food', 'Fresh food', 'Freshly cooked meals, fruit and vegetables', 'meals', true, 4),
  ('bedding', 'Blankets & bedding', 'Blankets', 'Blankets, bedsheets, pillows, mats', 'pieces', false, 5),
  ('toys', 'Toys & games', 'Toys', 'Safe, complete toys, puzzles, sports gear', 'pieces', false, 6),
  ('hygiene', 'Hygiene essentials', 'Hygiene', 'Soap, sanitary pads, toothpaste, adult diapers', 'pieces', false, 7),
  ('furniture', 'Furniture', 'Furniture', 'Study tables, chairs, shelves, cots', 'pieces', false, 8),
  ('medical', 'Mobility aids', 'Mobility aids', 'Walkers, wheelchairs, first-aid kits — never medicines', 'pieces', true, 9),
  ('other', 'Other approved items', 'Other', 'Utensils, bags, small appliances in working order', 'pieces', false, 10)
on conflict (id) do nothing;
