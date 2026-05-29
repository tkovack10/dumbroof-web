-- #4 funnel visibility — persist client funnel events to the DB so drop-off is
-- answerable in SQL. Today track.ts fires only to GA4 + Vercel Analytics, so
-- "where do new users stall?" can't be queried internally. One row per event,
-- written by /api/track via the service role. Table is service-role-only
-- (RLS on, no anon/auth policies → all writes go through the route, no client
-- reads). Anonymous visitors are stitched by session_id (localStorage), which
-- survives the signup boundary so homepage → signup → first-claim is one journey.
create table if not exists public.funnel_events (
  id          uuid primary key default gen_random_uuid(),
  event       text not null,
  properties  jsonb,
  user_id     uuid,          -- best-effort: set when the visitor is authenticated
  session_id  text,          -- anonymous visitor stitch (localStorage)
  path        text,          -- page the event fired on
  referer     text,
  user_agent  text,
  created_at  timestamptz not null default now()
);

create index if not exists idx_funnel_events_event_time on public.funnel_events (event, created_at desc);
create index if not exists idx_funnel_events_session    on public.funnel_events (session_id);
create index if not exists idx_funnel_events_user       on public.funnel_events (user_id);

alter table public.funnel_events enable row level security;
-- No policies: service_role (the /api/track route) bypasses RLS; clients cannot
-- read or write directly.
