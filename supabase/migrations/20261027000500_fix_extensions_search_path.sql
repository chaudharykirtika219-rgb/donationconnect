-- KindRoute 5 — fix found by the live test on a real Supabase project.
-- Supabase installs pgcrypto in the "extensions" schema, so gen_random_bytes() (used to generate request
-- codes in submit_donation) was not visible with search_path = public. This only widens that function's
-- search path; no data or other objects change. Safe to run more than once.
alter function public.submit_donation(jsonb) set search_path = public, extensions;
