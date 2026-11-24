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
  select jsonb_build_object(
    'runs', (select count(*) from public.ai_lab_runs),
    'codedRuns', (select count(participant) from public.ai_lab_runs),
    'randomizedPlayers', (select count(distinct case when policy = 'collect' then participant end)
      from public.ai_lab_runs),
    'sessions', case
      when (select count(participant) from public.ai_lab_runs) > p_known_coded_runs
       and (select count(distinct case when policy = 'collect' then participant end)
         from public.ai_lab_runs) >= 5 then
      (select jsonb_agg(run_data order by id) from public.ai_lab_runs where participant is not null)
    end
  );
$$;

revoke all on function public.hitdotclown_ai_lab_snapshot(integer) from public, anon, authenticated;
grant execute on function public.hitdotclown_ai_lab_snapshot(integer) to service_role;

create table if not exists public.ai_progressive_runs (like public.ai_lab_runs including all);
create table if not exists public.ai_progressive_models (like public.ai_lab_models including all);

alter table public.ai_progressive_runs enable row level security;
alter table public.ai_progressive_models enable row level security;
revoke all on public.ai_progressive_runs, public.ai_progressive_models from public, anon, authenticated, service_role;
grant select, insert on public.ai_progressive_runs, public.ai_progressive_models to service_role;

-- Preserve ESP32 input provenance in its source table; the progressive model is shared with browser runs.
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

-- Both input modes share the same progressive training pool and participant count.
create or replace function public.hitdotclown_progressive_snapshot(p_known_coded_runs integer)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'runs', (select count(*) from public.ai_progressive_runs)
      + (select count(*) from public.ai_progressive_esp32_runs),
    'syntheticRuns', (select count(*) from public.ai_progressive_runs
      where coalesce((run_data->>'synthetic')::boolean, false))
      + (select count(*) from public.ai_progressive_esp32_runs
        where capture_source = 'synthetic_seed' or coalesce((run_data->>'synthetic')::boolean, false)),
    'realRuns', (select count(*) from public.ai_progressive_runs
      where not coalesce((run_data->>'synthetic')::boolean, false))
      + (select count(*) from public.ai_progressive_esp32_runs
        where capture_source <> 'synthetic_seed' and not coalesce((run_data->>'synthetic')::boolean, false)),
    'codedRuns', (select count(participant) from public.ai_progressive_runs
      where not coalesce((run_data->>'synthetic')::boolean, false))
      + (select count(participant) from public.ai_progressive_esp32_runs
        where capture_source <> 'synthetic_seed' and not coalesce((run_data->>'synthetic')::boolean, false)),
    'adaptivePlayers', (select count(distinct participants.participant) from (
      select participant from public.ai_progressive_runs
      where not coalesce((run_data->>'synthetic')::boolean, false) and policy = 'adaptive'
        and jsonb_array_length(run_data->'rounds') > 1
      union
      select participant from public.ai_progressive_esp32_runs
      where capture_source <> 'synthetic_seed' and not coalesce((run_data->>'synthetic')::boolean, false) and policy = 'adaptive'
        and jsonb_array_length(run_data->'rounds') > 1
    ) as participants),
    'sessions', case
      when ((select count(*) from public.ai_progressive_runs)
        + (select count(*) from public.ai_progressive_esp32_runs)) > p_known_coded_runs
       and (select count(distinct participants.participant) from (
          select participant from public.ai_progressive_runs
          where not coalesce((run_data->>'synthetic')::boolean, false) and policy = 'adaptive'
            and jsonb_array_length(run_data->'rounds') > 1
          union
          select participant from public.ai_progressive_esp32_runs
          where capture_source <> 'synthetic_seed' and not coalesce((run_data->>'synthetic')::boolean, false) and policy = 'adaptive'
            and jsonb_array_length(run_data->'rounds') > 1
        ) as participants) >= 5
      then (select jsonb_agg(all_runs.run_data order by all_runs.id) from (
        select id, case when capture_source = 'synthetic_seed'
          then jsonb_set(run_data, '{synthetic}', 'true'::jsonb, true) else run_data end as run_data
        from public.ai_progressive_runs where participant is not null
        union all
        select id, case when capture_source = 'synthetic_seed'
          then jsonb_set(run_data, '{synthetic}', 'true'::jsonb, true) else run_data end as run_data
        from public.ai_progressive_esp32_runs where participant is not null
      ) as all_runs)
    end
  );
$$;

revoke all on function public.hitdotclown_progressive_snapshot(integer) from public, anon, authenticated;
grant execute on function public.hitdotclown_progressive_snapshot(integer) to service_role;

create or replace function public.hitdotclown_progressive_esp32_snapshot(p_known_coded_runs integer)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'runs', (select count(*) from public.ai_progressive_esp32_runs),
    'syntheticRuns', (select count(*) from public.ai_progressive_esp32_runs
      where coalesce((run_data->>'synthetic')::boolean, false)),
    'realRuns', (select count(*) from public.ai_progressive_esp32_runs
      where not coalesce((run_data->>'synthetic')::boolean, false)),
    'codedRuns', (select count(participant) from public.ai_progressive_esp32_runs
      where not coalesce((run_data->>'synthetic')::boolean, false)),
    'adaptivePlayers', (select count(distinct participant) from public.ai_progressive_esp32_runs
      where not coalesce((run_data->>'synthetic')::boolean, false)
        and policy = 'adaptive' and jsonb_array_length(run_data->'rounds') > 1),
    'sessions', case
      when (select count(participant) from public.ai_progressive_esp32_runs
        where not coalesce((run_data->>'synthetic')::boolean, false)) > p_known_coded_runs
       and (select count(distinct participant) from public.ai_progressive_esp32_runs
        where not coalesce((run_data->>'synthetic')::boolean, false)
          and policy = 'adaptive' and jsonb_array_length(run_data->'rounds') > 1) >= 5
      then (select jsonb_agg(run_data order by id) from public.ai_progressive_esp32_runs where participant is not null)
    end
  );
$$;

revoke all on function public.hitdotclown_progressive_esp32_snapshot(integer) from public, anon, authenticated;
grant execute on function public.hitdotclown_progressive_esp32_snapshot(integer) to service_role;

commit;
