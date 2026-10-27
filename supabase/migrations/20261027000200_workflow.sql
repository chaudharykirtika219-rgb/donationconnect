-- KindRoute 2/4 — helpers, read models, state machine, donor + organisation + partner workflow.
--
-- Every client-callable function here is SECURITY DEFINER with a fixed search_path and performs its own
-- authorisation. Migration 3 revokes EXECUTE from everyone and grants it back only on the client API,
-- so internal helpers such as kr_apply_transition() can never be called directly over PostgREST.
-- Errors use the prefixes forbidden:/invalid:/conflict:/rate_limited:/not_found:/unauthenticated:
-- which the client maps to user-facing messages.

-- ---------------------------------------------------------------- identity helpers
create or replace function kr_has_role(r app_role) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from user_roles where user_id = auth.uid() and role = r)
$$;

create or replace function kr_is_admin() returns boolean
language sql stable security definer set search_path = public as $$ select kr_has_role('admin') $$;

create or replace function kr_staff_org() returns uuid
language sql stable security definer set search_path = public as $$
  select org_id from user_roles where user_id = auth.uid() and role = 'org_staff' order by created_at limit 1
$$;

-- The caller's partner id, only if approved AND holding the delivery_partner role.
create or replace function kr_partner_id() returns uuid
language sql stable security definer set search_path = public as $$
  select p.id from delivery_partners p
  where p.user_id = auth.uid() and p.approval_status = 'approved' and kr_has_role('delivery_partner')
$$;

-- Signed-in, active profile or an exception.
create or replace function kr_me() returns profiles
language plpgsql stable security definer set search_path = public as $$
declare me profiles;
begin
  if auth.uid() is null then raise exception 'unauthenticated: please sign in' using errcode = '28000'; end if;
  select * into me from profiles where id = auth.uid();
  if not found then raise exception 'unauthenticated: profile missing — sign out and in again' using errcode = '28000'; end if;
  if me.account_status <> 'active' then raise exception 'forbidden: this account is suspended' using errcode = '42501'; end if;
  return me;
end $$;

create or replace function kr_require_admin() returns void language plpgsql stable security definer set search_path = public as $$
begin
  perform kr_me();
  if not kr_is_admin() then raise exception 'forbidden: administrator access only' using errcode = '42501'; end if;
end $$;

-- Storage paths must live in the caller's own folder ("<uid>/<file>"), so nobody can attach another
-- user's private file to a record and gain read access to it through the storage policies.
create or replace function kr_own_path(p text) returns boolean
language sql stable as $$ select p is null or (p like auth.uid()::text || '/%' and p !~ '\.\.') $$;

create or replace function kr_audit(p_action text, p_entity text, p_entity_id text, p_details text default null) returns void
language sql security definer set search_path = public as $$
  insert into audit_logs (actor_id, action, entity, entity_id, details) values (auth.uid(), p_action, p_entity, p_entity_id, left(p_details, 500))
$$;

create or replace function kr_notify(p_users uuid[], p_type text, p_title text, p_message text, p_link text default null, p_request uuid default null) returns void
language sql security definer set search_path = public as $$
  insert into notifications (recipient_user_id, notification_type, title, message, link, donation_request_id)
  select distinct u, p_type, p_title, p_message, p_link, p_request from unnest(p_users) u where u is not null
$$;

create or replace function kr_staff_ids(p_org uuid) returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(user_id), '{}') from user_roles where role = 'org_staff' and org_id = p_org
$$;

create or replace function kr_admin_ids() returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(user_id), '{}') from user_roles where role = 'admin'
$$;

-- Counts recent events for a rate limit and records a new one; raises when the limit is reached.
create or replace function kr_rate_limit(p_action text, p_max int, p_window interval) returns void
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from rate_limit_events where user_id = auth.uid() and action = p_action and created_at > now() - p_window) >= p_max then
    raise exception 'rate_limited: too many attempts, please try again later' using errcode = '53400';
  end if;
  insert into rate_limit_events (user_id, action) values (auth.uid(), p_action);
end $$;

create or replace function kr_today() returns date language sql stable as $$ select (now() at time zone 'Asia/Kolkata')::date $$;

create or replace function kr_distance_km(lat1 float8, lng1 float8, lat2 float8, lng2 float8) returns float8
language sql immutable as $$
  select 2 * 6371 * asin(sqrt(power(sin(radians(lat2 - lat1) / 2), 2) + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)))
$$;

