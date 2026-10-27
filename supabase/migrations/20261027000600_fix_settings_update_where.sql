-- KindRoute 6 — fix found by the live test on a real Supabase project.
-- Supabase rejects UPDATE statements without a WHERE clause when they come through the API
-- ("UPDATE requires a WHERE clause"). admin_update_settings updated the single settings row without one.
-- This replaces only that function (same behaviour, plus WHERE id). No data changes. Safe to run more than once.
create or replace function admin_update_settings(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform kr_require_admin();
  update app_settings set
    need_freshness_days = coalesce((p->>'needFreshnessDays')::int, need_freshness_days),
    require_phone_for_donation = coalesce((p->>'requirePhoneForDonation')::boolean, require_phone_for_donation),
    max_submissions_per_day = coalesce((p->>'maxSubmissionsPerDay')::int, max_submissions_per_day)
  where id;
  perform kr_audit('settings.updated', 'app_settings', 'singleton', left(p::text, 300));
end $$;
