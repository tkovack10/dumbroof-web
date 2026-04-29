-- Claim overage billing (2026-04-29)
--
-- Turns the cap from a churn risk into a revenue lever. Pro/Growth/Enterprise
-- users no longer hard-block at their monthly cap — they continue submitting
-- at $75/claim, billed via Stripe metered usage records on the existing
-- subscription's renewal invoice.
--
-- Starter stays hard-blocked (free→paid conversion lever).
--
-- Schema additions are additive and backward-safe: existing users keep the
-- old behavior until processor.py + preflight read the new fields.

-- ---------------------------------------------------------------------------
-- 1. Subscription overage tracking
-- ---------------------------------------------------------------------------
alter table public.subscriptions
  add column if not exists overage_this_period int not null default 0,
  add column if not exists overage_acknowledged_at timestamptz,
  add column if not exists stripe_overage_item_id text;

-- ---------------------------------------------------------------------------
-- 2. Per-claim overage telemetry (separate from quota_block_events because
--    overage is NOT a block — it's a successful billable event)
-- ---------------------------------------------------------------------------
create table if not exists public.overage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  subscription_user_id uuid not null,
  claim_id uuid references public.claims(id) on delete set null,
  plan_id text not null,
  overage_count_after int not null,
  unit_price_cents int not null,
  stripe_usage_record_id text,
  meter_event_status text not null default 'pending',  -- 'pending' | 'sent' | 'failed'
  meter_error text,
  created_at timestamptz not null default now()
);

create index if not exists idx_overage_events_user
  on public.overage_events(user_id, created_at desc);

create index if not exists idx_overage_events_pending_status
  on public.overage_events(meter_event_status)
  where meter_event_status <> 'sent';

create index if not exists idx_overage_events_claim
  on public.overage_events(claim_id)
  where claim_id is not null;

alter table public.overage_events enable row level security;

create policy "Service role full access on overage_events"
  on public.overage_events
  for all
  to service_role
  using (true)
  with check (true);

-- Authenticated users can READ their own overage events (for dashboard display).
-- Service role still owns all writes.
create policy "Users read own overage events"
  on public.overage_events
  for select
  to authenticated
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 3. Extend upgrade_email_sends with internal-recipient flag
--    (digest emails go to tom@dumbroof.ai, not the subscription owner)
-- ---------------------------------------------------------------------------
alter table public.upgrade_email_sends
  add column if not exists recipient_class text not null default 'user';
  -- 'user' = sent to the subscription owner (default)
  -- 'internal' = sent to an internal address (e.g. tom@dumbroof.ai daily digest)

-- The (user_id, stage, period_key) unique still works; for internal digests we
-- write a synthetic user_id (the internal recipient's auth.users row), so dedupe
-- by (synthetic-user, stage, period_key) keeps daily digests from doubling up.