-- Can the caller see this request at all? (donor, the receiving organisation's staff, the assigned partner, admins)
create or replace function kr_can_view_request(p_request uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from donation_requests r
    left join delivery_jobs j on j.donation_request_id = r.id
    where r.id = p_request and (
      r.donor_user_id = auth.uid()
      or r.organization_id = kr_staff_org()
      or (j.partner_user_id = auth.uid() and kr_partner_id() is not null and j.assignment_status in ('claimed', 'done'))
      or kr_is_admin()
    )
  )
$$;

-- ---------------------------------------------------------------- JSON read models (field names match src/lib/types.ts)
create or replace function kr_profile_json(p profiles) returns jsonb language sql stable as $$
  select jsonb_strip_nulls(jsonb_build_object('id', p.id, 'fullName', p.full_name, 'phone', coalesce(p.phone_number, ''), 'phoneVerified', p.phone_verified,
    'email', p.email, 'emailVerified', p.email_verified, 'avatarUrl', p.avatar_url, 'accountStatus', p.account_status,
    'createdAt', p.created_at, 'updatedAt', p.updated_at, 'isDemo', p.is_demo))
$$;

create or replace function kr_org_json(o organizations, p_private boolean) returns jsonb language sql stable as $$
  select jsonb_strip_nulls(jsonb_build_object('id', o.id, 'slug', o.slug, 'name', o.name, 'type', o.organization_type, 'intro', o.description,
    'locality', o.locality, 'city', o.city, 'state', o.state, 'address', o.address, 'pinCode', o.postal_code, 'lat', o.lat, 'lng', o.lng,
    'coordsPrecision', o.coords_precision, 'publicPhone', coalesce(o.public_contact_phone, ''), 'publicEmail', coalesce(o.public_contact_email, ''),
    'website', o.website, 'contactVerified', o.contact_verified, 'registrationType', o.registration_type, 'status', o.verification_status,
    'verifiedAt', o.verified_at, 'nextReviewDue', o.next_review_due, 'deliveryMethods', to_jsonb(o.accepted_donation_methods),
    'dropoffHours', o.dropoff_hours, 'pickupSlots', to_jsonb(o.pickup_slots), 'conditionRules', o.condition_rules,
    'restrictions', to_jsonb(o.restrictions), 'showImpact', o.show_impact, 'isDemo', o.is_demo, 'createdAt', o.created_at, 'updatedAt', o.updated_at)
    || case when p_private then jsonb_strip_nulls(jsonb_build_object('registrationNumber', o.registration_number, 'verifiedBy', o.verified_by,
         'verificationNote', o.verification_notes, 'ownerUserId', o.owner_user_id)) else '{}'::jsonb end)
$$;

create or replace function kr_policy_json(p organization_item_policies) returns jsonb language sql stable as $$
  select jsonb_strip_nulls(jsonb_build_object('id', p.id, 'orgId', p.org_id, 'categoryId', p.category_id, 'acceptance', p.acceptance_status,
    'conditionsAccepted', to_jsonb(p.condition_requirements), 'notes', p.restrictions, 'quantityLimit', p.quantity_limit,
    'minShelfLifeDays', p.min_shelf_life_days, 'maxHoursSincePrep', p.max_hours_since_prep, 'updatedAt', p.updated_at))
$$;

create or replace function kr_need_json(n organization_needs) returns jsonb language sql stable as $$
  select jsonb_strip_nulls(jsonb_build_object('id', n.id, 'orgId', n.org_id, 'categoryId', n.category_id, 'title', n.item_name, 'tags', to_jsonb(n.tags),
    'quantity', n.requested_quantity, 'unit', n.quantity_unit, 'fulfilledQty', n.fulfilled_quantity, 'urgency', n.urgency, 'note', n.description,
    'lastConfirmedAt', n.last_confirmed_at, 'status', n.need_status))
$$;

-- Public organisation: approved only, no private fields; open needs only.
create or replace function kr_public_org_json(o organizations) returns jsonb language sql stable security definer set search_path = public as $$
  select kr_org_json(o, false) || jsonb_build_object(
    'policies', coalesce((select jsonb_agg(kr_policy_json(p)) from organization_item_policies p where p.org_id = o.id), '[]'),
    'needs', coalesce((select jsonb_agg(kr_need_json(n) order by n.created_at) from organization_needs n where n.org_id = o.id and n.need_status = 'open'), '[]'))
$$;

create or replace function kr_doc_json(d organization_verification_documents) returns jsonb language sql stable as $$
  select jsonb_strip_nulls(jsonb_build_object('id', d.id, 'ownerKind', 'organization', 'ownerId', d.org_id, 'kind', d.document_type, 'fileName', d.file_name,
    'storagePath', d.storage_path, 'status', d.review_status, 'reviewerNote', d.reviewer_note, 'uploadedAt', d.uploaded_at, 'retainUntil', d.retain_until))
$$;

create or replace function kr_pdoc_json(d partner_verification_documents) returns jsonb language sql stable as $$
  select jsonb_strip_nulls(jsonb_build_object('id', d.id, 'ownerKind', 'partner', 'ownerId', d.partner_id, 'kind', d.document_type, 'fileName', d.file_name,
    'storagePath', d.storage_path, 'status', d.review_status, 'reviewerNote', d.reviewer_note, 'uploadedAt', d.uploaded_at, 'retainUntil', d.retain_until))
$$;

create or replace function kr_partner_json(p delivery_partners) returns jsonb language sql stable as $$
  select jsonb_strip_nulls(jsonb_build_object('id', p.id, 'userId', p.user_id, 'fullName', p.full_name, 'phone', coalesce(p.phone, ''), 'vehicle', p.transport_type,
    'serviceLocalities', to_jsonb(p.service_localities), 'status', p.approval_status, 'reviewNote', p.review_note, 'available', p.availability_status,
    'isDemo', p.is_demo, 'createdAt', p.created_at, 'updatedAt', p.updated_at))
$$;

create or replace function kr_request_json(r donation_requests, p_hide_flag boolean default false) returns jsonb language sql stable as $$
  select jsonb_strip_nulls(jsonb_build_object('id', r.id, 'code', r.code, 'batchId', r.batch_id, 'donorId', r.donor_user_id, 'orgId', r.organization_id,
    'status', r.status, 'deliveryMethod', r.delivery_method, 'pickupAddressId', r.pickup_address_id, 'preferredDate', r.pickup_date,
    'preferredSlot', r.pickup_time_slot, 'contactMethod', r.contact_method, 'notes', r.donor_notes,
    'flagged', case when p_hide_flag then null else r.flagged end, 'rejectionReason', r.rejection_reason, 'cancelReason', r.cancel_reason,
    'failureReason', r.failure_reason, 'organizationResponse', r.organization_response, 'submittedAt', r.submitted_at, 'acceptedAt', r.accepted_at,
    'pickedUpAt', r.picked_up_at, 'deliveredAt', r.delivered_at, 'completedAt', r.completed_at,
    'createdAt', r.created_at, 'updatedAt', r.updated_at, 'isDemo', r.is_demo))
$$;

create or replace function kr_job_json(j delivery_jobs) returns jsonb language sql stable as $$
  select jsonb_strip_nulls(jsonb_build_object('id', j.id, 'requestId', j.donation_request_id, 'partnerId', j.partner_id, 'state', j.assignment_status,
    'packageSize', j.package_size, 'version', j.version, 'claimedAt', j.accepted_at, 'pickupConfirmedAt', j.pickup_confirmed_at,
    'deliveryConfirmedAt', j.delivery_confirmed_at, 'createdAt', j.created_at, 'updatedAt', j.updated_at))
$$;

-- ---------------------------------------------------------------- state machine (mirrors src/lib/status.ts TRANSITIONS)
create or replace function kr_transition_allowed(f donation_status, t donation_status, a actor_kind, m delivery_method)
returns boolean language sql immutable as $$
  select case
    when f = 'draft' and t = 'pending_organization_confirmation' then a = 'donor'
    when f = 'pending_organization_confirmation' and t = 'organization_accepted' then a = 'org'
    when f = 'pending_organization_confirmation' and t = 'rejected' then a in ('org', 'admin')
    when f = 'organization_accepted' and t = 'awaiting_delivery_partner' then a in ('system', 'org', 'admin') and m = 'partner_pickup'
    when f = 'awaiting_delivery_partner' and t = 'delivery_partner_assigned' then a = 'partner' and m = 'partner_pickup'
    when f in ('delivery_partner_assigned', 'pickup_scheduled') and t = 'awaiting_delivery_partner' then a in ('partner', 'admin') and m = 'partner_pickup'
    when f = 'delivery_partner_assigned' and t = 'pickup_scheduled' then a = 'partner' and m = 'partner_pickup'
    when f = 'pickup_scheduled' and t = 'picked_up' then a = 'partner' and m = 'partner_pickup'
    when f = 'picked_up' and t = 'in_transit' then a = 'partner' and m = 'partner_pickup'
    when f = 'in_transit' and t = 'delivered_pending_receipt_confirmation' then a = 'partner' and m = 'partner_pickup'
    when f = 'organization_accepted' and t = 'delivered_pending_receipt_confirmation' then a = 'donor' and m = 'donor_dropoff'
    when f = 'delivered_pending_receipt_confirmation' and t = 'completed' then a = 'org'
    when f = 'delivered_pending_receipt_confirmation' and t = 'failed' then a in ('org', 'admin')
    when f in ('pickup_scheduled', 'picked_up', 'in_transit') and t = 'failed' then a in ('partner', 'admin') and m = 'partner_pickup'
    when f = 'failed' and t = 'awaiting_delivery_partner' then a in ('org', 'admin') and m = 'partner_pickup'
    when t = 'cancelled' and f in ('draft', 'pending_organization_confirmation', 'organization_accepted', 'awaiting_delivery_partner', 'delivery_partner_assigned', 'pickup_scheduled') and a in ('donor', 'admin') then true
    when t = 'cancelled' and f in ('organization_accepted', 'awaiting_delivery_partner', 'failed') and a in ('org', 'admin') then true
    else false
  end
$$;

-- The only code path that changes donation_requests.status. Locks the row, validates, stamps, logs, notifies.
create or replace function kr_apply_transition(p_request uuid, p_to donation_status, p_actor actor_kind, p_note text default null)
returns donation_requests language plpgsql security definer set search_path = public as $$
declare
  r donation_requests; o organizations; partner_user uuid; v_from donation_status; v_link text; v_loc text;
begin
  select * into r from donation_requests where id = p_request for update;
  if not found then raise exception 'not_found: donation request' using errcode = 'P0002'; end if;
  if not kr_transition_allowed(r.status, p_to, p_actor, r.delivery_method) then
    raise exception 'invalid: this request cannot move from % to %', replace(r.status::text, '_', ' '), replace(p_to::text, '_', ' ') using errcode = '22023';
  end if;
  v_from := r.status;
  update donation_requests set status = p_to,
    submitted_at = case when p_to = 'pending_organization_confirmation' then now() else submitted_at end,
    accepted_at  = case when p_to = 'organization_accepted' then now() else accepted_at end,
    picked_up_at = case when p_to = 'picked_up' then now() else picked_up_at end,
    delivered_at = case when p_to = 'delivered_pending_receipt_confirmation' then now() else delivered_at end,
    completed_at = case when p_to = 'completed' then now() else completed_at end
  where id = r.id returning * into r;
  insert into donation_status_events (donation_request_id, previous_status, new_status, changed_by, actor, notes)
    values (r.id, v_from, p_to, case when p_actor = 'system' then null else auth.uid() end, p_actor, left(p_note, 500));
  perform kr_audit('donation.' || p_to, 'donation_request', r.id::text, null);

  select * into o from organizations where id = r.organization_id;
  select j.partner_user_id into partner_user from delivery_jobs j where j.donation_request_id = r.id;
  v_link := '/track/' || r.code;

  case p_to
    when 'pending_organization_confirmation' then
      perform kr_notify(kr_staff_ids(r.organization_id), 'request_submitted', 'New donation request', r.code || ' is waiting for your decision.', '/portal/organization', r.id);
      perform kr_notify(array[r.donor_user_id], 'request_submitted', 'Request submitted', r.code || ' was sent to ' || o.name || '. It is not a confirmed pickup yet.', v_link, r.id);
    when 'organization_accepted' then
      perform kr_notify(array[r.donor_user_id], 'organization_accepted', o.name || ' accepted your donation',
        case when r.delivery_method = 'donor_dropoff' then 'You can drop the items off during their drop-off hours.' else 'We are finding a delivery partner.' end, v_link, r.id);
    when 'rejected' then
      perform kr_notify(array[r.donor_user_id], 'organization_rejected', 'Request declined', o.name || ': ' || coalesce(r.rejection_reason, 'no reason given'), v_link, r.id);
    when 'awaiting_delivery_partner' then
      select a.locality into v_loc from pickup_addresses a where a.id = r.pickup_address_id;
      perform kr_notify(
        (select coalesce(array_agg(p.user_id), '{}') from delivery_partners p
          where p.approval_status = 'approved' and p.availability_status
            and (cardinality(p.service_localities) = 0 or v_loc = any (p.service_localities))),
        'job_available', 'New delivery job available', 'Pickup in ' || coalesce(v_loc, 'Pune') || ' → ' || o.locality, '/portal/partner', r.id);
    when 'delivery_partner_assigned' then
      perform kr_notify(array_cat(array[r.donor_user_id], kr_staff_ids(r.organization_id)), 'partner_assigned', 'Delivery partner assigned', 'A verified partner accepted ' || r.code || '.', v_link, r.id);
    when 'pickup_scheduled' then
      perform kr_notify(array[r.donor_user_id], 'pickup_scheduled', 'Pickup scheduled', 'Your pickup is confirmed for ' || r.pickup_date || ', ' || r.pickup_time_slot || '.', v_link, r.id);
    when 'picked_up' then
      perform kr_notify(array_cat(array[r.donor_user_id], kr_staff_ids(r.organization_id)), 'picked_up', 'Picked up', r.code || ' was collected by the delivery partner.', v_link, r.id);
    when 'in_transit' then
      perform kr_notify(array_cat(array[r.donor_user_id], kr_staff_ids(r.organization_id)), 'in_transit', 'In transit', r.code || ' is on its way (status-based tracking, no live GPS).', v_link, r.id);
    when 'delivered_pending_receipt_confirmation' then
      perform kr_notify(kr_staff_ids(r.organization_id), 'delivered', 'Please confirm receipt', r.code || ' was marked delivered. Confirm once you have the items.', '/portal/organization', r.id);
      perform kr_notify(array[r.donor_user_id], 'delivered', 'Delivered', 'Waiting for ' || o.name || ' to confirm receipt.', v_link, r.id);
    when 'completed' then
      perform kr_notify(array[r.donor_user_id, partner_user], 'completed', 'Donation completed', o.name || ' confirmed receipt of ' || r.code || '. Thank you.', v_link, r.id);
    when 'cancelled' then
      perform kr_notify(array_cat(array[r.donor_user_id, partner_user], kr_staff_ids(r.organization_id)), 'cancelled', 'Request cancelled', r.code || ' was cancelled.', v_link, r.id);
    when 'failed' then
      perform kr_notify(array_cat(array[r.donor_user_id, partner_user], array_cat(kr_staff_ids(r.organization_id), kr_admin_ids())), 'disputed',
        'Delivery needs attention', r.code || ': ' || coalesce(r.failure_reason, 'see timeline'), v_link, r.id);
    else null;
  end case;
  return r;
end $$;

-- Redacted view of a request for the calling user (mirrors DemoBackend.view).
create or replace function kr_donation_view(p_request uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  r donation_requests; o organizations; d profiles; a pickup_addresses; j delivery_jobs; p delivery_partners;
  viewer text; fulfilling boolean; full_access boolean;
begin
  select * into r from donation_requests where id = p_request;
  if not found then raise exception 'not_found: donation request' using errcode = 'P0002'; end if;
  select * into j from delivery_jobs where donation_request_id = r.id;
  if j.partner_id is not null then select * into p from delivery_partners where id = j.partner_id; end if;
  viewer := case
    when r.donor_user_id = auth.uid() then 'donor'
    when r.organization_id = kr_staff_org() then 'org'
    when j.partner_user_id = auth.uid() and kr_partner_id() is not null and j.assignment_status in ('claimed', 'done') then 'partner'
    when kr_is_admin() then 'admin'
  end;
  if viewer is null then raise exception 'forbidden: no access to this donation request' using errcode = '42501'; end if;
  if kr_is_admin() and viewer <> 'donor' then viewer := 'admin'; end if;

  select * into o from organizations where id = r.organization_id;
  select * into d from profiles where id = r.donor_user_id;
  select * into a from pickup_addresses where id = r.pickup_address_id;
  -- the assigned partner sees pickup details only while the job is active
  fulfilling := viewer = 'partner' and j.assignment_status = 'claimed' and r.status in ('delivery_partner_assigned', 'pickup_scheduled', 'picked_up', 'in_transit');
  full_access := viewer in ('donor', 'admin');

  return jsonb_build_object(
    'viewer', viewer,
    'request', kr_request_json(r, viewer = 'partner'),
    'items', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', i.id, 'requestId', i.donation_request_id, 'categoryId', i.category_id,
      'name', i.item_name, 'quantity', i.quantity, 'unit', i.quantity_unit, 'condition', i.item_condition, 'description', i.description,
      'photo', i.image_path, 'food', i.food_expiry_or_preparation_details)) order by i.created_at)
      from donation_request_items i where i.donation_request_id = r.id), '[]'),
    'org', jsonb_strip_nulls(jsonb_build_object('id', o.id, 'slug', o.slug, 'name', o.name, 'type', o.organization_type, 'locality', o.locality,
      'address', case when viewer <> 'partner' or fulfilling then o.address end,
      'phone', case when full_access or fulfilling or viewer = 'org' then o.public_contact_phone end)),
    'donor', jsonb_strip_nulls(jsonb_build_object(
      'displayName', case when full_access then d.full_name else split_part(d.full_name, ' ', 1) end,
      'locality', a.locality,
      'phone', case when full_access or fulfilling then d.phone_number end,
      'email', case when full_access then d.email end,
      'address', case when (full_access or fulfilling) and a.id is not null then jsonb_strip_nulls(jsonb_build_object('id', a.id, 'userId', a.user_id,
        'line1', a.address_line, 'landmark', a.landmark, 'locality', a.locality, 'pinCode', a.postal_code, 'instructions', a.access_instructions)) end)),
    'partner', case when p.id is not null and j.assignment_status <> 'open' then jsonb_strip_nulls(jsonb_build_object(
      'displayName', case when viewer = 'admin' then p.full_name else split_part(p.full_name, ' ', 1) end,
      'vehicle', p.transport_type, 'isDemo', p.is_demo, 'phone', case when viewer = 'admin' then p.phone end)) end,
    'job', case when j.id is not null then kr_job_json(j) end,
    'events', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', e.id, 'requestId', e.donation_request_id, 'from', e.previous_status,
      'to', e.new_status, 'actorId', coalesce(e.changed_by::text, 'system'), 'actor', e.actor, 'note', e.notes, 'at', e.created_at)) order by e.seq)
      from donation_status_events e where e.donation_request_id = r.id), '[]'),
    'proofs', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', pr.id, 'requestId', pr.donation_request_id, 'kind', pr.kind,
      'uploadedBy', pr.uploaded_by, 'note', pr.note, 'photo', pr.photo_path, 'at', pr.created_at)) order by pr.created_at)
      from donation_proofs pr where pr.donation_request_id = r.id), '[]')
  );
