-- KindRoute 3/4 — administrator RPCs and the first-admin bootstrap.
-- Every function starts with kr_require_admin(); admin status comes only from user_roles, never from
-- JWT/user metadata, and user_roles has no client write path at all.

create or replace function admin_stats() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform kr_require_admin();
  return jsonb_build_object(
    'byStatus', (select coalesce(jsonb_object_agg(status, n), '{}') from (select status, count(*) n from donation_requests group by status) s),
    'orgsPending', (select count(*) from organizations where verification_status in ('pending', 'under_review', 'needs_info')),
    'partnersPending', (select count(*) from delivery_partners where approval_status in ('pending', 'under_review')),
    'reportsOpen', (select count(*) from reports_and_disputes where status <> 'resolved'),
    'flagged', (select count(*) from donation_requests where flagged is not null and status not in ('completed', 'rejected', 'cancelled')),
    'totalRequests', (select count(*) from donation_requests));
end $$;

create or replace function admin_list_organizations() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform kr_require_admin();
  return (select coalesce(jsonb_agg(jsonb_build_object('org', kr_org_json(o, true),
    'docs', coalesce((select jsonb_agg(kr_doc_json(d) order by d.uploaded_at) from organization_verification_documents d where d.org_id = o.id), '[]'),
    'staff', coalesce((select jsonb_agg(kr_profile_json(p)) from user_roles ur join profiles p on p.id = ur.user_id where ur.org_id = o.id and ur.role = 'org_staff'), '[]'))
    order by o.created_at desc), '[]') from organizations o);
end $$;

create or replace function admin_review_organization(p_org uuid, p_decision approval_status, p_note text, p_contact boolean, p_address boolean) returns void
language plpgsql security definer set search_path = public as $$
declare o organizations;
begin
  perform kr_require_admin();
  select * into o from organizations where id = p_org for update;
  if not found then raise exception 'not_found: organisation' using errcode = 'P0002'; end if;
  if p_decision = 'approved' then
    if not exists (select 1 from organization_verification_documents where org_id = p_org and review_status = 'accepted') then
      raise exception 'invalid: accept at least one verification document before approving' using errcode = '22023'; end if;
    if not (coalesce(p_contact, false) and coalesce(p_address, false)) then
      raise exception 'invalid: confirm you verified the contact details and address before approving' using errcode = '22023'; end if;
    update organizations set verification_status = 'approved', contact_verified = true, verified_at = now(), verified_by = auth.uid(),
           next_review_due = now() + interval '365 days', verification_notes = coalesce(nullif(trim(p_note), ''), verification_notes) where id = p_org;
  elsif p_decision = 'under_review' then
    update organizations set verification_status = 'under_review' where id = p_org;
  else
    if char_length(trim(coalesce(p_note, ''))) < 5 then raise exception 'invalid: add a note explaining the decision' using errcode = '22023'; end if;
    update organizations set verification_status = p_decision, verification_notes = trim(p_note) where id = p_org;
  end if;
  perform kr_audit('organization.' || p_decision, 'organization', p_org::text, p_note);
  perform kr_notify(kr_staff_ids(p_org), 'org_verification', 'Verification: ' || replace(p_decision::text, '_', ' '),
    coalesce(nullif(trim(p_note), ''), case when p_decision = 'approved' then 'Your organisation profile is now public.' else 'See your organisation portal.' end), '/portal/organization');
end $$;

