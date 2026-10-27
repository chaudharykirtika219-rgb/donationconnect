-- KindRoute DEMO / STAGING seed — fictional records only, every row flagged is_demo = true.
--
-- NEVER run this on production. It refuses to run unless app_settings.environment is 'staging' or
-- 'development'. Use a separate Supabase project for demos:
--   update app_settings set environment = 'staging';      -- on the staging project only
--   \i supabase/seed/demo_seed.sql                          -- or paste into the SQL editor
--
-- The names below are invented. Contact details use the reserved example.org domain and the
-- unassignable +91 00000 range; addresses are generic and say they are fictional. No real Pune
-- organisation, verification or need is represented. Requires at least one admin (verified_by).

do $$
declare
  v_admin uuid := (select user_id from user_roles where role = 'admin' order by created_at limit 1);
  v_env text := (select environment from app_settings);
  v_org uuid;
  r record;
begin
  if v_env not in ('staging', 'development') then
    raise exception 'demo seed refused: app_settings.environment is %, not staging/development', v_env;
  end if;
  if v_admin is null then raise exception 'demo seed needs an administrator first (see README → first administrator)'; end if;

  for r in select * from (values
    ('demo-sunbeam-childrens-home', 'Sunbeam Children’s Home (demo)', 'children_home'::org_type, 'Kothrud', '411038', 18.5074, 73.8077, '{books,clothes,toys,hygiene}'::text[]),
    ('demo-banyan-elders-residence', 'Banyan Elders’ Residence (demo)', 'old_age_home', 'Aundh', '411007', 18.5590, 73.8075, '{bedding,hygiene,medical,clothes}'),
    ('demo-open-hearth-kitchen', 'Open Hearth Community Kitchen (demo)', 'community_kitchen', 'Hadapsar', '411028', 18.5089, 73.9260, '{packaged_food,fresh_food,other}'),
    ('demo-lanterns-learning-ngo', 'Lanterns Learning Trust (demo)', 'ngo', 'Yerawada', '411006', 18.5529, 73.8796, '{books,furniture,toys}')
  ) as t(slug, name, typ, loc, pin, lat, lng, cats)
  loop
    insert into organizations (slug, name, organization_type, description, address, locality, postal_code, lat, lng, public_contact_phone, public_contact_email,
                               contact_verified, verification_status, verified_at, verified_by, verification_notes, next_review_due, accepted_donation_methods,
                               dropoff_hours, pickup_slots, is_demo)
    values (r.slug, r.name, r.typ, 'Fictional demo organisation for testing KindRoute. Not a real organisation.', 'Fictional demo address, ' || r.loc || ', Pune',
            r.loc, r.pin, r.lat, r.lng, '+91 00000 00000', 'demo@example.org', true, 'approved', now(), v_admin,
            'DEMO RECORD — no real verification was performed.', now() + interval '365 days', '{partner_pickup,donor_dropoff}',
            'Mon–Sat, 10:00 – 17:00', '{09:00 – 12:00,15:00 – 18:00}', true)
    on conflict (slug) do nothing
    returning id into v_org;
    if v_org is null then continue; end if;
    insert into organization_item_policies (org_id, category_id, min_shelf_life_days, max_hours_since_prep)
    select v_org, c, case when c = 'packaged_food' then 30 end, case when c = 'fresh_food' then 4 end from unnest(r.cats) c;
    insert into organization_needs (org_id, category_id, item_name, description, urgency)
    values (v_org, r.cats[1], 'Demo need: ' || (select name from item_categories where id = r.cats[1]), 'Fictional need for demonstration only.', 'medium');
  end loop;
end $$;
