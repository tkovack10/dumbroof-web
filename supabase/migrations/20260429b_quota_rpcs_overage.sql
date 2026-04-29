-- Update assert_quota_allowed + increment_claim_usage to support overage mode.
--
-- Behavior change:
-- - Pro / Growth / Enterprise at-cap: returns allowed=true, mode='overage' so
--   the user keeps submitting; processor.py meters $75/claim to Stripe.
-- - Starter at-cap: unchanged (allowed=false, mode='blocked').
-- - sales_rep: unchanged (always allowed when active).
--
-- Single source of truth for the unit price in cents (7500). Mirror in
-- src/lib/stripe-config.ts:OVERAGE_UNIT_PRICE_CENTS if you ever change it.

drop function if exists public.assert_quota_allowed(uuid);
drop function if exists public.increment_claim_usage(uuid);

-- ---------------------------------------------------------------------------
-- assert_quota_allowed — extended response
-- ---------------------------------------------------------------------------
create or replace function public.assert_quota_allowed(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_sub public.subscriptions;
  v_plan_id text;
  v_caps record;
  v_period_used int;
  v_lifetime_used int;
  v_remaining int;
  v_allowed boolean;
  v_reason text;
  v_mode text;
  v_ack_required boolean;
  v_overage_unit_price_cents int := 7500;
  v_next_tier text;
  v_next_tier_price_cents int;
  v_next_tier_monthly_cap int;
begin
  -- Auth guard: authenticated callers may only inspect themselves or a
  -- teammate; service role (auth.uid() is null) bypasses.
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

  v_sub := public.resolve_user_subscription(p_user_id);
  v_plan_id := coalesce(v_sub.plan_id, 'starter');

  select monthly_cap, lifetime_cap
    into v_caps
    from public._plan_caps(v_plan_id);

  v_period_used   := coalesce(v_sub.claims_used_this_period, 0);
  v_lifetime_used := coalesce(v_sub.lifetime_claims_used, 0);

  if v_plan_id = 'starter' then
    -- Starter: hard block at lifetime cap. No overage path.
    v_remaining := greatest(0, coalesce(v_caps.lifetime_cap, 3) - v_lifetime_used);
    v_allowed   := v_remaining > 0;
    v_mode      := case when v_allowed then 'normal' else 'blocked' end;
    v_reason    := case when v_allowed then null else 'lifetime_cap_reached' end;
    v_next_tier := 'pro';
    v_next_tier_price_cents := 49900;
    v_next_tier_monthly_cap := 8;

  elsif v_plan_id = 'sales_rep' then
    -- Pay-per-claim: always allowed when subscription is active.
    v_remaining := 999999;
    v_allowed   := coalesce(v_sub.status, 'inactive') = 'active';
    v_mode      := case when v_allowed then 'normal' else 'blocked' end;
    v_reason    := case when v_allowed then null else 'subscription_inactive' end;

  else
    -- Pro / Growth / Enterprise: under cap = normal, at-cap = overage, inactive = blocked.
    v_remaining := greatest(0, coalesce(v_caps.monthly_cap, 0) - v_period_used);

    if coalesce(v_sub.status, 'inactive') <> 'active' then
      v_allowed := false;
      v_mode    := 'blocked';
      v_reason  := 'subscription_inactive';
    elsif v_remaining > 0 then
      v_allowed := true;
      v_mode    := 'normal';
      v_reason  := null;
    else
      -- AT or OVER cap: overage mode. Always allowed; processor meters the charge.
      v_allowed := true;
      v_mode    := 'overage';
      v_reason  := 'monthly_cap_reached';
    end if;

    -- Upsell hint: which tier should we point them at to avoid future overage?
    if v_plan_id = 'pro' then
      v_next_tier := 'growth';
      v_next_tier_price_cents := 99900;
      v_next_tier_monthly_cap := 20;
    elsif v_plan_id = 'growth' then
      v_next_tier := 'enterprise';
      v_next_tier_price_cents := 299900;
      v_next_tier_monthly_cap := 100;
    else
      -- enterprise: no auto-upsell, only the $75/claim CTA + sales link
      v_next_tier := null;
      v_next_tier_price_cents := null;
      v_next_tier_monthly_cap := null;
    end if;
  end if;

  -- Acknowledgement is required ONLY in overage mode AND only the first time
  -- the user enters overage in the current billing period. ack_at must be
  -- AFTER current_period_start to count for THIS cycle (any older ack is stale).
  if v_mode = 'overage' then
    v_ack_required :=
      v_sub.overage_acknowledged_at is null
      or (v_sub.current_period_start is not null
          and v_sub.overage_acknowledged_at < v_sub.current_period_start);
  else
    v_ack_required := false;
  end if;

  return jsonb_build_object(
    'allowed',                  v_allowed,
    'mode',                     v_mode,
    'plan_id',                  v_plan_id,
    'status',                   coalesce(v_sub.status, 'active'),
    'period_used',              v_period_used,
    'lifetime_used',            v_lifetime_used,
    'remaining',                v_remaining,
    'limit',                    case
                                  when v_plan_id = 'starter' then v_caps.lifetime_cap
                                  when v_plan_id = 'sales_rep' then null
                                  else v_caps.monthly_cap
                                end,
    'reason',                   v_reason,
    'subscription_user_id',     v_sub.user_id,
    'company_shared',           v_sub.user_id is not null and v_sub.user_id <> p_user_id,
    -- Overage fields
    'overage_unit_price_cents', v_overage_unit_price_cents,
    'overage_this_period',      coalesce(v_sub.overage_this_period, 0),
    'ack_required',             v_ack_required,
    -- Upsell hints (modal CTA copy)
    'next_tier',                v_next_tier,
    'next_tier_price_cents',    v_next_tier_price_cents,
    'next_tier_monthly_cap',    v_next_tier_monthly_cap,
    'current_period_end',       v_sub.current_period_end
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- increment_claim_usage — also increment overage_this_period and report whether
-- THIS tick was the one that crossed into overage (so processor.py knows to
-- fire a Stripe usage record).
-- ---------------------------------------------------------------------------
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
  v_overage int;
  v_caps record;
  v_was_overage boolean := false;
  v_plan_id text;
begin
  -- Auth guard: authenticated callers may only increment their OWN counter.
  -- Service role bypasses.
  if auth.uid() is not null and auth.uid() <> p_user_id then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  v_sub := public.resolve_user_subscription(p_user_id);

  if v_sub.id is not null then
    v_plan_id := coalesce(v_sub.plan_id, 'starter');

    select monthly_cap, lifetime_cap
      into v_caps
      from public._plan_caps(v_plan_id);

    -- Decide whether THIS increment lands in overage. Only paid tiers with a
    -- monthly cap can have overage (starter hard-blocks elsewhere; sales_rep
    -- has no cap).
    if v_plan_id in ('pro', 'growth', 'enterprise')
       and coalesce(v_caps.monthly_cap, 0) > 0
       and coalesce(v_sub.claims_used_this_period, 0) >= v_caps.monthly_cap then
      v_was_overage := true;
    end if;

    update public.subscriptions
       set claims_used_this_period = claims_used_this_period + 1,
           lifetime_claims_used    = lifetime_claims_used + 1,
           overage_this_period     = overage_this_period + case when v_was_overage then 1 else 0 end,
           updated_at              = now()
     where id = v_sub.id
     returning claims_used_this_period, lifetime_claims_used, overage_this_period
     into v_period_used, v_lifetime_used, v_overage;

    return jsonb_build_object(
      'ok',                   true,
      'subscription_id',      v_sub.id,
      'subscription_user_id', v_sub.user_id,
      'plan_id',              v_plan_id,
      'period_used',          v_period_used,
      'lifetime_used',        v_lifetime_used,
      'overage_this_period',  v_overage,
      'overage_billed',       v_was_overage,
      'stripe_subscription_id', v_sub.stripe_subscription_id,
      'stripe_overage_item_id', v_sub.stripe_overage_item_id
    );
  end if;

  -- No subscription row anywhere — create a starter row owned by the requester.
  -- Pull company_id from their profile so future teammates share it.
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
    'ok',                   true,
    'subscription_user_id', p_user_id,
    'plan_id',              'starter',
    'period_used',          v_period_used,
    'lifetime_used',        v_lifetime_used,
    'overage_this_period',  0,
    'overage_billed',       false
  );
end;
$$;

-- Re-grant
grant execute on function public.assert_quota_allowed(uuid)  to authenticated, service_role;
grant execute on function public.increment_claim_usage(uuid) to authenticated, service_role;