end $$;

-- ---------------------------------------------------------------- session / account RPCs
create or replace function get_my_session() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me profiles;
begin
  if auth.uid() is null then return null; end if;
  select * into me from profiles where id = auth.uid();
  if not found then return null; end if;
  return jsonb_build_object('user', kr_profile_json(me),
    'roles', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('userId', ur.user_id, 'role', ur.role, 'orgId', ur.org_id,
      'grantedBy', coalesce(ur.granted_by::text, 'system'), 'createdAt', ur.created_at))) from user_roles ur where ur.user_id = me.id), '[]'));
end $$;

-- Repairs accounts whose profile row is missing (e.g. created before the auth trigger was installed).
create or replace function ensure_my_profile() returns jsonb
language plpgsql security definer set search_path = public as $$
declare u auth.users;
begin
  if auth.uid() is null then raise exception 'unauthenticated: please sign in' using errcode = '28000'; end if;
  if not exists (select 1 from profiles where id = auth.uid()) then
    select * into u from auth.users where id = auth.uid();
    insert into profiles (id, full_name, email, email_verified, phone_number, phone_verified)
    values (u.id, coalesce(nullif(trim(u.raw_user_meta_data->>'full_name'), ''), 'KindRoute member'), u.email, u.email_confirmed_at is not null,
            nullif(u.phone, ''), u.phone_confirmed_at is not null)
    on conflict do nothing;
    insert into user_roles (user_id, role) values (u.id, 'donor') on conflict do nothing;
  end if;
  return get_my_session();
end $$;

create or replace function update_my_profile(p_full_name text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform kr_me();
  if char_length(trim(coalesce(p_full_name, ''))) < 2 then raise exception 'invalid: name is too short' using errcode = '22023'; end if;
  update profiles set full_name = left(trim(p_full_name), 120) where id = auth.uid();
end $$;

create or replace function get_public_settings() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('needFreshnessDays', need_freshness_days, 'requirePhoneForDonation', require_phone_for_donation, 'environment', environment)
  from app_settings
$$;

-- ---------------------------------------------------------------- notifications
create or replace function list_my_notifications() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', n.id, 'userId', n.recipient_user_id, 'type', n.notification_type,
    'requestId', n.donation_request_id, 'title', n.title, 'body', n.message, 'link', n.link, 'read', n.read_at is not null, 'at', n.created_at))
    order by n.created_at desc), '[]')
  from (select * from notifications where recipient_user_id = auth.uid() order by created_at desc limit 50) n
$$;

create or replace function mark_notifications_read(p_ids uuid[] default null) returns void
language sql security definer set search_path = public as $$
  update notifications set read_at = now()
  where recipient_user_id = auth.uid() and read_at is null and (p_ids is null or id = any (p_ids))
$$;

-- ---------------------------------------------------------------- public discovery
create or replace function list_public_organizations() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(kr_public_org_json(o) order by o.name), '[]') from organizations o where o.verification_status = 'approved'
$$;

create or replace function get_public_organization(p_slug text) returns jsonb
language sql stable security definer set search_path = public as $$
  select kr_public_org_json(o) || jsonb_strip_nulls(jsonb_build_object('impact', case when o.show_impact then jsonb_build_object(
      'completed', (select count(*) from donation_requests where organization_id = o.id and status = 'completed'),
      'items', (select coalesce(sum(i.quantity), 0) from donation_request_items i join donation_requests r on r.id = i.donation_request_id
                where r.organization_id = o.id and r.status = 'completed')) end))
  from organizations o where o.slug = p_slug and o.verification_status = 'approved'
$$;

create or replace function list_categories() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'label', c.name, 'short', c.short, 'blurb', c.description, 'defaultUnit', c.default_unit,
    'restricted', c.restricted, 'active', c.active, 'sort', c.sort) order by c.sort), '[]')
  from item_categories c where c.active or kr_is_admin()
$$;