create or replace function admin_review_document(p_doc uuid, p_status text, p_note text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform kr_require_admin();
  if p_status not in ('accepted', 'rejected') then raise exception 'invalid: status must be accepted or rejected' using errcode = '22023'; end if;
  update organization_verification_documents set review_status = p_status, reviewer_note = p_note, reviewed_by = auth.uid(), reviewed_at = now() where id = p_doc;
  if not found then
    update partner_verification_documents set review_status = p_status, reviewer_note = p_note, reviewed_by = auth.uid(), reviewed_at = now() where id = p_doc;
    if not found then raise exception 'not_found: document' using errcode = 'P0002'; end if;
  end if;
  perform kr_audit('document.' || p_status, 'verification_document', p_doc::text, p_note);
end $$;

create or replace function admin_list_partners() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform kr_require_admin();
  return (select coalesce(jsonb_agg(jsonb_build_object('partner', kr_partner_json(p),
    'docs', coalesce((select jsonb_agg(kr_pdoc_json(d)) from partner_verification_documents d where d.partner_id = p.id), '[]')) order by p.created_at desc), '[]')
    from delivery_partners p);
end $$;

-- The only way to obtain the delivery_partner role.
create or replace function admin_review_partner(p_partner uuid, p_decision approval_status, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare v_user uuid;
begin
  perform kr_require_admin();
  select user_id into v_user from delivery_partners where id = p_partner for update;
  if v_user is null then raise exception 'not_found: partner' using errcode = 'P0002'; end if;
  if p_decision = 'approved' then
    if not exists (select 1 from partner_verification_documents where partner_id = p_partner and review_status = 'accepted') then
      raise exception 'invalid: accept the partner''s ID document before approving' using errcode = '22023'; end if;
    update delivery_partners set approval_status = 'approved', review_note = p_note where id = p_partner;
    insert into user_roles (user_id, role, granted_by) values (v_user, 'delivery_partner', auth.uid()) on conflict do nothing;
  else
    if p_decision <> 'under_review' and char_length(trim(coalesce(p_note, ''))) < 5 then raise exception 'invalid: add a note explaining the decision' using errcode = '22023'; end if;
    update delivery_partners set approval_status = p_decision, review_note = p_note, availability_status = false where id = p_partner;
    delete from user_roles where user_id = v_user and role = 'delivery_partner';
  end if;
  perform kr_audit('partner.' || p_decision, 'delivery_partner', p_partner::text, p_note);
  perform kr_notify(array[v_user], 'partner_review', 'Partner application: ' || replace(p_decision::text, '_', ' '),
    coalesce(nullif(trim(p_note), ''), 'You can now go online and accept jobs.'), '/portal/partner');
end $$;

create or replace function admin_list_requests() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform kr_require_admin();
  return (select coalesce(jsonb_agg(kr_donation_view(id) order by updated_at desc), '[]') from (select id, updated_at from donation_requests order by updated_at desc limit 500) r);
end $$;

create or replace function admin_transition(p_request uuid, p_to donation_status, p_note text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform kr_require_admin();
  if char_length(trim(coalesce(p_note, ''))) < 5 then raise exception 'invalid: admin actions need a note for the audit log' using errcode = '22023'; end if;
  if p_to = 'awaiting_delivery_partner' then perform kr_open_job(p_request, 'admin'); return; end if;
  update donation_requests set
    rejection_reason = case when p_to = 'rejected' then p_note else rejection_reason end,
    cancel_reason = case when p_to = 'cancelled' then p_note else cancel_reason end,
    failure_reason = case when p_to = 'failed' then p_note else failure_reason end
  where id = p_request;
  -- kr_transition_allowed still applies: e.g. an admin cannot mark a donation completed (only the organisation can)
  perform kr_apply_transition(p_request, p_to, 'admin', p_note);
  if p_to in ('cancelled', 'failed', 'rejected') then update delivery_jobs set assignment_status = 'cancelled', version = version + 1 where donation_request_id = p_request; end if;
end $$;

create or replace function admin_clear_flag(p_request uuid, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare r donation_requests;
begin
  perform kr_require_admin();
  update donation_requests set flagged = null where id = p_request returning * into r;
  if not found then raise exception 'not_found: donation request' using errcode = 'P0002'; end if;
  perform kr_audit('donation.flag_cleared', 'donation_request', p_request::text, p_note);
  perform kr_notify(kr_staff_ids(r.organization_id), 'flag_cleared', 'Request cleared by admin', r.code || ' can now be accepted.', '/portal/organization', r.id);
end $$;

create or replace function admin_list_reports() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform kr_require_admin();
  return (select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', id, 'reporterId', reporter_id, 'requestId', request_id, 'orgId', org_id, 'kind', kind,
    'message', message, 'status', status, 'resolution', resolution, 'createdAt', created_at, 'updatedAt', updated_at)) order by created_at desc), '[]') from reports_and_disputes);
end $$;

