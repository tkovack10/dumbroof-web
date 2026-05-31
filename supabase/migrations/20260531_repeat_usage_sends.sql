-- Repeat-usage / reactivation drip — per-send tracking + dedup.
--
-- One row per (user, touch, anchor) actually sent. The cron mirrors the
-- reactivation-emails pattern: it pre-checks this table to avoid re-sending,
-- and the unique index is the concurrency backstop (parallel runs → 23505,
-- swallowed as "skip").
--
-- anchor_claim_at = the user's MOST-RECENT claim timestamp at send time. Making
-- it part of the dedup key is what re-arms the whole 7-touch sequence: when the
-- user starts a new claim their most-recent-claim timestamp changes, so the
-- (user, touch, anchor) keys are all fresh again.
--
-- Service-role only (the cron uses supabaseAdmin, which bypasses RLS). RLS is
-- enabled with no policies so client/anon access is denied by default.

create table if not exists public.repeat_usage_sends (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null,
  touch           text not null,
  anchor_claim_at timestamptz not null,
  channel         text not null default 'email',
  email_id        text,
  sent_at         timestamptz not null default now()
);

create unique index if not exists repeat_usage_sends_user_touch_anchor
  on public.repeat_usage_sends (user_id, touch, anchor_claim_at);

-- Fast lookup of recent sends for the candidate set on each run.
create index if not exists repeat_usage_sends_user_sent_at
  on public.repeat_usage_sends (user_id, sent_at);

alter table public.repeat_usage_sends enable row level security;

comment on table public.repeat_usage_sends is
  'Repeat-usage drip send log. Dedup key (user_id, touch, anchor_claim_at); anchor = most-recent-claim timestamp so the sequence re-arms when a new claim is created. Service-role only.';
