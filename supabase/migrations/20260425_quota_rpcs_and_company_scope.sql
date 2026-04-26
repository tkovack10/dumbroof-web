-- DumbRoof billing forensic fix (2026-04-25)
--
-- Adds the missing increment_claim_usage RPC + new assert_quota_allowed RPC,
-- introduces company_id on subscriptions so teams share one paid plan, and
-- backfills company_id for existing rows.
--
-- Prior state (verified 2026-04-25):
-- - subscriptions table exists with unique(user_id) — see 20260311_stripe_billing.sql
-- - increment_claim_usage RPC was referenced from app code but never created;
--   the route fell back to a non-atomic select+insert, producing orphan rows
--   and skipping increment for ~91% of claim creators.
-- - No company-scoped subscription lookup existed → team members couldn't
--   share the owner's plan.

-- ---------------------------------------------------------------------------
-- 0. Drop pre-existing functions whose return type or language we are
--    changing. CREATE OR REPLACE FUNCTION can change body but NOT return
--    type or language, so we drop first to allow clean re-creation. Safe
--    to re-run — IF EXISTS prevents errors when functions are absent.
-- ---------------------------------------------------------------------------
drop function if exists public.increment_claim_usage(uuid);
drop function if exists public.assert_quota_allowed(uuid);
drop function if exists public.resolve_user_subscription(uuid);
drop function if exists public._plan_caps(text);

-- ---------------------------------------------------------------------------
-- 1. Schema: add company_id to subscriptions
-- ---------------------------------------------------------------------------
alter table public.subscriptions
  add column if not exists company_id uuid;

create index if not exists idx_subscriptions_company on public.subscriptions(company_id);

-- Backfill company_id for existing subscriptions from company_profiles
update public.subscriptions s
   set company_id = cp.company_id
  from public.company_profiles cp
 where cp.user_id = s.user_id
   and s.company_id is null;

-- ---------------------------------------------------------------------------
-- 2. Helper: plan caps (single source of truth, mirrors stripe-config.ts)
-- ---------------------------------------------------------------------------
create or replace function public._plan_caps(p_plan_id text)
returns table(monthly_cap int, lifetime_cap int)
language sql
immutable
as $$
  select
    case p_plan_id
      when 'pro'        then 8
      when 'growth'     then 20
      when 'enterprise' then 100
      when 'sales_rep'  then 999999
      else 0
    end as monthly_cap,
    case p_plan_id
      when 'starter' then 3
      else null
    end as lifetime_cap;
$$;

-- ---------------------------------------------------------------------------
-- 3. RPC: resolve the effective subscription for a user
--    (their own row, OR the highest-tier active plan in their company)
-- ---------------------------------------------------------------------------
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
  -- Auth guard: authenticated callers may only query themselves OR another
  -- user in the same company. Service role bypass (auth.uid() is null).
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
    case when user_id = p_user_id then 0 else 1 end,
    created_at asc
  limit 1;

  return v_sub;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. RPC: assert_quota_allowed — fast check, returns structured result
--    Used by Next.js preflight + Python processor.py
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
  v_allowed boolean;
  v_remaining int;
  v_reason text;