-- Server-side search. The client turns free text into a structured plan (src/lib/search.ts planSearch) and
-- this function filters, scores, sorts and paginates over approved organisations only. A need counts as
-- "current" only when open and confirmed within app_settings.need_freshness_days.
create or replace function search_organizations(p jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_cats text[]   := coalesce((select array_agg(x) from jsonb_array_elements_text(p->'categories') x), '{}');
  v_types text[]  := coalesce((select array_agg(x) from jsonb_array_elements_text(p->'orgTypes') x), '{}');
  v_locs text[]   := coalesce((select array_agg(x) from jsonb_array_elements_text(p->'localities') x), '{}');
  v_res text[]    := coalesce((select array_agg(lower(x)) from jsonb_array_elements_text(p->'residual') x), '{}');
  v_tags text[]   := coalesce((select array_agg(lower(x)) from jsonb_array_elements_text(p->'tags') x), '{}');
  v_text_only boolean := coalesce((p->>'textOnly')::boolean, false);
  v_near_lat float8 := (p->'near'->>'lat')::float8;
  v_near_lng float8 := (p->'near'->>'lng')::float8;
  v_near_name text  := p->'near'->>'name';
  v_or_lat float8 := (p->'origin'->>'lat')::float8;
  v_or_lng float8 := (p->'origin'->>'lng')::float8;
  v_needs boolean := coalesce((p->>'needsOnly')::boolean, false);
  v_pickup boolean := coalesce((p->>'pickupOnly')::boolean, false);
  v_verified boolean := coalesce((p->>'verifiedOnly')::boolean, false);
  v_sort text := coalesce(p->>'sort', 'relevance');
  v_limit int := least(greatest(coalesce((p->>'limit')::int, 12), 1), 50);
  v_offset int := greatest(coalesce((p->>'offset')::int, 0), 0);
  v_fresh int := coalesce((select need_freshness_days from app_settings), 30);
  v_total int; v_rows jsonb;
begin
  if coalesce((p->>'conflict')::boolean, false) then return jsonb_build_object('total', 0, 'results', '[]'::jsonb, 'freshnessDays', v_fresh); end if;
  with base as (
    select o.*,
      (select coalesce(array_agg(pol.category_id), '{}') from organization_item_policies pol where pol.org_id = o.id and pol.acceptance_status = 'accepts') as acc,
      case when v_or_lat is not null then kr_distance_km(v_or_lat, v_or_lng, o.lat, o.lng) end as dist
    from organizations o
    where o.verification_status = 'approved'
      and (cardinality(v_types) = 0 or o.organization_type::text = any (v_types))
      and (cardinality(v_locs) = 0 or o.locality = any (v_locs))
      and (not v_pickup or 'partner_pickup' = any (o.accepted_donation_methods))
      and (not v_verified or o.next_review_due is null or o.next_review_due >= now())
      and (v_near_lat is null or o.locality = v_near_name or kr_distance_km(v_near_lat, v_near_lng, o.lat, o.lng) <= 8)
  ), current_needs as (
    select n.* from organization_needs n join base b on b.id = n.org_id
    where n.need_status = 'open' and n.last_confirmed_at >= now() - make_interval(days => v_fresh) and n.category_id = any (b.acc)
  ), scored as (
    select b.id, b.name, b.dist, b.next_review_due,
      (select count(*) from current_needs n where n.org_id = b.id and (cardinality(v_cats) = 0 or n.category_id = any (v_cats))) as matched,
      (select max(case n.urgency when 'high' then 3 when 'medium' then 2 else 1 end) from current_needs n
        where n.org_id = b.id and (cardinality(v_cats) = 0 or n.category_id = any (v_cats))) as top_urg,
      (select count(*) from unnest(v_cats) c where c = any (b.acc)) as acc_matches,
      (select count(*) from current_needs n where n.org_id = b.id and (cardinality(v_cats) = 0 or n.category_id = any (v_cats))
        and exists (select 1 from unnest(v_tags) t where t = any (n.tags) or position(t in lower(n.item_name)) > 0)) as tagged,
      (select count(*) from unnest(v_res) r where position(r in lower(b.name || ' ' || b.description || ' ' || coalesce((select string_agg(n.item_name || ' ' || array_to_string(n.tags, ' '), ' ')
        from organization_needs n where n.org_id = b.id and n.need_status = 'open'), ''))) > 0) as res_hits
    from base b
  ), eligible as (
    select s.*,
      (case when cardinality(v_cats) > 0 and s.matched > 0 then 50 when s.acc_matches > 0 then 20 else 0 end)
      + (case when s.tagged > 0 then 20 else 0 end) + coalesce(s.top_urg, 0) * 10
      + (case when s.next_review_due is null or s.next_review_due >= now() then 5 else 0 end)
      + 10 * s.res_hits - least(coalesce(s.dist, 0), 20) * 0.5 as score
    from scored s
    where (cardinality(v_cats) = 0 or s.acc_matches > 0)
      and (not v_needs or s.matched > 0)
      and (not v_text_only or cardinality(v_res) = 0 or s.res_hits > 0)
  )
  select (select count(*) from eligible),
         coalesce((select jsonb_agg(kr_public_org_json(o) || jsonb_build_object('distanceKm', pg.dist) order by pg.ord)
           from (select e.*, row_number() over (order by
                   case when v_sort = 'distance' then e.dist end asc nulls last,
                   case when v_sort = 'urgency' then coalesce(e.top_urg, 0) end desc,
                   e.score desc, e.name asc) as ord
                 from eligible e order by ord offset v_offset limit v_limit) pg
           join organizations o on o.id = pg.id), '[]')
    into v_total, v_rows;
  return jsonb_build_object('total', v_total, 'results', v_rows, 'freshnessDays', v_fresh);
end $$;

create or replace function impact_stats() returns jsonb
language sql stable security definer set search_path = public as $$
  -- real platform data only: demo records are excluded
  select jsonb_build_object(
    'donationsCompleted', (select count(*) from donation_requests where status = 'completed' and not is_demo),
    'organizationsVerified', (select count(*) from organizations where verification_status = 'approved' and not is_demo),
    'itemsDelivered', (select coalesce(sum(i.quantity), 0) from donation_request_items i join donation_requests r on r.id = i.donation_request_id where r.status = 'completed' and not r.is_demo),
    'localitiesServed', (select count(distinct o.locality) from donation_requests r join organizations o on o.id = r.organization_id where r.status = 'completed' and not r.is_demo),
    'isDemo', false)
$$;

-- ---------------------------------------------------------------- donor RPCs
create or replace function submit_donation(payload jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me profiles; s app_settings; v_key uuid; v_batch uuid := gen_random_uuid(); v_addr uuid; v_org uuid; v_method delivery_method; v_req donation_requests;
  item jsonb; pol organization_item_policies; cat text; total int; flags text[]; out_reqs jsonb := '[]'; v_code text; v_food jsonb;
  v_date date; v_today date := kr_today(); v_slot text := trim(coalesce(payload->>'preferredSlot', ''));
  blocked text := '\m(medicines?|tablets?|capsules?|syrups?|injections?|insulin|antibiotics?|prescription|ointments?|painkillers?|alcohol|liquor|beer|wine|whisky|cigarettes?|tobacco|gutkha|vapes?|e-?cigarettes?|firecrackers?|crackers|gas cylinders?|lpg|kerosene|petrol|diesel|pesticides?|acid|explosives?|knife|knives|weapons?|guns?)\M';
begin
  me := kr_me();
  begin v_key := (payload->>'clientRequestId')::uuid; exception when others then v_key := null; end;
  if v_key is null then raise exception 'invalid: missing submission id — reload the page and try again' using errcode = '22023'; end if;

  -- Idempotency: serialise submissions of the same draft; a retry returns the original requests.
  perform pg_advisory_xact_lock(hashtextextended(me.id::text || v_key::text, 0));
  if exists (select 1 from donation_requests where donor_user_id = me.id and client_request_id = v_key) then
    return (select jsonb_agg(kr_request_json(r) order by r.created_at) from donation_requests r where r.donor_user_id = me.id and r.client_request_id = v_key);
  end if;

  select * into s from app_settings;
  if coalesce(s.require_phone_for_donation, true) and not me.phone_verified then
    raise exception 'forbidden: verify your phone number before submitting a donation' using errcode = '42501';
  elsif not me.phone_verified and not me.email_verified then
    raise exception 'forbidden: confirm your email address before submitting a donation' using errcode = '42501';
  end if;
  if coalesce((payload->>'consent')::boolean, false) is not true then raise exception 'invalid: please accept the privacy policy and terms' using errcode = '22023'; end if;
  if char_length(trim(coalesce(payload->'donor'->>'fullName', ''))) < 2 then raise exception 'invalid: enter your full name' using errcode = '22023'; end if;
  if (payload->'donor'->>'contactMethod') not in ('phone', 'sms', 'email', 'whatsapp') then raise exception 'invalid: choose how to be contacted' using errcode = '22023'; end if;
  if (payload->'donor'->>'contactMethod') = 'email' and me.email is null then raise exception 'invalid: add an email address to be contacted by email' using errcode = '22023'; end if;
  if (select count(distinct batch_id) from donation_requests where donor_user_id = me.id and created_at > now() - interval '24 hours') >= coalesce(s.max_submissions_per_day, 5) then
    raise exception 'rate_limited: you have reached the limit of % donation submissions per day', coalesce(s.max_submissions_per_day, 5) using errcode = '53400';
  end if;
  begin v_date := (payload->>'preferredDate')::date; exception when others then v_date := null; end;
  if v_date is null or v_date < v_today + 1 or v_date > v_today + 14 then raise exception 'invalid: choose a preferred date between tomorrow and 14 days from now' using errcode = '22023'; end if;
  if v_slot not in ('09:00 – 12:00', '12:00 – 15:00', '15:00 – 18:00', '18:00 – 20:00') then raise exception 'invalid: choose a time slot' using errcode = '22023'; end if;
  if jsonb_typeof(payload->'items') <> 'array' or jsonb_array_length(payload->'items') = 0 then raise exception 'invalid: add at least one item' using errcode = '22023'; end if;
  if jsonb_array_length(payload->'items') > 30 then raise exception 'invalid: at most 30 items per submission' using errcode = '22023'; end if;

  -- validate every item before writing anything
  for item in select * from jsonb_array_elements(payload->'items') loop
    cat := item->>'categoryId';
    if char_length(trim(coalesce(item->>'name', ''))) not between 2 and 80 then raise exception 'invalid: give each item a short name' using errcode = '22023'; end if;
    if (item->>'name') ~* blocked or coalesce(item->>'description', '') ~* blocked then
      raise exception 'invalid: "%" is not an accepted item on KindRoute', item->>'name' using errcode = '22023';
    end if;
    if (item->>'quantity') !~ '^\d+$' or (item->>'quantity')::int not between 1 and 1000 then raise exception 'invalid: quantity must be a whole number from 1 to 1000' using errcode = '22023'; end if;
    if (item->>'unit') not in (select unnest(enum_range(null::item_unit))::text) then raise exception 'invalid: unknown unit' using errcode = '22023'; end if;
    if (item->>'condition') not in (select unnest(enum_range(null::item_condition))::text) then raise exception 'invalid: unknown item condition' using errcode = '22023'; end if;
    if not kr_own_path(nullif(item->>'photo', '')) then raise exception 'forbidden: photo must be uploaded by you' using errcode = '42501'; end if;
    if cat = 'clothes' and (item->>'name') ~* '\m(innerwear|underwear|undergarments?|bras?|briefs)\M' and item->>'condition' <> 'new' then
      raise exception 'invalid: innerwear can only be donated new and unused' using errcode = '22023'; end if;
    if cat = 'toys' and item->>'condition' = 'needs_repair' then raise exception 'invalid: toys must be complete, clean and safe' using errcode = '22023'; end if;
    if not exists (select 1 from organizations where id = (item->>'orgId')::uuid and verification_status = 'approved') then
      raise exception 'invalid: one of the selected organisations is not available' using errcode = '22023';
    end if;
    select * into pol from organization_item_policies where org_id = (item->>'orgId')::uuid and category_id = cat;
    if not found or pol.acceptance_status = 'does_not_accept' then raise exception 'invalid: the organisation does not accept %', replace(cat, '_', ' ') using errcode = '22023'; end if;
    if pol.acceptance_status = 'temporarily_unavailable' then raise exception 'invalid: the organisation is temporarily not accepting %', replace(cat, '_', ' ') using errcode = '22023'; end if;
    if cardinality(pol.condition_requirements) > 0 and not ((item->>'condition')::item_condition = any (pol.condition_requirements)) then
      raise exception 'invalid: condition not accepted for %', item->>'name' using errcode = '22023';
    end if;
    if pol.quantity_limit is not null and (item->>'quantity')::int > pol.quantity_limit then
      raise exception 'invalid: at most % per request for %', pol.quantity_limit, replace(cat, '_', ' ') using errcode = '22023';
    end if;
    v_food := item->'food';
    if cat = 'packaged_food' then
      if v_food is null or (v_food->>'expiryDate') is null or (v_food->>'expiryDate')::date < v_today
         or (v_food->>'expiryDate')::date < v_today + coalesce(pol.min_shelf_life_days, 0)
         or coalesce((v_food->>'sealed')::boolean, false) is not true then
        raise exception 'invalid: packaged food must be sealed, unexpired and within the organisation''s shelf-life rule' using errcode = '22023';
      end if;
    elsif cat = 'fresh_food' then
      if v_food is null or (v_food->>'preparedAt') is null or (v_food->>'preparedAt')::timestamptz > now() + interval '15 minutes'
         or (v_food->>'preparedAt')::timestamptz < now() - make_interval(hours => least(coalesce(pol.max_hours_since_prep, 24), 24)) then
        raise exception 'invalid: fresh food is outside the allowed preparation window' using errcode = '22023';
      end if;
    end if;
  end loop;

  if exists (select 1 from jsonb_array_elements(payload->'items') e
             where coalesce(payload->'methods'->>(e->>'orgId'), 'partner_pickup') = 'partner_pickup') then
    if payload->'pickup' is null or jsonb_typeof(payload->'pickup') <> 'object' then raise exception 'invalid: enter your pickup address' using errcode = '22023'; end if;
    if char_length(trim(coalesce(payload->'pickup'->>'line1', ''))) < 5 then raise exception 'invalid: enter your pickup address' using errcode = '22023'; end if;
    if coalesce(payload->'pickup'->>'pinCode', '') !~ '^41[0-9]{4}$' then raise exception 'invalid: enter a valid Pune PIN code (41xxxx)' using errcode = '22023'; end if;
    if char_length(trim(coalesce(payload->'pickup'->>'locality', ''))) < 2 then raise exception 'invalid: choose a Pune locality' using errcode = '22023'; end if;
    insert into pickup_addresses (user_id, address_line, landmark, locality, postal_code, access_instructions)
    values (me.id, trim(payload->'pickup'->>'line1'), nullif(trim(payload->'pickup'->>'landmark'), ''), trim(payload->'pickup'->>'locality'),
            payload->'pickup'->>'pinCode', nullif(trim(payload->'pickup'->>'instructions'), ''))
    returning id into v_addr;
  end if;

  update profiles set full_name = left(trim(payload->'donor'->>'fullName'), 120) where id = me.id;

  for v_org in select distinct (e->>'orgId')::uuid from jsonb_array_elements(payload->'items') e loop
    v_method := coalesce(payload->'methods'->>v_org::text, 'partner_pickup')::delivery_method;
    if not exists (select 1 from organizations where id = v_org and v_method = any (accepted_donation_methods)) then
      raise exception 'invalid: the organisation does not support %', replace(v_method::text, '_', ' ') using errcode = '22023';
    end if;
    select coalesce(sum((e->>'quantity')::int), 0) into total from jsonb_array_elements(payload->'items') e where (e->>'orgId')::uuid = v_org;
    flags := '{}';
    if total > 300 then flags := flags || ('Unusually large quantity (' || total || ')'); end if;
    if (select count(*) from donation_requests where donor_user_id = me.id and status not in ('completed', 'rejected', 'cancelled', 'draft')) >= 4 then
      flags := flags || 'Donor has many open requests'::text;
    end if;
    if me.created_at > now() - interval '10 minutes' and total > 100 then flags := flags || 'Large request from a brand-new account'::text; end if;
    loop
      v_code := 'KR-' || translate(upper(substr(encode(gen_random_bytes(6), 'base64'), 1, 4)), '+/=01OIL', 'ABCD2345') || '-'
                      || translate(upper(substr(encode(gen_random_bytes(6), 'base64'), 1, 4)), '+/=01OIL', 'EFGH6789');
      exit when not exists (select 1 from donation_requests where code = v_code);
    end loop;
    insert into donation_requests (code, client_request_id, batch_id, donor_user_id, organization_id, delivery_method, pickup_address_id,
                                   pickup_date, pickup_time_slot, contact_method, donor_notes, flagged)
    values (v_code, v_key, v_batch, me.id, v_org, v_method, case when v_method = 'partner_pickup' then v_addr end, v_date, v_slot,
            payload->'donor'->>'contactMethod', nullif(left(trim(payload->>'notes'), 1000), ''), nullif(array_to_string(flags, '; '), ''))
    returning * into v_req;
    insert into donation_request_items (donation_request_id, category_id, item_name, quantity, quantity_unit, item_condition, description, image_path, food_expiry_or_preparation_details)
    select v_req.id, e->>'categoryId', trim(e->>'name'), (e->>'quantity')::int, (e->>'unit')::item_unit, (e->>'condition')::item_condition,
           nullif(left(trim(e->>'description'), 500), ''), nullif(e->>'photo', ''), e->'food'
    from jsonb_array_elements(payload->'items') e where (e->>'orgId')::uuid = v_org;
    v_req := kr_apply_transition(v_req.id, 'pending_organization_confirmation', 'donor');
    if v_req.flagged is not null then perform kr_notify(kr_admin_ids(), 'request_flagged', 'Request flagged for review', v_req.code || ': ' || v_req.flagged, '/admin', v_req.id); end if;
    out_reqs := out_reqs || kr_request_json(v_req);
  end loop;
  return out_reqs;
end $$;

create or replace function cancel_donation(p_request uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform kr_me();
  if not exists (select 1 from donation_requests where id = p_request and donor_user_id = auth.uid()) then raise exception 'forbidden: not your request' using errcode = '42501'; end if;
  if char_length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'invalid: please give a short reason' using errcode = '22023'; end if;
  update donation_requests set cancel_reason = left(trim(p_reason), 500) where id = p_request;
  perform kr_apply_transition(p_request, 'cancelled', 'donor', p_reason);
  update delivery_jobs set assignment_status = 'cancelled', version = version + 1 where donation_request_id = p_request;
end $$;

create or replace function confirm_dropoff(p_request uuid, p_note text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform kr_me();
  if not exists (select 1 from donation_requests where id = p_request and donor_user_id = auth.uid()) then raise exception 'forbidden: not your request' using errcode = '42501'; end if;
  perform kr_apply_transition(p_request, 'delivered_pending_receipt_confirmation', 'donor', coalesce(p_note, 'Donor dropped off the items'));
  insert into donation_proofs (donation_request_id, kind, uploaded_by, note) values (p_request, 'delivery', auth.uid(), left(coalesce(p_note, 'Dropped off by donor'), 500));
end $$;

create or replace function list_my_donations() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(kr_donation_view(id) order by created_at desc), '[]') from donation_requests where donor_user_id = auth.uid()
$$;

create or replace function get_donation(p_id_or_code text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v uuid;
begin
  perform kr_me();
  select id into v from donation_requests where id::text = p_id_or_code or code = upper(p_id_or_code);
  if v is null then raise exception 'not_found: donation request' using errcode = 'P0002'; end if;
  return kr_donation_view(v);
end $$;

create or replace function list_my_addresses() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', a.id, 'userId', a.user_id, 'line1', a.address_line, 'landmark', a.landmark,
    'locality', a.locality, 'pinCode', a.postal_code, 'instructions', a.access_instructions)) order by a.created_at desc), '[]')
  from pickup_addresses a where a.user_id = auth.uid()
