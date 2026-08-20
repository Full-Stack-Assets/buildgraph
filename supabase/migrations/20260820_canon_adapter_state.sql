-- Durable state for ephemeral GitHub Actions adapter runs.
-- Apply this migration to a dedicated Supabase project. The service-role key
-- is used only by the server-side workflow and must never reach a client.

create table if not exists public.canon_sync_checkpoints (
  adapter_id text primary key,
  cursor text,
  updated_at timestamptz not null,
  last_run_id text not null
);

create table if not exists public.canon_ingested_records (
  adapter_id text not null,
  external_id_hash text not null,
  source jsonb not null,
  content jsonb not null,
  first_observed_at timestamptz not null,
  last_observed_at timestamptz not null,
  last_run_id text not null,
  primary key (adapter_id, external_id_hash)
);

create table if not exists public.canon_ingest_receipts (
  receipt_id text primary key,
  run_id text not null,
  adapter_id text not null,
  external_id_hash text not null,
  content_hash text,
  record_path text not null,
  object_path text,
  status text not null check (status in ('CREATED','UPDATED','UNCHANGED','TOMBSTONED')),
  observed_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists public.canon_dead_letters (
  id bigint generated always as identity primary key,
  run_id text not null,
  adapter_id text not null,
  external_id_hash text,
  phase text not null check (phase in ('list','read','ingest','checkpoint')),
  occurred_at timestamptz not null,
  error_class text not null,
  message text not null,
  retryable boolean not null
);

create table if not exists public.canon_sync_runs (
  id bigint generated always as identity primary key,
  run_id text not null,
  receipt jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists public.canon_retrieval_states (
  job_id text primary key,
  last_attempt_at timestamptz not null,
  last_completed_at timestamptz,
  last_status text not null check (last_status in ('SUCCEEDED','FAILED')),
  last_run_id text not null,
  last_evidence_hash text
);

create table if not exists public.canon_retrieval_runs (
  id bigint generated always as identity primary key,
  run_id text not null,
  receipt jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists public.canon_run_leases (
  name text primary key,
  owner_id text not null,
  acquired_at timestamptz not null default now(),
  expires_at timestamptz not null
);

alter table public.canon_sync_checkpoints enable row level security;
alter table public.canon_ingested_records enable row level security;
alter table public.canon_ingest_receipts enable row level security;
alter table public.canon_dead_letters enable row level security;
alter table public.canon_sync_runs enable row level security;
alter table public.canon_retrieval_states enable row level security;
alter table public.canon_retrieval_runs enable row level security;
alter table public.canon_run_leases enable row level security;

create or replace function public.acquire_canon_lease(p_name text, p_owner_id text, p_ttl_seconds integer)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  insert into public.canon_run_leases(name, owner_id, acquired_at, expires_at)
  values (p_name, p_owner_id, now(), now() + make_interval(secs => p_ttl_seconds))
  on conflict (name) do update
    set owner_id = excluded.owner_id,
        acquired_at = excluded.acquired_at,
        expires_at = excluded.expires_at
    where public.canon_run_leases.expires_at <= now();
  return exists (
    select 1 from public.canon_run_leases
    where name = p_name and owner_id = p_owner_id
  );
end;
$$;

create or replace function public.release_canon_lease(p_name text, p_owner_id text)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare deleted_count integer;
begin
  delete from public.canon_run_leases where name = p_name and owner_id = p_owner_id;
  get diagnostics deleted_count = row_count;
  return deleted_count = 1;
end;
$$;

revoke all on all tables in schema public from anon, authenticated;
revoke all on function public.acquire_canon_lease(text, text, integer) from public, anon, authenticated;
revoke all on function public.release_canon_lease(text, text) from public, anon, authenticated;
grant execute on function public.acquire_canon_lease(text, text, integer) to service_role;
grant execute on function public.release_canon_lease(text, text) to service_role;

insert into storage.buckets (id, name, public)
values ('canon-objects', 'canon-objects', false)
on conflict (id) do nothing;
