-- Hit Dot Clown AI Lab: remove only simulated seed data and models trained with it.
-- Human browser and ESP32 playthroughs are preserved.
begin;

delete from public.ai_progressive_models
where model->>'synthetic' = 'true'
   or model->>'provenance' in ('simulated', 'synthetic-seeded');

delete from public.ai_progressive_esp32_models
where model->>'synthetic' = 'true'
   or model->>'provenance' in ('simulated', 'synthetic-seeded');

delete from public.ai_progressive_runs
where run_data->>'synthetic' = 'true';

delete from public.ai_progressive_esp32_runs
where capture_source = 'synthetic_seed'
   or run_data->>'synthetic' = 'true';

commit;

-- Both counts should be zero. Real coded runs are not affected.
select
  (select count(*) from public.ai_progressive_runs
    where run_data->>'synthetic' = 'true') as synthetic_browser_rows_remaining,
  (select count(*) from public.ai_progressive_esp32_runs
    where capture_source = 'synthetic_seed' or run_data->>'synthetic' = 'true') as synthetic_esp32_rows_remaining,
  (select count(*) from public.ai_progressive_models
    where model->>'synthetic' = 'true'
       or model->>'provenance' in ('simulated', 'synthetic-seeded')) as synthetic_shared_models_remaining,
  (select count(*) from public.ai_progressive_esp32_models
    where model->>'synthetic' = 'true'
       or model->>'provenance' in ('simulated', 'synthetic-seeded')) as synthetic_esp32_models_remaining;
