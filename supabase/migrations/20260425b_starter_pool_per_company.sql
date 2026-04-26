-- Pool the 3-free-claim starter cap per COMPANY (not per user).
-- Decision 2026-04-25: closes the multi-email-signup loophole where a single
-- crew of N people would get 3 × N free claims. After this, all teammates
-- share one canonical starter row; their pooled lifetime_claims_used hits 3
-- once across the company.
--
-- Solo users (no company_id) are unaffected — their own row IS the team row.
--
-- Strategy: change ordering inside resolve_user_subscription so that for
-- starter rows we prefer the OLDEST row in the company (canonical), not the
-- requester's own. Then teach increment_claim_usage to skip insert when
-- a team starter row already exists.

drop function if exists public.resolve_user_subscription(uuid);
drop function if exists public.increment_claim_usage(uuid);

create or replace function public.resolve_user_subscription(p_user_id uuid)
returns public.subscriptions
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_sub public.subscriptions;
begin
  -- Auth guard: authenticated callers may only query themselves OR a teammate.
  -- Service role (auth.uid() is null) bypasses for processor/webhooks.
  if auth.uid() is not null and auth.uid() <> p_user_id then
    if not exists (
      select 1
        from public.company_profiles me
        join public.company_profiles them
          on me.company_id = them.company_id and me.company_id is not null
       where me.user_id = auth.uid()
         and them.user_id = p_user_id
    ) then
      raise exception 'forbidden' using errcode = '42501';
    end if;
  end if;

  with user_company as (
    select company_id
      from public.company_profiles
     where user_id = p_user_id
     limit 1
  ),
  candidate as (
    select s.*
      from public.subscriptions s
     where s.user_id = p_user_id
        or s.company_id = (select company_id from user_company)
        or exists (
          select 1 from public.company_profiles cp
           where cp.user_id = s.user_id
             and cp.company_id = (select company_id from user_company)
        )
  )
  select * into v_sub from candidate
  order by
    case status when 'active' then 0 when 'past_due' then 1 else 2 end,
    case plan_id
      when 'enterprise' then 4
      when 'growth'     then 3
      when 'pro'        then 2
      when 'sales_rep'  then 1
      else 0
    end desc,
    -- For PAID tiers, prefer the requester's own row (clearer ownership).
    -- For STARTER, prefer the OLDEST team row (canonical pooled counter).
    case
      when plan_id = 'starter' then created_at
      else case when user_id = p_user_id then '1970-01-01'::timestamptz
                else '9999-01-01'::timestamptz end
    end asc,
    created_at asc
  limit 1;

  return v_sub;
end;
$$;

create or replace function public.increment_claim_usage(p_user_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_sub public.subscriptions;
  v_target_company uuid;
  v_period_used int;
  v_lifetime_used int;
begin
  -- Auth guard: authenticated callers may only increment their own counter.
  -- Service role bypass.
  if auth.uid() is not null and auth.uid() <> p_user_id then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  v_sub := public.resolve_user_subscription(p_user_id);

  if v_sub.id is not null then
    -- Increment the resolved subscription. For team-pooled starter, this
    -- ticks the SHARED row, so a 5-person crew burns through 3 free claims
    -- collectively, not 3 each.
    update public.subscriptions
       set claims_used_this_period = claims_used_this_period + 1,
           lifetime_claims_used    = lifetime_claims_used + 1,
           updated_at              = now()
     where id = v_sub.id
     returning claims_used_this_period, lifetime_claims_used
     into v_period_used, v_lifetime_used;

    return jsonb_build_object(
      'ok', true,
      'subscription_id', v_sub.id,
      'subscription_user_id', v_sub.user_id,
      'plan_id', v_sub.plan_id,
      'period_used', v_period_used,
      'lifetime_used', v_lifetime_used,
      'team_pooled', v_sub.user_id <> p_user_id
    );
  end if;

  -- No subscription row found anywhere in the user's scope (not their own,
  -- not their company's). Create a starter row owned by this user. If they
  -- have a company_id, the row also carries it so future teammates resolve
  -- to this same row via the OLDEST-team-starter preference above.
  select company_id into v_target_company
    from public.company_profiles
   where user_id = p_user_id
   limit 1;

  insert into public.subscriptions(
    user_id,
    company_id,
    stripe_customer_id,
    plan_id,
    status,
    claims_used_this_period,
    lifetime_claims_used
  ) values (
    p_user_id,
    v_target_company,
    'pending_' || p_user_id::text,
    'starter',
    'active',
    1,
    1
  )
  on conflict (user_id) do update
    set claims_used_this_period = public.subscriptions.claims_used_this_period + 1,
        lifetime_claims_used    = public.subscriptions.lifetime_claims_used + 1,
        updated_at              = now()
  returning claims_used_this_period, lifetime_claims_used
  into v_period_used, v_lifetime_used;

  return jsonb_build_object(
    'ok', true,
    'subscription_user_id', p_user_id,
    'plan_id', 'starter',
    'period_used', v_period_used,
    'lifetime_used', v_lifetime_used,
    'team_pooled', false
  );
end;
$$;

grant execute on function public.resolve_user_subscription(uuid) to authenticated, service_role;
grant execute on function public.increment_claim_usage(uuid)     to authenticated, service_role;
