begin;

create table if not exists public.ai_lab_runs (
  id uuid primary key,
  participant text check (participant ~ '^P([0-9]{3,5}|-[0-9A-F]{8})$'),
  policy text not null check (policy in ('adaptive', 'fixed', 'collect')),
  capture_source text not null check (capture_source in ('playthrough', 'browser_archive', 'sqlite_import')),
  saved_at timestamptz not null default now(),
  run_data jsonb not null,
  check (policy <> 'collect' or participant is not null)
);

create table if not exists public.ai_lab_models (
  id text primary key check (id ~ '^[0-9a-f]{64}$'),
  coded_runs integer not null check (coded_runs >= 5),
  trained_at timestamptz not null default now(),
  model jsonb not null,
  evaluation jsonb not null,
  cohort jsonb not null
);

create index if not exists ai_lab_models_latest on public.ai_lab_models (coded_runs desc, trained_at desc, id);

alter table public.ai_lab_runs enable row level security;
alter table public.ai_lab_models enable row level security;
revoke all on public.ai_lab_runs, public.ai_lab_models from public, anon, authenticated, service_role;
grant select, insert on public.ai_lab_runs, public.ai_lab_models to service_role;

-- Return statistics and the current training cohort from a single database snapshot.
create or replace function public.hitdotclown_ai_lab_snapshot(p_known_coded_runs integer)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with counts as (
    select count(*) as runs, count(participant) as coded_runs,
      count(distinct participant) filter (where policy = 'collect') as randomized_players
    from public.ai_lab_runs
  )
  select jsonb_build_object(
    'runs', runs,
    'codedRuns', coded_runs,
    'randomizedPlayers', randomized_players,
    'sessions', case when coded_runs > p_known_coded_runs and randomized_players >= 5 then
      (select jsonb_agg(run_data order by id) from public.ai_lab_runs where participant is not null)
    end
  )
  from counts;
$$;

revoke all on function public.hitdotclown_ai_lab_snapshot(integer) from public, anon, authenticated;
grant execute on function public.hitdotclown_ai_lab_snapshot(integer) to service_role;

create table if not exists public.ai_progressive_runs (like public.ai_lab_runs including all);
create table if not exists public.ai_progressive_models (like public.ai_lab_models including all);

alter table public.ai_progressive_runs enable row level security;
alter table public.ai_progressive_models enable row level security;
revoke all on public.ai_progressive_runs, public.ai_progressive_models from public, anon, authenticated, service_role;
grant select, insert on public.ai_progressive_runs, public.ai_progressive_models to service_role;

create or replace function public.hitdotclown_progressive_snapshot(p_known_coded_runs integer)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with counts as (
    select count(*) as runs, count(participant) as coded_runs,
      count(distinct participant) filter (where policy = 'collect' and jsonb_array_length(run_data->'rounds') > 1) as randomized_players
    from public.ai_progressive_runs
  )
  select jsonb_build_object(
    'runs', runs,
    'codedRuns', coded_runs,
    'randomizedPlayers', randomized_players,
    'sessions', case when coded_runs > p_known_coded_runs and randomized_players >= 5 then
      (select jsonb_agg(run_data order by id) from public.ai_progressive_runs where participant is not null)
    end
  )
  from counts;
$$;

revoke all on function public.hitdotclown_progressive_snapshot(integer) from public, anon, authenticated;
grant execute on function public.hitdotclown_progressive_snapshot(integer) to service_role;

-- Keep ESP32 playthroughs and their trained model separate from browser runs.
create table if not exists public.ai_progressive_esp32_runs (like public.ai_lab_runs including all);
create table if not exists public.ai_progressive_esp32_models (like public.ai_lab_models including all);

-- Add a source label for the synthetic seed rows without creating another run table.
do $$
declare
  existing_check text;
begin
  for existing_check in
    select conname from pg_constraint
    where conrelid = 'public.ai_progressive_esp32_runs'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%capture_source%'
  loop
    execute format('alter table public.ai_progressive_esp32_runs drop constraint %I', existing_check);
  end loop;
  alter table public.ai_progressive_esp32_runs
    add constraint ai_progressive_esp32_capture_source_check
    check (capture_source in ('playthrough', 'browser_archive', 'sqlite_import', 'synthetic_seed'));
end;
$$;

alter table public.ai_progressive_esp32_runs enable row level security;
alter table public.ai_progressive_esp32_models enable row level security;
revoke all on public.ai_progressive_esp32_runs, public.ai_progressive_esp32_models from public, anon, authenticated, service_role;
grant select, insert on public.ai_progressive_esp32_runs, public.ai_progressive_esp32_models to service_role;

create or replace function public.hitdotclown_progressive_esp32_snapshot(p_known_coded_runs integer)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with counts as (
    select count(*) as runs,
      count(*) filter (where coalesce((run_data->>'synthetic')::boolean, false)) as synthetic_runs,
      count(*) filter (where not coalesce((run_data->>'synthetic')::boolean, false)) as real_runs,
      count(participant) filter (where not coalesce((run_data->>'synthetic')::boolean, false)) as coded_runs,
      count(distinct participant) filter (where not coalesce((run_data->>'synthetic')::boolean, false)
        and policy = 'collect' and jsonb_array_length(run_data->'rounds') > 1) as randomized_players
    from public.ai_progressive_esp32_runs
  )
  select jsonb_build_object(
    'runs', runs,
    'syntheticRuns', synthetic_runs,
    'realRuns', real_runs,
    'codedRuns', coded_runs,
    'randomizedPlayers', randomized_players,
    'sessions', case when coded_runs > p_known_coded_runs and randomized_players >= 5 then
      (select jsonb_agg(run_data order by id) from public.ai_progressive_esp32_runs where participant is not null)
    end
  )
  from counts;
$$;

revoke all on function public.hitdotclown_progressive_esp32_snapshot(integer) from public, anon, authenticated;
grant execute on function public.hitdotclown_progressive_esp32_snapshot(integer) to service_role;

commit;