create or replace function admin_update_report(p_report uuid, p_status text, p_resolution text) returns void
language plpgsql security definer set search_path = public as $$
declare v_reporter uuid;
begin
  perform kr_require_admin();
  if p_status = 'resolved' and char_length(trim(coalesce(p_resolution, ''))) < 5 then raise exception 'invalid: describe the resolution' using errcode = '22023'; end if;
  update reports_and_disputes set status = p_status, resolution = p_resolution where id = p_report returning reporter_id into v_reporter;
  if v_reporter is null then raise exception 'not_found: report' using errcode = 'P0002'; end if;
  perform kr_audit('report.' || p_status, 'report', p_report::text, p_resolution);
  perform kr_notify(array[v_reporter], 'report_update', 'Your report is ' || p_status, coalesce(p_resolution, 'An administrator is looking into it.'));
end $$;

create or replace function admin_list_audit() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform kr_require_admin();
  return (select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', id, 'actorId', coalesce(actor_id::text, 'system'), 'action', action, 'entity', entity,
    'entityId', entity_id, 'details', details, 'at', created_at)) order by created_at desc), '[]')
    from (select * from audit_logs order by created_at desc limit 300) a);
end $$;

create or replace function kr_import_json(i organization_imports) returns jsonb language sql stable as $$
  select jsonb_strip_nulls(jsonb_build_object('id', i.id, 'name', i.name, 'type', i.organization_type, 'locality', i.locality, 'address', i.address,
    'pinCode', i.postal_code, 'phone', i.phone, 'email', i.email, 'acceptedCategories', to_jsonb(i.accepted_categories), 'source', i.source, 'state', i.state,
    'duplicateOf', i.duplicate_of, 'addressVerified', i.address_verified, 'contactVerified', i.contact_verified, 'permissionConfirmed', i.permission_confirmed,
    'evidenceNote', i.evidence_note, 'reviewedAt', i.reviewed_at, 'createdAt', i.created_at))
$$;

create or replace function admin_list_imports() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform kr_require_admin();
  return (select coalesce(jsonb_agg(kr_import_json(i) order by i.created_at desc), '[]') from organization_imports i);
end $$;

