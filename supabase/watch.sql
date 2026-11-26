-- =====================================================================
-- Peasily Watch · its own database (the Watch Supabase project, NOT production)
-- Run once in the Watch project's SQL Editor (Manish), then re-run safely
-- after any update: everything here can run again without harm.
--
-- How it works: every minute the Watch database itself (pg_cron) reads
-- Peasily's health, so alerts keep going even if the Watch website is down.
--   1. watch.collect()  asks production for watch.snapshot() through dblink
--      (login peasily_watch: it can do nothing else), asks the website's
--      /api/health, and asks GitHub how the last backup and test runs went.
--   2. watch.evaluate() turns the numbers into checks: ok, early warning or
--      critical, and opens or closes alerts (one row per problem).
--   3. watch.notify()   sends Telegram (repeated every 2 minutes for a
--      critical alert until someone presses "Seen" on the wall screen) and
--      email, through pg_net.
-- Production keys live ONLY in the Vault of this project, entered by Sandeep
-- (see the guide). Nothing here holds a password.
-- =====================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;
create extension if not exists dblink with schema extensions;
create extension if not exists supabase_vault;

create schema if not exists watch;
revoke all on schema watch from public, anon, authenticated;

-- one row a minute: everything production told us
create table if not exists watch.snapshots (
  id     bigint generated always as identity primary key,
  at     timestamptz not null default now(),
  ok     boolean not null,            -- could we read production at all?
  data   jsonb,
  error  text
);
create index if not exists snapshots_at on watch.snapshots (at desc);

-- the outside checks (website, GitHub) sent through pg_net, and their answers
create table if not exists watch.probes (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  kind        text not null check (kind in ('health', 'backup', 'tests')),
  request_id  bigint,
  status      int,
  ms          int,
  body        jsonb,
  done        boolean not null default false
);
create index if not exists probes_kind_at on watch.probes (kind, at desc);

