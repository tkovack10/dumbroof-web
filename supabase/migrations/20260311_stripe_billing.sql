-- Stripe billing: subscriptions table
create table if not exists subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  stripe_customer_id text not null,
  stripe_subscription_id text,
  plan_id text not null default 'starter',
  status text not null default 'active', -- active, canceled, past_due
  current_period_start timestamptz,
  current_period_end timestamptz,
  claims_used_this_period int not null default 0,
  lifetime_claims_used int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id),
  unique(stripe_customer_id)
);

-- RLS
alter table subscriptions enable row level security;

create policy "Users can read own subscription"
  on subscriptions for select
  using (auth.uid() = user_id);

-- Index for webhook lookups
create index idx_subscriptions_stripe_customer on subscriptions(stripe_customer_id);
create index idx_subscriptions_stripe_sub on subscriptions(stripe_subscription_id);
