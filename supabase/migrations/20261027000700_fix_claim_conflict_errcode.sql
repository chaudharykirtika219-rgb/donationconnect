-- KindRoute 7 — fix found by the live test on a real Supabase project.
-- When two partners claim the same job, the loser got errcode 40001 (serialization_failure).
-- PostgREST automatically retries transactions that fail with 40001, so the losing request was retried
-- forever and never answered. The claim itself was always correct (exactly one winner); only the loser's
-- response hung. Same function, with a non-retryable errcode (P0001). No data changes. Safe to re-run.
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
  if v_req is null then raise exception 'conflict: another partner has just accepted this job' using errcode = 'P0001'; end if;
  update donation_requests set delivery_partner_id = v_partner where id = v_req;
  perform kr_apply_transition(v_req, 'delivery_partner_assigned', 'partner');
end $$;