$$;

create or replace function file_report(p_kind text, p_message text, p_request uuid default null, p_org uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform kr_me();
  perform kr_rate_limit('report', 10, interval '1 day');
  if p_request is not null and not kr_can_view_request(p_request) then raise exception 'forbidden: no access to this request' using errcode = '42501'; end if;
  if char_length(trim(coalesce(p_message, ''))) < 10 then raise exception 'invalid: please describe the issue in a little more detail' using errcode = '22023'; end if;
  insert into reports_and_disputes (reporter_id, request_id, org_id, kind, message) values (auth.uid(), p_request, p_org, p_kind, left(trim(p_message), 2000)) returning id into v_id;
  perform kr_audit('report.created', 'report', v_id::text, p_kind);
  perform kr_notify(kr_admin_ids(), 'report', 'New report', p_kind || ': ' || left(trim(p_message), 80), '/admin', p_request);
end $$;

-- ---------------------------------------------------------------- organisation RPCs
create or replace function register_organization(payload jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v organizations; v_slug text; c text; me profiles;
begin
  me := kr_me();
  perform kr_rate_limit('org_register', 3, interval '1 day');
  if kr_staff_org() is not null then raise exception 'invalid: your account is already linked to an organisation' using errcode = '22023'; end if;
  if char_length(trim(coalesce(payload->>'name', ''))) < 3 then raise exception 'invalid: enter the organisation''s registered name' using errcode = '22023'; end if;
  if char_length(trim(coalesce(payload->>'address', ''))) < 8 then raise exception 'invalid: enter the full address' using errcode = '22023'; end if;
  if char_length(trim(coalesce(payload->>'registrationNumber', ''))) < 3 then raise exception 'invalid: enter the registration number' using errcode = '22023'; end if;
  if coalesce(payload->>'publicEmail', '') !~* '^[^@\s]+@[^@\s]+\.[^@\s]{2,}$' then raise exception 'invalid: enter a valid contact email' using errcode = '22023'; end if;
  if jsonb_array_length(coalesce(payload->'acceptedCategories', '[]')) = 0 then raise exception 'invalid: choose at least one accepted category' using errcode = '22023'; end if;
  if exists (select 1 from organizations where lower(regexp_replace(name, '[^a-zA-Z0-9]+', '', 'g')) = lower(regexp_replace(payload->>'name', '[^a-zA-Z0-9]+', '', 'g'))) then
    raise exception 'invalid: an organisation with a very similar name is already registered — contact support to be added as staff' using errcode = '22023';
  end if;
  v_slug := trim(both '-' from left(regexp_replace(lower(payload->>'name'), '[^a-z0-9]+', '-', 'g'), 40));
  while exists (select 1 from organizations where slug = v_slug) loop v_slug := v_slug || '-1'; end loop;
  insert into organizations (owner_user_id, slug, name, organization_type, description, locality, address, postal_code, lat, lng,
                             public_contact_phone, public_contact_email, website, registration_type, registration_number, accepted_donation_methods, pickup_slots)
  values (me.id, v_slug, trim(payload->>'name'), (payload->>'type')::org_type, left(coalesce(payload->>'intro', ''), 2000), payload->>'locality', trim(payload->>'address'),
          payload->>'pinCode', (payload->>'lat')::float8, (payload->>'lng')::float8, nullif(trim(payload->>'publicPhone'), ''), trim(payload->>'publicEmail'),
          nullif(trim(payload->>'website'), ''), payload->>'registrationType', trim(payload->>'registrationNumber'),
          (select array_agg(x::delivery_method) from jsonb_array_elements_text(payload->'deliveryMethods') x), '{09:00 – 12:00,15:00 – 18:00}')
  returning * into v;
  for c in select jsonb_array_elements_text(payload->'acceptedCategories') loop
    insert into organization_item_policies (org_id, category_id) values (v.id, c);
  end loop;
  -- staff role on an UNVERIFIED organisation: can edit its own pending profile and upload documents only.
  -- Receiving or accepting donations requires verification_status = 'approved', set only by an admin.
  insert into user_roles (user_id, role, org_id, granted_by) values (me.id, 'org_staff', v.id, null);
  perform kr_audit('organization.registered', 'organization', v.id::text, v.name);
  perform kr_notify(kr_admin_ids(), 'org_registered', 'New organisation registration', v.name || ' (' || v.locality || ') is awaiting verification.', '/admin');
  return kr_org_json(v, true);
end $$;

create or replace function get_my_organization() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare o organizations;
begin
  perform kr_me();
  select * into o from organizations where id = kr_staff_org();
  if not found then return null; end if;
  return jsonb_build_object('org', kr_org_json(o, true),
    'policies', coalesce((select jsonb_agg(kr_policy_json(p)) from organization_item_policies p where p.org_id = o.id), '[]'),
    'needs', coalesce((select jsonb_agg(kr_need_json(n) order by n.created_at) from organization_needs n where n.org_id = o.id), '[]'),
    'docs', coalesce((select jsonb_agg(kr_doc_json(d) order by d.uploaded_at) from organization_verification_documents d where d.org_id = o.id), '[]'));
end $$;

-- Staff edit profile fields only; verification fields are admin-only. Changing contact details resets contact verification.
create or replace function org_update_profile(patch jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid := kr_staff_org(); o organizations; v_contact boolean;
begin
  perform kr_me();
  if v_org is null then raise exception 'forbidden: only authorised organisation staff can do this' using errcode = '42501'; end if;
  select * into o from organizations where id = v_org for update;
  if patch ? 'publicEmail' and coalesce(patch->>'publicEmail', '') !~* '^[^@\s]+@[^@\s]+\.[^@\s]{2,}$' then raise exception 'invalid: enter a valid email' using errcode = '22023'; end if;
  if patch ? 'deliveryMethods' and jsonb_array_length(patch->'deliveryMethods') = 0 then raise exception 'invalid: keep at least one delivery method' using errcode = '22023'; end if;
  v_contact := (patch ? 'publicPhone' and patch->>'publicPhone' is distinct from o.public_contact_phone)
            or (patch ? 'publicEmail' and patch->>'publicEmail' is distinct from o.public_contact_email);
  update organizations set
    description = case when patch ? 'intro' then left(coalesce(patch->>'intro', ''), 2000) else description end,
    public_contact_phone = case when patch ? 'publicPhone' then nullif(trim(patch->>'publicPhone'), '') else public_contact_phone end,
    public_contact_email = case when patch ? 'publicEmail' then trim(patch->>'publicEmail') else public_contact_email end,
    website = case when patch ? 'website' then nullif(trim(patch->>'website'), '') else website end,
    accepted_donation_methods = case when patch ? 'deliveryMethods' then (select array_agg(x::delivery_method) from jsonb_array_elements_text(patch->'deliveryMethods') x) else accepted_donation_methods end,
    dropoff_hours = case when patch ? 'dropoffHours' then nullif(trim(patch->>'dropoffHours'), '') else dropoff_hours end,
    pickup_slots = case when patch ? 'pickupSlots' then (select coalesce(array_agg(x), '{}') from jsonb_array_elements_text(patch->'pickupSlots') x) else pickup_slots end,
    condition_rules = case when patch ? 'conditionRules' then left(coalesce(patch->>'conditionRules', ''), 2000) else condition_rules end,
    restrictions = case when patch ? 'restrictions' then (select coalesce(array_agg(x), '{}') from jsonb_array_elements_text(patch->'restrictions') x) else restrictions end,
    show_impact = case when patch ? 'showImpact' then (patch->>'showImpact')::boolean else show_impact end,
    contact_verified = case when v_contact then false else contact_verified end
  where id = v_org;
  perform kr_audit('organization.updated', 'organization', v_org::text, (select string_agg(k, ', ') from jsonb_object_keys(patch) k));
  if v_contact then perform kr_notify(kr_admin_ids(), 'org_contact_changed', 'Contact details changed', o.name || ' changed its public contact details — re-verify.', '/admin'); end if;
end $$;

create or replace function org_save_policy(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid := kr_staff_org(); v_status acceptance_status := coalesce(p->>'acceptance', 'accepts')::acceptance_status;
begin
  perform kr_me();
  if v_org is null then raise exception 'forbidden: only authorised organisation staff can do this' using errcode = '42501'; end if;
  insert into organization_item_policies (org_id, category_id, acceptance_status, condition_requirements, quantity_limit, restrictions, min_shelf_life_days, max_hours_since_prep)
  values (v_org, p->>'categoryId', v_status,
          coalesce((select array_agg(x::item_condition) from jsonb_array_elements_text(p->'conditionsAccepted') x), '{}'),
          (p->>'quantityLimit')::int, nullif(left(trim(p->>'notes'), 300), ''), (p->>'minShelfLifeDays')::int, (p->>'maxHoursSincePrep')::int)
  on conflict (org_id, category_id) do update set acceptance_status = excluded.acceptance_status, condition_requirements = excluded.condition_requirements,
    quantity_limit = excluded.quantity_limit, restrictions = excluded.restrictions, min_shelf_life_days = excluded.min_shelf_life_days,
    max_hours_since_prep = excluded.max_hours_since_prep;
  -- a category that is no longer accepted cannot keep advertising open needs
  if v_status = 'does_not_accept' then
    update organization_needs set need_status = 'closed' where org_id = v_org and category_id = p->>'categoryId' and need_status = 'open';
  end if;
  perform kr_audit('policy.saved', 'organization_item_policy', v_org::text, (p->>'categoryId') || ': ' || v_status);
end $$;

create or replace function org_save_need(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid := kr_staff_org(); v_id uuid := nullif(p->>'id', '')::uuid; v_qty int := (p->>'quantity')::int;
begin
  perform kr_me();
  if v_org is null then raise exception 'forbidden: only authorised organisation staff can do this' using errcode = '42501'; end if;
  if char_length(trim(coalesce(p->>'title', ''))) < 3 then raise exception 'invalid: describe the need' using errcode = '22023'; end if;
  if v_qty is not null and v_qty not between 1 and 10000 then raise exception 'invalid: quantity must be between 1 and 10,000' using errcode = '22023'; end if;
  if not exists (select 1 from organization_item_policies where org_id = v_org and category_id = p->>'categoryId' and acceptance_status = 'accepts') then
    raise exception 'invalid: set this category to “Accepts” in your item rules first' using errcode = '22023';
  end if;
  if v_id is null then
    insert into organization_needs (org_id, category_id, item_name, description, tags, requested_quantity, quantity_unit, urgency)
    values (v_org, p->>'categoryId', trim(p->>'title'), nullif(left(trim(p->>'note'), 500), ''),
            coalesce((select array_agg(lower(trim(x))) from jsonb_array_elements_text(p->'tags') x), '{}'), v_qty, (p->>'unit')::item_unit,
            coalesce(p->>'urgency', 'medium')::urgency_level);
  else
    update organization_needs set category_id = p->>'categoryId', item_name = trim(p->>'title'), description = nullif(left(trim(p->>'note'), 500), ''),
      tags = coalesce((select array_agg(lower(trim(x))) from jsonb_array_elements_text(p->'tags') x), '{}'), requested_quantity = v_qty,
      quantity_unit = (p->>'unit')::item_unit, urgency = coalesce(p->>'urgency', 'medium')::urgency_level, need_status = 'open', last_confirmed_at = now()
    where id = v_id and org_id = v_org;
    if not found then raise exception 'not_found: need' using errcode = 'P0002'; end if;
  end if;
  perform kr_audit('need.saved', 'organization_need', v_org::text, left(p->>'title', 100));
end $$;

create or replace function org_confirm_need(p_need uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform kr_me();
  update organization_needs set last_confirmed_at = now(), need_status = 'open' where id = p_need and org_id = kr_staff_org();
  if not found then raise exception 'not_found: need' using errcode = 'P0002'; end if;
end $$;

create or replace function org_close_need(p_need uuid, p_outcome text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform kr_me();
  if p_outcome not in ('fulfilled', 'closed') then raise exception 'invalid: outcome must be fulfilled or closed' using errcode = '22023'; end if;
  update organization_needs set need_status = p_outcome::need_status where id = p_need and org_id = kr_staff_org();
  if not found then raise exception 'not_found: need' using errcode = 'P0002'; end if;
  perform kr_audit('need.' || p_outcome, 'organization_need', p_need::text);
end $$;

create or replace function org_add_document(p_type text, p_file_name text, p_path text) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid := kr_staff_org(); o organizations;
begin
  perform kr_me();
  if v_org is null then raise exception 'forbidden: only authorised organisation staff can do this' using errcode = '42501'; end if;
  if p_path is null or not kr_own_path(p_path) then raise exception 'forbidden: upload the file from this account first' using errcode = '42501'; end if;
  perform kr_rate_limit('org_document', 20, interval '1 day');
  insert into organization_verification_documents (org_id, document_type, file_name, storage_path, uploaded_by)
  values (v_org, left(trim(p_type), 80), left(p_file_name, 200), p_path, auth.uid());
  update organizations set verification_status = 'pending' where id = v_org and verification_status = 'needs_info' returning * into o;
  select * into o from organizations where id = v_org;
  perform kr_audit('document.uploaded', 'organization', v_org::text, p_type);
  perform kr_notify(kr_admin_ids(), 'org_document', 'Verification document uploaded', o.name || ': ' || p_type, '/admin');
end $$;

create or replace function list_org_requests() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(kr_donation_view(id) order by created_at desc), '[]')
  from donation_requests where organization_id = kr_staff_org() and status <> 'draft'
$$;

create or replace function kr_open_job(p_request uuid, p_actor actor_kind) returns void
language plpgsql security definer set search_path = public as $$
declare v_size text;
begin
  perform kr_apply_transition(p_request, 'awaiting_delivery_partner', p_actor);
  select case when bool_or(category_id = 'furniture') then 'large'
              when sum(case when quantity_unit = 'kg' then quantity / 5.0 when quantity_unit in ('bags', 'boxes') then quantity * 3 else quantity end) > 40 then 'large'
              when sum(case when quantity_unit = 'kg' then quantity / 5.0 when quantity_unit in ('bags', 'boxes') then quantity * 3 else quantity end) > 12 then 'medium'
              else 'small' end
    into v_size from donation_request_items where donation_request_id = p_request;
  insert into delivery_jobs (donation_request_id, package_size) values (p_request, v_size)
  on conflict (donation_request_id) do update set assignment_status = 'open', partner_id = null, partner_user_id = null, accepted_at = null,
    pickup_confirmed_at = null, delivery_confirmed_at = null, version = delivery_jobs.version + 1;
  update donation_requests set delivery_partner_id = null where id = p_request;
end $$;

create or replace function org_decide(p_request uuid, p_decision text, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare r donation_requests;
begin
  perform kr_me();
  select * into r from donation_requests where id = p_request;
  if not found or r.organization_id is distinct from kr_staff_org() then raise exception 'forbidden: this request is not addressed to your organisation' using errcode = '42501'; end if;
  if (select verification_status from organizations where id = r.organization_id) <> 'approved' then
    raise exception 'forbidden: your organisation must be verified before responding to donations' using errcode = '42501'; end if;
  if p_decision = 'reject' then
    if char_length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'invalid: please give the donor a reason' using errcode = '22023'; end if;
    update donation_requests set rejection_reason = left(trim(p_reason), 500), organization_response = left(trim(p_reason), 500) where id = p_request;
    perform kr_apply_transition(p_request, 'rejected', 'org', p_reason);
  elsif p_decision = 'accept' then
    if r.flagged is not null then raise exception 'forbidden: this request is held for administrator review before it can be accepted' using errcode = '42501'; end if;
    update donation_requests set organization_response = nullif(left(trim(p_reason), 500), '') where id = p_request;
    perform kr_apply_transition(p_request, 'organization_accepted', 'org', p_reason);
    if r.delivery_method = 'partner_pickup' then perform kr_open_job(p_request, 'system'); end if;
  else
    raise exception 'invalid: decision must be accept or reject' using errcode = '22023';
  end if;
end $$;

create or replace function org_confirm_receipt(p_request uuid, p_note text, p_photo text) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid := kr_staff_org();
begin
  perform kr_me();
  if v_org is null or (select organization_id from donation_requests where id = p_request) is distinct from v_org then
    raise exception 'forbidden: only the receiving organisation can confirm receipt' using errcode = '42501'; end if;
  if not kr_own_path(p_photo) then raise exception 'forbidden: photo must be uploaded by you' using errcode = '42501'; end if;
  perform kr_apply_transition(p_request, 'completed', 'org', coalesce(p_note, 'Receipt confirmed'));
  insert into donation_proofs (donation_request_id, kind, uploaded_by, note, photo_path) values (p_request, 'receipt', auth.uid(), left(coalesce(p_note, 'Received'), 500), p_photo);
  update delivery_jobs set assignment_status = 'done' where donation_request_id = p_request;
  update organization_needs n set fulfilled_quantity = fulfilled_quantity + i.quantity
    from donation_request_items i
    where i.donation_request_id = p_request and n.org_id = v_org and n.need_status = 'open' and n.category_id = i.category_id
      and (n.quantity_unit is null or n.quantity_unit = i.quantity_unit);
end $$;

create or replace function org_report_not_received(p_request uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid := kr_staff_org();
begin
  perform kr_me();
  if v_org is null or (select organization_id from donation_requests where id = p_request) is distinct from v_org then
    raise exception 'forbidden: this request is not addressed to your organisation' using errcode = '42501'; end if;
  if char_length(trim(coalesce(p_reason, ''))) < 5 then raise exception 'invalid: describe what happened' using errcode = '22023'; end if;
  update donation_requests set failure_reason = 'Organisation reports: ' || left(trim(p_reason), 450) where id = p_request;
  perform kr_apply_transition(p_request, 'failed', 'org', p_reason);
  insert into reports_and_disputes (reporter_id, request_id, org_id, kind, message)
    values (auth.uid(), p_request, v_org, 'dispute', left('Marked delivered but not received: ' || trim(p_reason), 2000));
end $$;

create or replace function org_reoffer(p_request uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform kr_me();
  if (select organization_id from donation_requests where id = p_request) is distinct from kr_staff_org() then
    raise exception 'forbidden: this request is not addressed to your organisation' using errcode = '42501'; end if;
  perform kr_open_job(p_request, 'org');
end $$;

-- ---------------------------------------------------------------- delivery partner RPCs
create or replace function apply_as_partner(payload jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v delivery_partners; me profiles;
begin
  me := kr_me();
  if exists (select 1 from delivery_partners where user_id = me.id) then raise exception 'invalid: you have already applied' using errcode = '22023'; end if;
  if coalesce((payload->>'consent')::boolean, false) is not true then raise exception 'invalid: please accept the partner terms and background-verification consent' using errcode = '22023'; end if;
  if char_length(trim(coalesce(payload->>'fullName', ''))) < 3 then raise exception 'invalid: enter your full legal name as on your ID' using errcode = '22023'; end if;
  if payload->>'idStoragePath' is null or not kr_own_path(payload->>'idStoragePath') then raise exception 'invalid: upload a photo of a government ID' using errcode = '22023'; end if;
  insert into delivery_partners (user_id, full_name, phone, transport_type, service_localities)
  values (me.id, trim(payload->>'fullName'), me.phone_number, payload->>'vehicle',
          coalesce((select array_agg(x) from jsonb_array_elements_text(payload->'serviceLocalities') x), '{}'))
  returning * into v;
  insert into partner_verification_documents (partner_id, document_type, file_name, storage_path)
  values (v.id, 'Government photo ID', left(coalesce(payload->>'idFileName', 'id'), 200), payload->>'idStoragePath');
  perform kr_audit('partner.applied', 'delivery_partner', v.id::text);
  perform kr_notify(kr_admin_ids(), 'partner_applied', 'New delivery partner application', v.full_name || ' · ' || v.transport_type, '/admin');
  return kr_partner_json(v);
end $$;

create or replace function get_my_partner_profile() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('partner', kr_partner_json(p),
    'docs', coalesce((select jsonb_agg(kr_pdoc_json(d)) from partner_verification_documents d where d.partner_id = p.id), '[]'))
  from delivery_partners p where p.user_id = auth.uid()
$$;

create or replace function set_partner_availability(p_available boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform kr_me();
  if kr_partner_id() is null then raise exception 'forbidden: only approved delivery partners can do this' using errcode = '42501'; end if;
  update delivery_partners set availability_status = p_available where id = kr_partner_id();
  perform kr_audit(case when p_available then 'partner.online' else 'partner.offline' end, 'delivery_partner', kr_partner_id()::text);
end $$;

-- Open jobs for an approved, online partner in their service area. Pickup locality only — no address.
create or replace function list_available_jobs() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform kr_me();
  if kr_partner_id() is null then raise exception 'forbidden: only approved delivery partners can do this' using errcode = '42501'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object(
    'job', kr_job_json(j), 'requestCode', r.code, 'status', r.status, 'pickupLocality', coalesce(a.locality, 'Pune'),
    'destinationLocality', o.locality, 'destinationName', o.name,
    'categories', (select jsonb_agg(distinct i.category_id) from donation_request_items i where i.donation_request_id = r.id),
    'itemCount', (select sum(i.quantity) from donation_request_items i where i.donation_request_id = r.id),
    'preferredDate', r.pickup_date, 'preferredSlot', r.pickup_time_slot) order by j.created_at), '[]')
  from delivery_jobs j
  join donation_requests r on r.id = j.donation_request_id
  join organizations o on o.id = r.organization_id
  left join pickup_addresses a on a.id = r.pickup_address_id
  join delivery_partners p on p.id = kr_partner_id()
  where j.assignment_status = 'open' and r.status = 'awaiting_delivery_partner' and p.availability_status
    and (cardinality(p.service_localities) = 0 or a.locality = any (p.service_localities)));
end $$;

create or replace function list_my_jobs() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform kr_me();
  if kr_partner_id() is null then raise exception 'forbidden: only approved delivery partners can do this' using errcode = '42501'; end if;
  return (select coalesce(jsonb_agg(kr_donation_view(j.donation_request_id) order by j.updated_at desc), '[]')
          from delivery_jobs j where j.partner_id = kr_partner_id() and j.assignment_status in ('claimed', 'done'));
end $$;

-- Compare-and-swap claim: the UPDATE only matches an OPEN job at the version the partner saw, and the row
-- lock taken by UPDATE serialises concurrent claims — exactly one partner can win.
create or replace function claim_delivery_job(p_job uuid, p_expected_version int) returns void
language plpgsql security definer set search_path = public as $$
declare v_partner uuid := kr_partner_id(); v_req uuid;
begin
  perform kr_me();
  if v_partner is null then raise exception 'forbidden: only approved delivery partners can accept jobs' using errcode = '42501'; end if;
  if not (select availability_status from delivery_partners where id = v_partner) then raise exception 'invalid: go online before accepting jobs' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('partner-claims:' || v_partner::text, 0));
  if (select count(*) from delivery_jobs where partner_id = v_partner and assignment_status = 'claimed') >= 3 then
    raise exception 'invalid: you can hold at most 3 active jobs at a time' using errcode = '22023'; end if;
  update delivery_jobs set assignment_status = 'claimed', partner_id = v_partner, partner_user_id = auth.uid(), accepted_at = now(), version = version + 1
   where id = p_job and assignment_status = 'open' and version = p_expected_version
     and exists (select 1 from donation_requests r where r.id = donation_request_id and r.status = 'awaiting_delivery_partner')
   returning donation_request_id into v_req;
  if v_req is null then raise exception 'conflict: another partner has just accepted this job' using errcode = '40001'; end if;
  update donation_requests set delivery_partner_id = v_partner where id = v_req;
  perform kr_apply_transition(v_req, 'delivery_partner_assigned', 'partner');
end $$;

create or replace function release_job(p_request uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform kr_me();
  if not exists (select 1 from delivery_jobs where donation_request_id = p_request and partner_id = kr_partner_id() and assignment_status = 'claimed') then
    raise exception 'forbidden: this job is not assigned to you' using errcode = '42501'; end if;
  if char_length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'invalid: give a short reason so the job can be re-offered' using errcode = '22023'; end if;
  perform kr_apply_transition(p_request, 'awaiting_delivery_partner', 'partner', 'Released: ' || p_reason);
  update delivery_jobs set assignment_status = 'open', partner_id = null, partner_user_id = null, accepted_at = null, version = version + 1 where donation_request_id = p_request;
  update donation_requests set delivery_partner_id = null where id = p_request;
end $$;

create or replace function partner_advance(p_request uuid, p_to donation_status, p_note text, p_photo text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform kr_me();
  if not exists (select 1 from delivery_jobs where donation_request_id = p_request and partner_id = kr_partner_id() and assignment_status = 'claimed') then
    raise exception 'forbidden: this job is not assigned to you' using errcode = '42501'; end if;
  if p_to not in ('pickup_scheduled', 'picked_up', 'in_transit', 'delivered_pending_receipt_confirmation', 'failed') then
    raise exception 'forbidden: partners cannot set this status' using errcode = '42501'; end if;
  if not kr_own_path(p_photo) then raise exception 'forbidden: photo must be uploaded by you' using errcode = '42501'; end if;
  if p_to = 'delivered_pending_receipt_confirmation' and p_photo is null and char_length(trim(coalesce(p_note, ''))) < 3 then
    raise exception 'invalid: delivery proof is required — add a photo or the name of the person who received it' using errcode = '22023'; end if;
  if p_to = 'failed' then
    if char_length(trim(coalesce(p_note, ''))) < 5 then raise exception 'invalid: describe why the delivery failed' using errcode = '22023'; end if;
    update donation_requests set failure_reason = left(trim(p_note), 500) where id = p_request;
  end if;
  perform kr_apply_transition(p_request, p_to, 'partner', p_note);
  if p_to = 'picked_up' then
    update delivery_jobs set pickup_confirmed_at = now(), pickup_proof_path = p_photo where donation_request_id = p_request;
  elsif p_to = 'delivered_pending_receipt_confirmation' then
    update delivery_jobs set delivery_confirmed_at = now(), delivery_proof_path = p_photo where donation_request_id = p_request;
  end if;
  if p_to in ('picked_up', 'delivered_pending_receipt_confirmation') then
    insert into donation_proofs (donation_request_id, kind, uploaded_by, note, photo_path)
    values (p_request, case when p_to = 'picked_up' then 'pickup' else 'delivery' end, auth.uid(), left(p_note, 500), p_photo);
  end if;
  if p_to = 'failed' then update delivery_jobs set assignment_status = 'cancelled', version = version + 1 where donation_request_id = p_request; end if;
end $$;

-- ---------------------------------------------------------------- auth hooks: profile + donor role on signup
create or replace function kr_handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, full_name, email, email_verified, phone_number, phone_verified)
  values (new.id, left(coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'), ''), 'KindRoute member'), 120), new.email,
          new.email_confirmed_at is not null, nullif(new.phone, ''), new.phone_confirmed_at is not null)
  on conflict (id) do nothing;
  -- every new account is a donor; nothing in user metadata can grant another role
  insert into user_roles (user_id, role) values (new.id, 'donor') on conflict do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function kr_handle_new_user();

create or replace function kr_sync_auth_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update profiles set
    email = new.email, email_verified = new.email_confirmed_at is not null,
    phone_number = nullif(new.phone, ''), phone_verified = new.phone_confirmed_at is not null
  where id = new.id;
  update delivery_partners set phone = nullif(new.phone, '') where user_id = new.id and new.phone_confirmed_at is not null;
  return new;
end $$;
create trigger on_auth_user_updated after update of email, email_confirmed_at, phone, phone_confirmed_at on auth.users
  for each row execute function kr_sync_auth_user();