begin
  -- Auth guard mirrors resolve_user_subscription. Authenticated callers may
  -- only inspect their own quota or a teammate's; service role is unrestricted.
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

  if v_plan_id = 'starter' then
    v_remaining := greatest(0, coalesce(v_caps.lifetime_cap, 3) - coalesce(v_sub.lifetime_claims_used, 0));
    v_allowed   := v_remaining > 0;
    v_reason    := case when v_allowed then null else 'lifetime_cap_reached' end;
  elsif v_plan_id = 'sales_rep' then
    -- Pay-per-claim: always allowed when subscription is active
    v_remaining := 999999;
    v_allowed   := coalesce(v_sub.status, 'inactive') = 'active';
    v_reason    := case when v_allowed then null else 'subscription_inactive' end;
  else
    v_remaining := greatest(0, coalesce(v_caps.monthly_cap, 0) - coalesce(v_sub.claims_used_this_period, 0));
    v_allowed   := coalesce(v_sub.status, 'inactive') = 'active' and v_remaining > 0;
    v_reason    := case
                     when v_sub.status is distinct from 'active' then 'subscription_inactive'
                     when v_remaining = 0 then 'monthly_cap_reached'
                     else null
                   end;
  end if;

  return jsonb_build_object(
    'allowed',        v_allowed,
    'plan_id',        v_plan_id,
    'status',         coalesce(v_sub.status, 'active'),
    'period_used',    coalesce(v_sub.claims_used_this_period, 0),
    'lifetime_used',  coalesce(v_sub.lifetime_claims_used, 0),
    'remaining',      v_remaining,
    'limit',          case
                        when v_plan_id = 'starter' then v_caps.lifetime_cap
                        when v_plan_id = 'sales_rep' then null
                        else v_caps.monthly_cap
                      end,
    'reason',         v_reason,
    'subscription_user_id', v_sub.user_id,
    'company_shared', v_sub.user_id is not null and v_sub.user_id <> p_user_id
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. RPC: increment_claim_usage — atomic, idempotent UPSERT
--    Increments the SHARED subscription's counter when team-pooled.
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
begin
  -- Auth guard: authenticated callers may only increment their OWN counter.
  -- Increment-on-behalf-of-teammate is prevented (closes a counter-inflation
  -- attack vector). The team-pooled counter still ticks because the SHARED
  -- subscription row is found via resolve_user_subscription.
  -- Service role (auth.uid() is null) bypasses — that's how processor.py
  -- and webhooks operate.
  if auth.uid() is not null and auth.uid() <> p_user_id then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  v_sub := public.resolve_user_subscription(p_user_id);

  if v_sub.id is not null then
    -- Increment the resolved subscription (could be team owner's row)
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
      'lifetime_used', v_lifetime_used
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
    'ok', true,
    'subscription_user_id', p_user_id,
    'plan_id', 'starter',
    'period_used', v_period_used,
    'lifetime_used', v_lifetime_used
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Telemetry: log every preflight rejection so sales can chase warm leads
-- ---------------------------------------------------------------------------
create table if not exists public.quota_block_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  plan_id text,
  reason text,
  source text,                      -- 'preflight' | 'processor' | 'increment'
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_quota_block_events_user on public.quota_block_events(user_id);
create index if not exists idx_quota_block_events_created on public.quota_block_events(created_at desc);

alter table public.quota_block_events enable row level security;

create policy "Service role full access on quota_block_events"
  on public.quota_block_events
  for all
  to service_role
  using (true)
  with check (true);

-- ---------------------------------------------------------------------------
-- 7. Upgrade-email tracking (one row per (user_id, stage, period_key))
--    period_key lets us send the same stage twice across different billing
--    cycles without spamming inside one cycle.
-- ---------------------------------------------------------------------------
create table if not exists public.upgrade_email_sends (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  stage text not null,             -- 'near_cap' | 'at_cap' | 'monthly_cap' | 'renewal_in_3d'
  period_key text not null,        -- e.g. 'lifetime' for starter stages, ISO date for monthly
  email_id text,                   -- Resend message id
  sent_at timestamptz not null default now(),
  unique(user_id, stage, period_key)
);

create index if not exists idx_upgrade_email_sends_user on public.upgrade_email_sends(user_id);
create index if not exists idx_upgrade_email_sends_stage on public.upgrade_email_sends(stage);

alter table public.upgrade_email_sends enable row level security;

create policy "Service role full access on upgrade_email_sends"
  on public.upgrade_email_sends
  for all
  to service_role
  using (true)
  with check (true);

-- ---------------------------------------------------------------------------
-- 8. Grants
-- ---------------------------------------------------------------------------
grant execute on function public.assert_quota_allowed(uuid)        to authenticated, service_role;
grant execute on function public.increment_claim_usage(uuid)       to authenticated, service_role;
grant execute on function public.resolve_user_subscription(uuid)   to authenticated, service_role;
grant execute on function public._plan_caps(text)                  to authenticated, service_role;