-- Rows are parsed client-side (CSV) and re-validated here; duplicates are detected against organisations and earlier imports.
create or replace function admin_import_rows(p_rows jsonb, p_source text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb; v_key text; v_phone text; v_dupe uuid; added int := 0; dupes int := 0; errs jsonb := '[]'; n int := 1;
begin
  perform kr_require_admin();
  for r in select * from jsonb_array_elements(p_rows) loop
    n := n + 1;
    if char_length(trim(coalesce(r->>'name', ''))) < 3 then errs := errs || to_jsonb('Row ' || n || ': missing name'); continue; end if;
    if char_length(trim(coalesce(r->>'locality', ''))) < 2 then errs := errs || to_jsonb('Row ' || n || ': missing locality'); continue; end if;
    if coalesce(r->>'type', 'other') not in (select unnest(enum_range(null::org_type))::text) then errs := errs || to_jsonb('Row ' || n || ': unknown type'); continue; end if;
    v_key := lower(regexp_replace(r->>'name', '[^a-zA-Z0-9]+', '', 'g'));
    v_phone := right(regexp_replace(coalesce(r->>'phone', ''), '\D', '', 'g'), 10);
    if exists (select 1 from organization_imports where lower(regexp_replace(name, '[^a-zA-Z0-9]+', '', 'g')) = v_key and state <> 'discarded') then dupes := dupes + 1; continue; end if;
    select id into v_dupe from organizations where lower(regexp_replace(name, '[^a-zA-Z0-9]+', '', 'g')) = v_key
      or (v_phone <> '' and right(regexp_replace(coalesce(public_contact_phone, ''), '\D', '', 'g'), 10) = v_phone) limit 1;
    if v_dupe is not null then dupes := dupes + 1; end if;
    insert into organization_imports (name, organization_type, locality, address, postal_code, phone, email, accepted_categories, source, duplicate_of)
    values (trim(r->>'name'), coalesce(r->>'type', 'other')::org_type, trim(r->>'locality'), coalesce(r->>'address', ''), coalesce(r->>'pinCode', ''),
            coalesce(r->>'phone', ''), coalesce(r->>'email', ''),
            coalesce((select array_agg(x) from jsonb_array_elements_text(r->'acceptedCategories') x where x in (select id from item_categories)), '{}'), left(p_source, 200), v_dupe);
    added := added + 1;
  end loop;
  perform kr_audit('import.csv', 'import', left(p_source, 100), added || ' staged, ' || dupes || ' duplicates, ' || jsonb_array_length(errs) || ' errors');
  return jsonb_build_object('added', added, 'duplicates', dupes, 'errors', errs);
end $$;

create or replace function admin_update_import(p_import uuid, patch jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform kr_require_admin();
  update organization_imports set
    state = coalesce(patch->>'state', state),
    address_verified = coalesce((patch->>'addressVerified')::boolean, address_verified),
    contact_verified = coalesce((patch->>'contactVerified')::boolean, contact_verified),
    permission_confirmed = coalesce((patch->>'permissionConfirmed')::boolean, permission_confirmed),
    evidence_note = case when patch ? 'evidenceNote' then patch->>'evidenceNote' else evidence_note end,
    reviewed_at = now()
  where id = p_import and state <> 'published';
  if not found then raise exception 'invalid: import not found or already published' using errcode = '22023'; end if;
  perform kr_audit('import.updated', 'import', p_import::text, left(patch::text, 300));
end $$;

create or replace function admin_publish_import(p_import uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare i organization_imports; v_id uuid; v_slug text; c text;
begin
  perform kr_require_admin();
  select * into i from organization_imports where id = p_import for update;
  if not found then raise exception 'not_found: import' using errcode = 'P0002'; end if;
  if i.state = 'published' then raise exception 'invalid: already published' using errcode = '22023'; end if;
  if i.duplicate_of is not null then raise exception 'invalid: resolve the duplicate first' using errcode = '22023'; end if;
  if not (i.address_verified and i.contact_verified and i.permission_confirmed) then
    raise exception 'invalid: verify address, contact details and the organisation''s permission before publishing' using errcode = '22023'; end if;
  if char_length(coalesce(i.evidence_note, '')) < 10 then raise exception 'invalid: record the verification evidence (what was checked, by whom, when)' using errcode = '22023'; end if;
  if cardinality(i.accepted_categories) = 0 then raise exception 'invalid: record at least one accepted item category' using errcode = '22023'; end if;
  if i.postal_code !~ '^41[0-9]{4}$' then raise exception 'invalid: a valid Pune PIN code is required' using errcode = '22023'; end if;
  v_slug := trim(both '-' from left(regexp_replace(lower(i.name), '[^a-z0-9]+', '-', 'g'), 40));
  while exists (select 1 from organizations where slug = v_slug) loop v_slug := v_slug || '-1'; end loop;
  -- Coordinates default to the Pune centre (locality precision) until an admin sets the locality centroid.
  insert into organizations (slug, name, organization_type, locality, address, postal_code, lat, lng, public_contact_phone, public_contact_email,
                             contact_verified, verification_status, verified_at, verified_by, verification_notes, next_review_due, accepted_donation_methods)
  values (v_slug, i.name, i.organization_type, i.locality, i.address, i.postal_code, coalesce((select lat from organizations where locality = i.locality limit 1), 18.5204),
          coalesce((select lng from organizations where locality = i.locality limit 1), 73.8567), nullif(i.phone, ''), nullif(i.email, ''), true, 'approved', now(), auth.uid(),
          i.evidence_note, now() + interval '180 days', '{partner_pickup}')
  returning id into v_id;
  foreach c in array i.accepted_categories loop insert into organization_item_policies (org_id, category_id) values (v_id, c); end loop;
  insert into organization_verification_documents (org_id, document_type, file_name, storage_path, review_status, reviewer_note, reviewed_by, reviewed_at, uploaded_by)
  values (v_id, 'Admin verification record', 'evidence-note.txt', 'admin-record/' || v_id, 'accepted', i.evidence_note, auth.uid(), now(), auth.uid());
  update organization_imports set state = 'published', reviewed_at = now() where id = p_import;
  perform kr_audit('import.published', 'organization', v_id::text, i.name);
  return v_id;
end $$;

create or replace function admin_save_category(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform kr_require_admin();
  update item_categories set name = coalesce(p->>'label', name), description = coalesce(p->>'blurb', description), active = coalesce((p->>'active')::boolean, active)
  where id = p->>'id';
  if not found then raise exception 'not_found: category' using errcode = 'P0002'; end if;
  perform kr_audit('category.updated', 'item_category', p->>'id');
end $$;

-- Returns the storage paths of purged rows so a trusted job (Edge Function with the service role) can delete the files.
create or replace function admin_purge_expired_documents() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_paths jsonb;
begin
  perform kr_require_admin();
  with a as (delete from organization_verification_documents
             where (retain_until < now() or (review_status = 'rejected' and uploaded_at < now() - interval '30 days')) and storage_path not like 'admin-record/%'
             returning storage_path),
       b as (delete from partner_verification_documents where retain_until < now() or (review_status = 'rejected' and uploaded_at < now() - interval '30 days')
             returning storage_path)
  select coalesce(jsonb_agg(storage_path), '[]') into v_paths from (select storage_path from a union all select storage_path from b) x;
  perform kr_audit('documents.purged', 'verification_document', '*', jsonb_array_length(v_paths) || ' removed');
  return jsonb_build_object('removed', jsonb_array_length(v_paths), 'paths', v_paths);
end $$;

create or replace function admin_set_account_status(p_user uuid, p_status account_status, p_note text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform kr_require_admin();
  if p_user = auth.uid() then raise exception 'invalid: you cannot suspend your own account' using errcode = '22023'; end if;
  if char_length(trim(coalesce(p_note, ''))) < 5 then raise exception 'invalid: add a note for the audit log' using errcode = '22023'; end if;
  update profiles set account_status = p_status where id = p_user;
  if not found then raise exception 'not_found: user' using errcode = 'P0002'; end if;
  if p_status = 'suspended' then update delivery_partners set availability_status = false where user_id = p_user; end if;
  perform kr_audit('account.' || p_status, 'profile', p_user::text, p_note);
end $$;

-- An existing admin may grant admin to another verified account. Audited.
create or replace function admin_grant_admin(p_user uuid, p_note text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform kr_require_admin();
  if char_length(trim(coalesce(p_note, ''))) < 5 then raise exception 'invalid: add a note for the audit log' using errcode = '22023'; end if;
  if not exists (select 1 from profiles where id = p_user and account_status = 'active' and (email_verified or phone_verified)) then
    raise exception 'invalid: the account must exist, be active and have a verified email or phone' using errcode = '22023'; end if;
  insert into user_roles (user_id, role, granted_by) values (p_user, 'admin', auth.uid()) on conflict do nothing;
  perform kr_audit('role.admin_granted', 'profile', p_user::text, p_note);
end $$;

create or replace function admin_update_settings(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform kr_require_admin();
  update app_settings set
    need_freshness_days = coalesce((p->>'needFreshnessDays')::int, need_freshness_days),
    require_phone_for_donation = coalesce((p->>'requirePhoneForDonation')::boolean, require_phone_for_donation),
    max_submissions_per_day = coalesce((p->>'maxSubmissionsPerDay')::int, max_submissions_per_day);
  perform kr_audit('settings.updated', 'app_settings', 'singleton', left(p::text, 300));
end $$;

-- FIRST ADMINISTRATOR. Not callable by any client role (EXECUTE is revoked in migration 4).
-- Run once from the SQL editor (which runs as the postgres role) after the person has signed up and
-- confirmed their email:   select kr_bootstrap_first_admin('you@your-domain.org');
-- It refuses to run if an administrator already exists.
create or replace function kr_bootstrap_first_admin(p_email text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_user uuid;
begin
  if exists (select 1 from user_roles where role = 'admin') then
    raise exception 'invalid: an administrator already exists — use admin_grant_admin from an admin account' using errcode = '22023'; end if;
  select id into v_user from profiles where lower(email) = lower(trim(p_email)) and email_verified;
  if v_user is null then raise exception 'not_found: no profile with that confirmed email — sign up and confirm the email first' using errcode = 'P0002'; end if;
  insert into user_roles (user_id, role) values (v_user, 'admin');
  insert into audit_logs (actor_id, action, entity, entity_id, details) values (null, 'role.admin_bootstrapped', 'profile', v_user::text, 'first administrator');
  return v_user;
end $$;