-- the state of every check now (one row per check)
create table if not exists watch.checks (
  key         text primary key,         -- also the runbook's file name
  title       text not null,
  level       text not null default 'ok' check (level in ('ok', 'early warning', 'critical', 'unknown')),
  detail      text,
  since       timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- an alert: opened when a check leaves ok, closed when it is ok again
create table if not exists watch.alerts (
  id            bigint generated always as identity primary key,
  check_key     text not null references watch.checks (key),
  level         text not null,
  detail        text,
  opened_at     timestamptz not null default now(),
  seen_at       timestamptz,
  seen_by       text,
  closed_at     timestamptz,
  last_sent_at  timestamptz,
  sends         int not null default 0
);
create index if not exists alerts_open on watch.alerts (check_key) where closed_at is null;

-- small settings (no secrets): where to look and whom to tell
create table if not exists watch.settings (
  key    text primary key,
  value  text not null
);
insert into watch.settings (key, value) values
  ('health_url', 'https://app.hawksdynamics.com/api/health'),
  ('github_repo', 'HawksSandeep/hawks-dynamics-Prod'),
  ('email_to', 'support@peasily.com'),
  ('email_from', 'Peasily Watch <watch@peasily.com>'),
  ('repeat_minutes', '2'),
  ('wall_url', 'https://watch.peasily.com')
on conflict (key) do nothing;

do $$
declare t text;
begin
  foreach t in array array['snapshots', 'probes', 'checks', 'alerts', 'settings'] loop
    execute format('alter table watch.%I enable row level security', t);
    execute format('revoke all on watch.%I from public, anon, authenticated', t);
  end loop;
end $$;

-- a secret from this project's Vault (null when Sandeep has not set it yet)
create or replace function watch.secret(p_name text) returns text
language sql stable security definer set search_path = '' as $$
  select decrypted_secret from vault.decrypted_secrets where name = p_name limit 1
$$;
create or replace function watch.setting(p_key text) returns text
language sql stable set search_path = '' as $$ select value from watch.settings where key = p_key $$;

-- ---------------------------------------------------------------------
-- 1. collect
-- ---------------------------------------------------------------------
create or replace function watch.collect() returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_url  text := watch.secret('prod_watch_url');
  v_gh   text := watch.secret('github_token');
  v_json text;
  h      jsonb;
begin
  -- production's own health, read only (5 second limit on that login)
  if v_url is null then
    insert into watch.snapshots (ok, error) values (false, 'prod_watch_url is not set in the Vault yet');
  else
    begin
      select j into v_json from extensions.dblink(v_url, 'select watch.snapshot()::text') as t(j text);
      insert into watch.snapshots (ok, data) values (true, v_json::jsonb);
    exception when others then
      insert into watch.snapshots (ok, error) values (false, left(sqlerrm, 300));
    end;
  end if;

  -- the answers to last minute's outside checks
  update watch.probes p
     set status = r.status_code, done = true,
         ms = greatest(0, extract(epoch from (r.created - p.at)) * 1000)::int,
         body = case when r.content is not null and left(ltrim(r.content), 1) in ('{', '[') then r.content::jsonb end
    from net._http_response r
   where r.id = p.request_id and not p.done;
  update watch.probes set done = true, status = coalesce(status, 0) where not done and at < now() - interval '2 minutes';

  -- the website, every minute
  insert into watch.probes (kind, request_id)
  values ('health', net.http_get(url := watch.setting('health_url'), timeout_milliseconds := 10000));

  -- GitHub, every 10 minutes: the last nightly backup and the last test run
  if v_gh is not null and extract(minute from now())::int % 10 = 0 then
    h := jsonb_build_object('Authorization', 'Bearer ' || v_gh, 'Accept', 'application/vnd.github+json', 'User-Agent', 'peasily-watch');
    insert into watch.probes (kind, request_id) values
      ('backup', net.http_get(url := 'https://api.github.com/repos/' || watch.setting('github_repo') || '/actions/workflows/nightly-backup.yml/runs?per_page=1&branch=main', headers := h, timeout_milliseconds := 10000)),
      ('tests',  net.http_get(url := 'https://api.github.com/repos/' || watch.setting('github_repo') || '/actions/workflows/tests.yml/runs?per_page=1&branch=main', headers := h, timeout_milliseconds := 10000));
  end if;

  -- keep 14 days of Watch's own history
  delete from watch.snapshots where at < now() - interval '14 days';
  delete from watch.probes where at < now() - interval '14 days';
end $$;

-- ---------------------------------------------------------------------
-- 2. evaluate
-- ---------------------------------------------------------------------
create or replace function watch.set_check(p_key text, p_title text, p_level text, p_detail text) returns void
language plpgsql security definer set search_path = '' as $$
declare old text;
begin
  select level into old from watch.checks where key = p_key;
  insert into watch.checks (key, title, level, detail) values (p_key, p_title, p_level, p_detail)
  on conflict (key) do update set title = excluded.title, level = excluded.level, detail = excluded.detail, updated_at = now(),
     since = case when watch.checks.level = excluded.level then watch.checks.since else now() end;
  if p_level in ('early warning', 'critical') then
    if exists (select 1 from watch.alerts where check_key = p_key and closed_at is null) then
      -- a warning that becomes critical is sent again at once
      update watch.alerts set detail = p_detail,
             level = p_level, last_sent_at = case when level <> p_level and p_level = 'critical' then null else last_sent_at end
       where check_key = p_key and closed_at is null;
    else
      insert into watch.alerts (check_key, level, detail) values (p_key, p_level, p_detail);
    end if;
  elsif p_level = 'ok' then
    update watch.alerts set closed_at = now(), last_sent_at = null where check_key = p_key and closed_at is null;
  end if;
end $$;

create or replace function watch.evaluate() returns void
language plpgsql security definer set search_path = '' as $$
declare
  s     jsonb;
  prev  jsonb;
  c     jsonb;
  q     jsonb;
  j     jsonb;
  n     int;
  v_bad int;
  v_t   text;
  v_lvl text;
  b     jsonb;
begin
  -- could we read production? (3 minutes in a row: critical)
  select count(*) into v_bad from (select ok from watch.snapshots order by at desc limit 3) x where not ok;
  perform watch.set_check('watch-cannot-read', 'Watch can read the Peasily database',
    case when v_bad >= 3 then 'critical' when v_bad >= 1 then 'early warning' else 'ok' end,
    case when v_bad = 0 then 'reading every minute' else (select error from watch.snapshots where not ok order by at desc limit 1) end);

  select data into s from watch.snapshots where ok order by at desc limit 1;
  select data into prev from watch.snapshots where ok and at < now() - interval '50 seconds' order by at desc limit 1;
  if s is not null then
    c := s -> 'connections';
    v_lvl := case when (c ->> 'total')::numeric >= 0.9 * (c ->> 'max')::numeric then 'critical'
                  when (c ->> 'total')::numeric >= 0.8 * (c ->> 'max')::numeric then 'early warning' else 'ok' end;
    perform watch.set_check('db-connections', 'Database connections', v_lvl, (c ->> 'total') || ' of ' || (c ->> 'max') || ' in use');

    select coalesce(max((x ->> 'waiting_s')::int), 0) into n from jsonb_array_elements(coalesce(s -> 'blocked', '[]')) x;
    perform watch.set_check('db-blocking', 'Blocked work in the database',
      case when n >= 120 then 'critical' when n >= 30 then 'early warning' else 'ok' end,
      case when n > 0 then jsonb_array_length(s -> 'blocked') || ' waiting, longest ' || n || ' seconds' else 'none' end);

    perform watch.set_check('db-long-query', 'Long-running work',
      case when (c ->> 'longest_s')::numeric >= 120 then 'critical' when (c ->> 'running_over_30_s')::int > 0 then 'early warning' else 'ok' end,
      'longest ' || (c ->> 'longest_s') || ' seconds');

    perform watch.set_check('db-open-change', 'Sessions left open inside a change',
      case when (c ->> 'open_change_over_5_min')::int > 0 then 'early warning' else 'ok' end,
      (c ->> 'open_change_over_5_min') || ' open over 5 minutes');

    if prev is not null then
      n := coalesce((s -> 'database' ->> 'deadlocks_total')::int, 0) - coalesce((prev -> 'database' ->> 'deadlocks_total')::int, 0);
      perform watch.set_check('db-deadlock', 'Deadlocks', case when n > 0 then 'early warning' else 'ok' end, n || ' in the last minute');
    end if;

    q := s -> 'queues';
    perform watch.set_check('email-slow', 'Emails waiting',
      case when (q -> 'email' ->> 'oldest_s')::int >= 1800 or (q -> 'email' ->> 'stuck_sending')::int > 0 then 'critical'
           when (q -> 'email' ->> 'oldest_s')::int >= 300 or (q -> 'email' ->> 'waiting')::int > 25 then 'early warning' else 'ok' end,
      (q -> 'email' ->> 'waiting') || ' waiting, oldest ' || (q -> 'email' ->> 'oldest_s') || ' seconds');
    perform watch.set_check('email-failed', 'Emails that failed',
      case when (q -> 'email' ->> 'failed_last_hour')::int > 0 then 'early warning' else 'ok' end,
      (q -> 'email' ->> 'failed_last_hour') || ' in the last hour');
    perform watch.set_check('telegram-stuck', 'Telegram messages waiting',
      case when (q -> 'telegram' ->> 'oldest_s')::int >= 600 then 'critical' when (q -> 'telegram' ->> 'oldest_s')::int >= 180 then 'early warning' else 'ok' end,
      (q -> 'telegram' ->> 'waiting') || ' waiting, oldest ' || (q -> 'telegram' ->> 'oldest_s') || ' seconds');
    perform watch.set_check('phone-alerts-stuck', 'Phone app alerts waiting',
      case when (q -> 'phone' ->> 'oldest_s')::int >= 600 then 'critical' when (q -> 'phone' ->> 'oldest_s')::int >= 180 then 'early warning' else 'ok' end,
      (q -> 'phone' ->> 'waiting') || ' waiting, oldest ' || (q -> 'phone' ->> 'oldest_s') || ' seconds');

    -- background jobs (only where production reports them)
    if s ? 'jobs' then
      select string_agg(x ->> 'job', ', ') into v_t from jsonb_array_elements(s -> 'jobs') x
       where (x ->> 'active')::boolean and x ->> 'last_status' = 'failed';
      perform watch.set_check('job-failed', 'Background jobs', case when v_t is null then 'ok' else 'critical' end, coalesce('failed: ' || v_t, 'all ran'));
      select string_agg(x ->> 'job', ', ') into v_t from jsonb_array_elements(s -> 'jobs') x
       where (x ->> 'active')::boolean and (x ->> 'last_start' is null or (x ->> 'last_start')::timestamptz < now() - interval '26 hours');
      perform watch.set_check('job-missed', 'Background jobs on time', case when v_t is null then 'ok' else 'early warning' end, coalesce('no run in 26 hours: ' || v_t, 'all on time'));
    end if;
  end if;

  -- the website: 2 of the last 3 checks failed is down; slow over 2 seconds
  select count(*) filter (where status is distinct from 200), coalesce(avg(ms), 0)::int into v_bad, n
    from (select status, ms from watch.probes where kind = 'health' and done order by at desc limit 3) x;
  perform watch.set_check('website-down', 'app.hawksdynamics.com answers',
    case when not exists (select 1 from watch.probes where kind = 'health' and done) then 'unknown'
         when v_bad >= 2 then 'critical' when v_bad = 1 then 'early warning' else 'ok' end,
    case when v_bad = 0 then 'answering' else v_bad || ' of the last 3 checks failed' end);
  perform watch.set_check('website-slow', 'Website speed', case when n > 2000 then 'early warning' else 'ok' end, n || ' ms on average');

  -- the nightly backup: the last run must be a success and less than 26 hours old
  select body -> 'workflow_runs' -> 0 into b from watch.probes where kind = 'backup' and done and status = 200 order by at desc limit 1;
  if b is not null then
    perform watch.set_check('db-backup', 'Nightly backup',
      case when b ->> 'conclusion' = 'success' and (b ->> 'created_at')::timestamptz > now() - interval '26 hours' then 'ok'
           when b ->> 'status' in ('queued', 'in_progress') then 'ok' else 'critical' end,
      'last run ' || coalesce(b ->> 'conclusion', b ->> 'status') || ' at ' || to_char((b ->> 'created_at')::timestamptz at time zone 'Asia/Kolkata', 'DD Mon HH24:MI'));
  elsif watch.secret('github_token') is null then
    perform watch.set_check('db-backup', 'Nightly backup', 'unknown', 'github_token is not set in the Vault yet');
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 3. notify
-- ---------------------------------------------------------------------
create or replace function watch.notify() returns void
language plpgsql security definer set search_path = '' as $$
declare
  a        record;
  v_bot    text := watch.secret('telegram_bot_token');
  v_chat   text := watch.secret('telegram_chat_id');
  v_mail   text := watch.secret('resend_api_key');
  v_every  int  := coalesce(watch.setting('repeat_minutes')::int, 2);
  v_text   text;
begin
  for a in
    select al.*, ck.title from watch.alerts al join watch.checks ck on ck.key = al.check_key
     where al.closed_at is null and (
           al.last_sent_at is null
        or (al.level = 'critical' and al.seen_at is null and al.last_sent_at < now() - make_interval(mins => v_every)))
  loop
    v_text := case when a.level = 'critical' then '🔴 CRITICAL' else '🟡 Early warning' end || ' · ' || a.title || E'\n' || coalesce(a.detail, '')
              || E'\nRunbook: ' || watch.setting('wall_url') || '/runbook/' || a.check_key
              || case when a.sends > 0 then E'\n(repeat ' || (a.sends + 1) || ' · press Seen on the wall screen to stop)' else '' end;
    if v_bot is not null and v_chat is not null then
      perform net.http_post(url := 'https://api.telegram.org/bot' || v_bot || '/sendMessage',
        body := jsonb_build_object('chat_id', v_chat, 'text', v_text, 'disable_web_page_preview', true));
    end if;
    -- email once per alert (not on every repeat)
    if v_mail is not null and a.sends = 0 then
      perform net.http_post(url := 'https://api.resend.com/emails',
        headers := jsonb_build_object('Authorization', 'Bearer ' || v_mail, 'Content-Type', 'application/json'),
        body := jsonb_build_object('from', watch.setting('email_from'), 'to', jsonb_build_array(watch.setting('email_to')),
                                   'subject', 'Peasily Watch: ' || a.title || ' (' || a.level || ')', 'text', v_text));
    end if;
    update watch.alerts set last_sent_at = now(), sends = sends + 1 where id = a.id;
  end loop;
  -- tell once when a critical alert is over
  for a in select al.*, ck.title from watch.alerts al join watch.checks ck on ck.key = al.check_key
            where al.closed_at > now() - interval '70 seconds' and al.level = 'critical' and al.sends > 0 and al.seen_by is distinct from 'closed-told'
  loop
    if v_bot is not null and v_chat is not null then
      perform net.http_post(url := 'https://api.telegram.org/bot' || v_bot || '/sendMessage',
        body := jsonb_build_object('chat_id', v_chat, 'text', '🟢 Fine again · ' || a.title));
    end if;
    update watch.alerts set seen_by = coalesce(seen_by, 'closed-told') where id = a.id;
  end loop;
end $$;

-- the wall screen presses "Seen": stops the repeats (the alert stays open until fixed)
create or replace function watch.seen(p_id bigint, p_by text) returns void
language sql security definer set search_path = '' as $$
  update watch.alerts set seen_at = now(), seen_by = left(p_by, 60) where id = p_id and seen_at is null
$$;

-- one call for the wall screen
create or replace function watch.wall() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'now', now(),
    'snapshot', (select jsonb_build_object('at', at, 'ok', ok, 'data', data, 'error', error) from watch.snapshots order by at desc limit 1),
    'health', (select coalesce(jsonb_agg(jsonb_build_object('at', at, 'status', status, 'ms', ms) order by at), '[]')
                 from (select at, status, ms from watch.probes where kind = 'health' and done order by at desc limit 60) x),
    'connections', (select coalesce(jsonb_agg(jsonb_build_object('at', at, 'n', (data -> 'connections' ->> 'total')::int) order by at), '[]')
                      from (select at, data from watch.snapshots where ok order by at desc limit 60) x),
    'checks', (select coalesce(jsonb_agg(to_jsonb(c) order by case c.level when 'critical' then 0 when 'early warning' then 1 when 'unknown' then 2 else 3 end, c.title), '[]') from watch.checks c),
    'alerts', (select coalesce(jsonb_agg(to_jsonb(a) order by a.opened_at desc), '[]')
                 from (select * from watch.alerts where closed_at is null or closed_at > now() - interval '24 hours' order by opened_at desc limit 30) a)
  )
$$;

create or replace function watch.tick() returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform watch.collect();
  perform watch.evaluate();
  perform watch.notify();
end $$;

revoke execute on all functions in schema watch from public, anon, authenticated;
grant usage on schema watch to service_role;
grant execute on function watch.wall(), watch.seen(bigint, text) to service_role;

-- every minute (re-running this file keeps one job)
select cron.unschedule(jobid) from cron.job where jobname = 'peasily-watch-tick';
select cron.schedule('peasily-watch-tick', '* * * * *', $$select watch.tick()$$);
