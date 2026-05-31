-- Storm-trigger (Track B of the repeat-usage system) — data + send tracking.
--
-- storm_events: NOAA SPC hail/wind reports at/above our severity gates, ingested
--   daily by /api/cron/storm-ingest. Pure data (no user contact) — the ingest
--   cron is NOT gated, so storm history accumulates immediately and is
--   reviewable before alerts go live.
--
-- storm_alert_sends: one row per alert email actually sent. Powers the per-user
--   5-day throttle (a wide state+adjacent radius is safe because frequency is
--   capped here) and per-event dedup.

create table if not exists public.storm_events (
  id            uuid primary key default gen_random_uuid(),
  event_key     text not null unique,           -- type|date|state|county|time|magRaw
  event_type    text not null,                  -- 'hail' | 'wind'
  event_date    date not null,                  -- convective day the report covers
  state         text not null,                  -- 2-letter USPS
  county        text not null,
  location      text,
  magnitude     numeric not null,               -- hail: inches; wind: mph
  magnitude_raw text,
  lat           numeric,
  lon           numeric,
  source        text not null default 'spc',
  ingested_at   timestamptz not null default now()
);

create index if not exists storm_events_state_date on public.storm_events (state, event_date);
create index if not exists storm_events_date on public.storm_events (event_date);

create table if not exists public.storm_alert_sends (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null,
  storm_event_id uuid not null references public.storm_events(id) on delete cascade,
  channel        text not null default 'email',
  email_id       text,
  sent_at        timestamptz not null default now()
);

-- Per-event dedup backstop (one alert per user per event).
create unique index if not exists storm_alert_sends_user_event
  on public.storm_alert_sends (user_id, storm_event_id);
-- Throttle lookup: most-recent alert per user.
create index if not exists storm_alert_sends_user_sent_at
  on public.storm_alert_sends (user_id, sent_at);

alter table public.storm_events enable row level security;
alter table public.storm_alert_sends enable row level security;

comment on table public.storm_events is
  'NOAA SPC hail/wind reports >= severity gates (hail >=1.00", wind >=58mph). Ingested daily; pure data. Service-role only.';
comment on table public.storm_alert_sends is
  'Storm-alert send log. 5-day per-user throttle + per-event dedup (user_id, storm_event_id). Service-role only.';
